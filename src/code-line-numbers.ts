import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { updateCodeBlockDecorations } from './code-block-decorations'
import { displayCtx } from './display'

interface LineNumbers {
  enabled: boolean
  decorations: DecorationSet
}

const lineNumberKey = new PluginKey<LineNumbers>('inkkitCodeLineNumbers')

function numberElement(line: number): HTMLElement {
  const element = document.createElement('span')
  element.className = 'inkkit-line-number'
  element.setAttribute('data-inkkit-line', String(line))
  element.setAttribute('aria-hidden', 'true')
  element.contentEditable = 'false'
  return element
}

/**
 * A number for each line of the block's text, drawn by CSS from a data attribute, so no text
 * enters the DOM selection or the clipboard. A trailing newline starts one more, empty line.
 */
function blockDecorations(node: ProseNode, pos: number): Decoration[] {
  const text = node.textContent
  const found: Decoration[] = []
  let line = 1
  let at = 0
  for (;;) {
    const current = line
    found.push(
      Decoration.widget(pos + 1 + at, () => numberElement(current), {
        side: -1,
        key: `line:${current}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
    const next = text.indexOf('\n', at)
    if (next < 0) break
    at = next + 1
    line++
  }
  // The gutter is as wide as the largest number, set on the block.
  found.push(
    Decoration.node(pos, pos + node.nodeSize, {
      style: `--_inkkit-line-digits: ${String(line).length}`,
    }),
  )
  return found
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
      },
    }),
)

/** The decorations the plugin holds, for tests that count how many blocks an edit rebuilt. */
export function lineNumberDecorations(state: EditorState): DecorationSet {
  return lineNumberKey.getState(state)?.decorations ?? DecorationSet.empty
}
