import {
  DOMSerializer,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state'
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type ViewMutationRecord,
} from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { updateCodeBlockDecorations } from './code-block-decorations'
import { displayCtx } from './display'

interface LineNumbers {
  enabled: boolean
  decorations: DecorationSet
}

const lineNumberKey = new PluginKey<LineNumbers>('inkkitCodeLineNumbers')

/**
 * A decoration on each numbered block. It carries the attribute the stylesheet keys on, and its
 * arrival or removal is what makes ProseMirror ask the block's view whether it still fits.
 */
function blockDecorations(node: ProseNode, pos: number): Decoration[] {
  return [
    Decoration.node(
      pos,
      pos + node.nodeSize,
      { 'data-inkkit-line-numbers': '' },
      {},
    ),
  ]
}

function decorations(doc: ProseNode): DecorationSet {
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block')
      for (const decoration of blockDecorations(node, pos))
        found.push(decoration)
    return false
  })
  return DecorationSet.create(doc, found)
}

/** The number of lines in the text. A trailing newline starts one more, empty line. */
function lineCount(text: string): number {
  let lines = 1
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1))
    lines++
  return lines
}

type Read = () => (() => void) | undefined

const measuring = new Set<Read>()
let flushing = false

/**
 * Measures after the whole update has reached the DOM. Every pending block reads before any
 * block writes, so one layout serves them all.
 */
function measureSoon(read: Read): void {
  measuring.add(read)
  if (flushing) return
  flushing = true
  queueMicrotask(() => {
    flushing = false
    const pending = [...measuring]
    measuring.clear()
    for (const write of pending.map((item) => item())) write?.()
  })
}

/**
 * The code block's own DOM holds the numbers beside its text, in a gutter that is not part of the
 * editable content. The text stays the only content of `code`, so the browser edits it as it
 * would without numbers.
 */
class CodeBlockView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly gutter?: HTMLElement
  private readonly entries: HTMLElement[] = []
  private readonly observer?: ResizeObserver
  private spaced = false
  private lines = 0

  private readonly numbered: boolean

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
  ) {
    this.numbered = lineNumberKey.getState(view.state)?.enabled ?? false
    const rendered = DOMSerializer.renderSpec(
      document,
      node.type.spec.toDOM!(node),
    )
    this.dom = rendered.dom as HTMLElement
    this.contentDOM = rendered.contentDOM as HTMLElement
    if (!this.numbered) return
    this.gutter = document.createElement('span')
    this.gutter.className = 'inkkit-code-gutter'
    this.gutter.setAttribute('aria-hidden', 'true')
    this.gutter.setAttribute('contenteditable', 'false')
    this.dom.insertBefore(this.gutter, this.contentDOM)
    this.fill()
    if (typeof ResizeObserver !== 'undefined') {
      // A resize or a wrap toggle can change where lines break without any edit.
      this.observer = new ResizeObserver(() => measureSoon(this.measure))
      this.observer.observe(this.contentDOM)
    }
  }

  /**
   * A change of preference reaches a block as a changed decoration, and the view then gives way
   * to one built for the new preference.
   */
  update(node: ProseNode): boolean {
    if (
      node.type !== this.node.type ||
      !node.sameMarkup(this.node) ||
      (lineNumberKey.getState(this.view.state)?.enabled ?? false) !==
        this.numbered
    )
      return false
    this.node = node
    if (this.numbered) {
      this.fill()
      measureSoon(this.measure)
    }
    return true
  }

  /** The browser edits the gutter's neighbour, never the gutter. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return (
      mutation.type !== 'selection' &&
      !this.contentDOM.contains(mutation.target)
    )
  }

  stopEvent(event: Event): boolean {
    return this.gutter?.contains(event.target as Node | null) ?? false
  }

  destroy(): void {
    this.observer?.disconnect()
    measuring.delete(this.measure)
  }

  /** One entry for each line of the text, and the gutter as wide as the largest number. */
  private fill(): void {
    const lines = lineCount(this.node.textContent)
    if (lines === this.lines) return
    this.lines = lines
    while (this.entries.length < lines) {
      const entry = document.createElement('span')
      entry.className = 'inkkit-line-number'
      entry.setAttribute('data-inkkit-line', String(this.entries.length + 1))
      this.gutter!.append(entry)
      this.entries.push(entry)
    }
    while (this.entries.length > lines) this.entries.pop()!.remove()
    this.dom.style.setProperty(
      '--_inkkit-line-digits',
      String(String(lines).length),
    )
  }

  /**
   * Reads where each text line begins, then returns the writes that space the numbers to them.
   * Without wrapping every line is one line tall and the numbers already match, so nothing is
   * read. A wrapped line takes several lines, and its number keeps the first: the entries that
   * follow move down by the lines it added. The reads of every pending block come before any
   * write, so one layout serves them all.
   */
  private readonly measure: Read = () => {
    const { dom, contentDOM, entries } = this
    if (!this.gutter || !dom.isConnected) return undefined
    const wrapped = dom.classList.contains('inkkit-code-wrapped')
    if (!wrapped || typeof Range.prototype.getClientRects !== 'function')
      return () => this.space([])
    const tops = this.lineTops()
    const height = entries[0]?.getBoundingClientRect().height ?? 0
    const bottom = contentDOM.getBoundingClientRect().bottom
    const spacing = tops.map((top, index) => {
      const next = index + 1 < tops.length ? tops[index + 1]! : bottom
      const extra = next - top - height
      return Number.isFinite(extra) && extra > 0.5 ? extra : 0
    })
    return () => this.space(spacing)
  }

  private space(spacing: number[]): void {
    const used = spacing.some((extra) => extra > 0)
    if (!used && !this.spaced) return
    this.spaced = used
    for (const [index, entry] of this.entries.entries()) {
      const extra = spacing[index] ?? 0
      entry.style.marginBottom = extra ? `${extra}px` : ''
    }
  }

  /** The top of the first character of each text line, as it is laid out now. */
  private lineTops(): number[] {
    const tops: number[] = []
    const walker = document.createTreeWalker(
      this.contentDOM,
      NodeFilter.SHOW_TEXT,
      {
        // A control the editor draws in the block is not part of its text.
        acceptNode: (node) =>
          node.parentElement?.closest('.ProseMirror-widget')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      },
    )
    const range = document.createRange()
    const top = (node: Text, offset: number): number => {
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      return range.getClientRects()[0]?.top ?? Number.NaN
    }
    let starting = true
    for (
      let node = walker.nextNode() as Text | null;
      node;
      node = walker.nextNode() as Text | null
    ) {
      const data = node.data
      if (!data.length) continue
      if (starting) {
        tops.push(top(node, 0))
        starting = false
      }
      for (
        let at = data.indexOf('\n');
        at >= 0;
        at = data.indexOf('\n', at + 1)
      ) {
        if (at + 1 < data.length) tops.push(top(node, at + 1))
        else starting = true
      }
    }
    // A trailing newline starts an empty line, which the browser draws with a break.
    if (starting) {
      const trail = this.contentDOM.querySelector(':scope > br')
      tops.push(trail?.getBoundingClientRect().top ?? Number.NaN)
    }
    return tops
  }
}

/** Turns line numbers on or off in the transaction. */
export function setLineNumbers(tr: Transaction, enabled: boolean): void {
  tr.setMeta(lineNumberKey, enabled)
}

export const codeLineNumbers = $prose(
  (ctx) =>
    new Plugin<LineNumbers>({
      key: lineNumberKey,
      state: {
        init: (_, state) => {
          const enabled = ctx.get(displayCtx.key)().codeLineNumbers
          return {
            enabled,
            decorations: enabled ? decorations(state.doc) : DecorationSet.empty,
          }
        },
        apply(tr, previous, _old, state) {
          const meta = tr.getMeta(lineNumberKey) as boolean | undefined
          const enabled = meta ?? previous.enabled
          if (!enabled)
            return enabled === previous.enabled
              ? previous
              : { enabled, decorations: DecorationSet.empty }
          if (!previous.enabled)
            return { enabled, decorations: decorations(state.doc) }
          return tr.docChanged
            ? {
                enabled,
                decorations: updateCodeBlockDecorations(
                  previous.decorations.map(tr.mapping, tr.doc),
                  tr,
                  blockDecorations,
                ),
              }
            : previous
        },
      },
      props: {
        decorations: (state) => lineNumberKey.getState(state)?.decorations,
        attributes: (state) =>
          lineNumberKey.getState(state)?.enabled
            ? { 'data-inkkit-code-line-numbers': 'true' }
            : ({} as Record<string, string>),
        nodeViews: {
          code_block: (node: ProseNode, view: EditorView) =>
            new CodeBlockView(node, view),
        },
      },
    }),
)

/** The decorations the plugin holds, for tests that count how many blocks an edit rebuilt. */
export function lineNumberDecorations(state: EditorState): DecorationSet {
  return lineNumberKey.getState(state)?.decorations ?? DecorationSet.empty
}
