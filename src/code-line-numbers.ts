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

/**
 * The code block's own DOM holds the numbers beside its text, in a gutter that is not part of the
 * editable content. The text stays the only content of `code`, so the browser edits it as it
 * would without numbers.
 *
 * Each entry holds a hidden copy of its line, laid out with the code's font, width and wrapping,
 * so the browser places the next number by flow. A font, token or width change reflows the copy
 * with the text, and nothing here measures or listens for it. The copy is `visibility: hidden`,
 * `aria-hidden` and not selectable, so it is never read, found, selected or copied.
 */
class CodeBlockView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly gutter?: HTMLElement
  private readonly entries: { entry: HTMLElement; text: string }[] = []
  private digits = 0

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
    if (this.numbered) this.fill()
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

  /** One entry for each line of the text, holding that line, and the gutter as wide as the largest number. */
  private fill(): void {
    const lines = this.node.textContent.split('\n')
    while (this.entries.length < lines.length) {
      const entry = document.createElement('span')
      entry.className = 'inkkit-line-number'
      entry.setAttribute('data-inkkit-line', String(this.entries.length + 1))
      entry.append(document.createElement('span'))
      entry.firstElementChild!.className = 'inkkit-line-copy'
      this.gutter!.append(entry)
      this.entries.push({ entry, text: '' })
    }
    while (this.entries.length > lines.length)
      this.entries.pop()!.entry.remove()
    for (const [index, item] of this.entries.entries()) {
      const text = lines[index]!
      if (item.text === text) continue
      item.text = text
      item.entry.firstElementChild!.textContent = text
    }
    const digits = String(lines.length).length
    if (digits !== this.digits) {
      this.digits = digits
      this.dom.style.setProperty('--_inkkit-line-digits', String(digits))
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
