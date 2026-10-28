import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { footnoteDefinitions, normaliseLabel } from './references'

export function insertFootnote(
  view: EditorView,
  label: string | undefined,
  source: () => string,
): boolean {
  const definitions = footnoteDefinitions(view.state.doc)
  if (label == null) {
    let number = 1
    const labels = new Set(definitions.keys())
    for (const match of source().matchAll(/\[\^([^\]\r\n]+)\]/g))
      labels.add(normaliseLabel(match[1]!))
    view.state.doc.descendants((node) => {
      if (node.type.name === 'footnote_reference')
        labels.add(String(node.attrs.identifier))
    })
    while (labels.has(normaliseLabel(String(number)))) number++
    label = String(number)
  }
  const identifier = normaliseLabel(label)
  const reference = view.state.schema.nodes.footnote_reference!.create({
    label,
    identifier,
  })
  const tr = view.state.tr.insert(view.state.selection.to, reference)
  if (!definitions.has(identifier)) {
    const definition = view.state.schema.nodes.footnote_definition!.create(
      { label, identifier },
      view.state.schema.nodes.paragraph!.create(),
    )
    const position = tr.doc.content.size
    tr.insert(position, definition).setSelection(
      TextSelection.create(tr.doc, position + 2),
    )
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

export function navigateFootnote(
  view: EditorView,
  target: 'definition' | 'reference',
): boolean {
  const { $from } = view.state.selection
  let identifier: string | undefined
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'footnote_definition')
      identifier = String(node.attrs.identifier)
  }
  const at = view.state.doc.nodeAt(view.state.selection.from)
  const adjacent =
    at?.type.name === 'footnote_reference' ? at : $from.nodeBefore
  if (adjacent?.type.name === 'footnote_reference')
    identifier = String(adjacent.attrs.identifier)
  if (!identifier) return false
  let position: number | undefined
  if (target === 'definition') {
    const found = footnoteDefinitions(view.state.doc).get(identifier)
    if (found) position = found.pos + 2
  } else position = footnoteReferencePosition(view.state.doc, identifier)
  if (position == null) return false
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.near(view.state.doc.resolve(position)))
      .scrollIntoView(),
  )
  return true
}

export function footnoteReferencePosition(
  doc: ProseNode,
  identifier: string | null,
): number | undefined {
  let position: number | undefined
  doc.descendants((node, pos) => {
    if (
      position == null &&
      node.type.name === 'footnote_reference' &&
      node.attrs.identifier === identifier
    )
      position = pos
  })
  return position
}
