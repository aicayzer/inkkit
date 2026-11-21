import type { RootContent } from 'hast'
import { common, createLowlight } from 'lowlight'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  highlightClass,
  updateCodeBlockDecorations,
} from './code-block-decorations'

const lowlight = createLowlight(common)

// Trying every grammar is more expensive than an explicit language. Detection
// is limited to short blocks and remains presentation only.
export const autoHighlightLimit = 500

// highlight.js takes time that grows with the square of the text for some
// input in several grammars: one long word in ini or TypeScript, or lines of
// plain words in C, where the slow match runs on across lines. Neither a line
// nor a token limit bounds it, so a block longer than this stays plain. At
// this length the slowest input found takes about 110 ms in Chromium and
// WebKit, and ordinary code takes a few milliseconds.
export const highlightLimit = 5_000

// The length limit bounds one block; this bounds a load or an edit that
// reaches many blocks. Once highlighting in one load or edit has taken this
// many milliseconds, the blocks it has not reached stay plain until they are
// edited. A note of ordinary code reaches it only with about a megabyte of
// code; docs/maintainers/performance.md has the measurements.
export const highlightBudget = 200

// Colors are decorations over the plain text, so the markdown is untouched;
// unknown authored languages stay plain.
function blockDecorations(
  node: ProseNode,
  pos: number,
  deadline: number,
): Decoration[] {
  const language = String(node.attrs.language ?? '').toLowerCase()
  const found: Decoration[] = []
  if (language && !lowlight.registered(language)) return found
  if (!language && node.content.size > autoHighlightLimit) return found
  if (node.content.size > highlightLimit || performance.now() > deadline)
    return found
  let offset = pos + 1
  const walk = (children: RootContent[], classes: string[]) => {
    for (const child of children) {
      if (child.type === 'text') {
        const end = offset + child.value.length
        if (classes.length > 0)
          found.push(
            Decoration.inline(
              offset,
              end,
              { class: classes.join(' ') },
              // The line-number mirror of a wrapped block draws the same classes.
              { [highlightClass]: classes.join(' ') },
            ),
          )
        offset = end
      } else if (child.type === 'element') {
        // The grammar names its tokens `hljs-*`; InkKit's own prefix keeps a
        // host's highlight.js theme out of the editor.
        const own = (
          (child.properties?.className as string[] | undefined) ?? []
        ).map((name) => `inkkit-${name}`)
        walk(child.children, [...classes, ...own])
      }
    }
  }
  const highlighted = language
    ? lowlight.highlight(language, node.textContent)
    : lowlight.highlightAuto(node.textContent)
  walk(highlighted.children, [])
  return found
}

function decorations(doc: ProseNode): DecorationSet {
  const deadline = performance.now() + highlightBudget
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block')
      for (const decoration of blockDecorations(node, pos, deadline))
        found.push(decoration)
    return false
  })
  return DecorationSet.create(doc, found)
}

function update(mapped: DecorationSet, tr: Transaction): DecorationSet {
  const deadline = performance.now() + highlightBudget
  return updateCodeBlockDecorations(mapped, tr, (node, pos) =>
    blockDecorations(node, pos, deadline),
  )
}

export const highlightPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: new PluginKey('highlight'),
      state: {
        init: (_, state) => decorations(state.doc),
        apply: (tr, previous) =>
          tr.docChanged
            ? update(previous.map(tr.mapping, tr.doc), tr)
            : previous,
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
      },
    }),
)
