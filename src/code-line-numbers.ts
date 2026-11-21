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
  type DecorationSource,
  DecorationSet,
  type EditorView,
  type NodeView,
  type ViewMutationRecord,
} from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  highlightClass,
  updateCodeBlockDecorations,
} from './code-block-decorations'
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

/** What the browser draws on one line of code: a run of text and the highlight classes it has. */
interface Run {
  text: string
  classes: string
}

/**
 * The code's lines as runs, from the text and the highlight decorations that colour it, so the
 * mirror of a wrapped block draws each run with the same classes as the code does.
 */
function lineRuns(text: string, inner: DecorationSource): Run[][] {
  const spans: { from: number; to: number; classes: string }[] = []
  inner.forEachSet((set) => {
    for (const decoration of set.find()) {
      const classes = (
        decoration.spec as Record<string, unknown> | undefined
      )?.[highlightClass]
      if (typeof classes === 'string')
        spans.push({ from: decoration.from, to: decoration.to, classes })
    }
  })
  spans.sort((a, b) => a.from - b.from)
  const lines: Run[][] = [[]]
  const add = (from: number, to: number, classes: string) => {
    const pieces = text.slice(from, to).split('\n')
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([])
      if (piece) lines[lines.length - 1]!.push({ text: piece, classes })
    })
  }
  let at = 0
  for (const span of spans) {
    if (span.from < at) continue
    add(at, span.from, '')
    add(span.from, span.to, span.classes)
    at = span.to
  }
  add(at, text.length, '')
  return lines
}

function sameRuns(left: readonly Run[] | undefined, right: readonly Run[]) {
  return (
    left?.length === right.length &&
    left.every(
      (run, index) =>
        run.text === right[index]!.text &&
        run.classes === right[index]!.classes,
    )
  )
}

/**
 * The code block's own DOM holds the numbers beside its text, in a gutter that is not part of the
 * editable content. The text stays the only content of `code`, so the browser edits it as it
 * would without numbers.
 *
 * Without wrapping, every line is one line tall, so the gutter is one element that draws all the
 * numbers from a data attribute, one to a line, and the lines fall where the code's do. With
 * wrapping, a line can be several lines tall, so each line has an entry holding a hidden mirror
 * of it, built from the same highlight classes as the code and drawing its text from a data
 * attribute. The mirror takes the code's font, width and wrapping, so the browser places the next
 * number by flow, and a font, token or width change reflows it with the text. It holds no text
 * nodes, so it never enters a selection, a DOM range, a search or the clipboard.
 */
class CodeBlockView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly gutter?: HTMLElement
  private readonly entries: { entry: HTMLElement; runs: readonly Run[] }[] = []
  private wrapped = false
  private lines = 0
  private digits = 0

  private readonly numbered: boolean

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    _getPos: () => number | undefined,
    outer: readonly Decoration[],
    inner: DecorationSource,
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
    this.fill(outer, inner)
  }

  /**
   * A change of preference reaches a block as a changed decoration, and the view then gives way
   * to one built for the new preference.
   */
  update(
    node: ProseNode,
    outer: readonly Decoration[],
    inner: DecorationSource,
  ): boolean {
    if (
      node.type !== this.node.type ||
      !node.sameMarkup(this.node) ||
      (lineNumberKey.getState(this.view.state)?.enabled ?? false) !==
        this.numbered
    )
      return false
    this.node = node
    if (this.numbered) this.fill(outer, inner)
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

  /** The numbers, and in a wrapped block the mirror of each line, and the gutter's width. */
  private fill(outer: readonly Decoration[], inner: DecorationSource): void {
    const gutter = this.gutter!
    const text = this.node.textContent
    let lines = 1
    for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1))
      lines++
    const wrapped = outer.some((decoration) => decoration.spec?.wrapped)
    if (wrapped !== this.wrapped) {
      this.wrapped = wrapped
      this.entries.length = 0
      gutter.replaceChildren()
      gutter.removeAttribute('data-inkkit-numbers')
      this.lines = 0
    }
    if (wrapped) this.mirror(text, inner)
    else if (lines !== this.lines) {
      const numbers = new Array<number>(lines)
      for (let index = 0; index < lines; index++) numbers[index] = index + 1
      gutter.setAttribute('data-inkkit-numbers', numbers.join('\n'))
    }
    this.lines = lines
    const digits = String(lines).length
    if (digits !== this.digits) {
      this.digits = digits
      this.dom.style.setProperty('--_inkkit-line-digits', String(digits))
    }
  }

  /** One entry for each line, holding a mirror that draws the line's runs from data attributes. */
  private mirror(text: string, inner: DecorationSource): void {
    const lines = lineRuns(text, inner)
    while (this.entries.length < lines.length) {
      const entry = document.createElement('span')
      entry.className = 'inkkit-line-number'
      entry.setAttribute('data-inkkit-line', String(this.entries.length + 1))
      this.gutter!.append(entry)
      this.entries.push({ entry, runs: [] })
    }
    while (this.entries.length > lines.length)
      this.entries.pop()!.entry.remove()
    for (const [index, item] of this.entries.entries()) {
      const runs = lines[index]!
      if (sameRuns(item.runs, runs)) continue
      item.runs = runs
      const copy = document.createElement('span')
      copy.className = 'inkkit-line-copy'
      for (const run of runs) {
        const part = document.createElement('span')
        if (run.classes) part.className = run.classes
        part.setAttribute('data-text', run.text)
        copy.append(part)
      }
      item.entry.replaceChildren(copy)
    }
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
          code_block: (
            node: ProseNode,
            view: EditorView,
            getPos,
            outer,
            inner,
          ) => new CodeBlockView(node, view, getPos, outer, inner),
        },
      },
    }),
)

/** The decorations the plugin holds, for tests that count how many blocks an edit rebuilt. */
export function lineNumberDecorations(state: EditorState): DecorationSet {
  return lineNumberKey.getState(state)?.decorations ?? DecorationSet.empty
}
