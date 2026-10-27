import { expect, test } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'

// The root view patch keeps invisible source-history attributes out of DOM identity.
test('root attributes update without rebuilding children, but a changed root type rebuilds', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+', attrs: { source: { default: '' } } },
      other: { content: 'paragraph+', attrs: { source: { default: '' } } },
      paragraph: { content: 'text*', toDOM: () => ['p', 0] },
      text: {},
    },
  })
  const node = schema.nodes.paragraph!.create(null, schema.text('Kept text'))
  const root = document.createElement('div')
  document.body.append(root)
  const view = new EditorView(root, {
    state: EditorState.create({
      schema,
      doc: schema.nodes.doc!.create(null, node),
    }),
    attributes: (state) => ({
      'data-source': state.doc.attrs.source as string,
    }),
  })
  try {
    const child = view.dom.firstChild
    view.updateState(
      view.state.apply(view.state.tr.setDocAttribute('source', 'updated')),
    )
    expect(view.dom.firstChild).toBe(child)
    expect(view.dom.getAttribute('data-source')).toBe('updated')
    expect(view.state.doc.attrs.source).toBe('updated')
    view.updateState(
      EditorState.create({
        schema,
        doc: schema.nodes.other!.create({ source: 'other' }, node),
      }),
    )
    expect(view.dom.firstChild).not.toBe(child)
    expect(view.dom.getAttribute('data-source')).toBe('other')
    expect(view.dom.textContent).toBe('Kept text')
  } finally {
    view.destroy()
    root.remove()
  }
})
