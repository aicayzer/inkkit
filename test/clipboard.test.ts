import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { clipboardContent, portableClipboard } from '../src/clipboard'
import type { ImageAdapter } from '../src/types'
import { withEditor } from './harness'

const context = { documentId: 'note', generation: 1, operationId: 'copy' }
test('ordinary text retains visible punctuation, entities and selected edge spaces', async () => {
  await withEditor('**bold** text\n', (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText(' &#x20; ', view.state.doc.content.size - 1),
    )
    const copied = clipboardContent(view.state.doc.content, view.state.schema)
    expect(copied.text).toBe('bold text &#x20; ')
    expect(copied.html).toContain('<strong>bold</strong>')
    expect(copied.html).toContain('&amp;#x20;')
  })
})
test('ordinary copy keeps paragraph, nested list and table structure readable', async () => {
  await withEditor(
    'First\n\n- one\n  - two\n\n| a | b |\n| --- | --- |\n| c | d |\n',
    (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const copied = clipboardContent(view.state.doc.content, view.state.schema)
      expect(copied.text).toBe('First\n\n- one\n  - two\n\na\tb\nc\td')
      expect(copied.html).toContain('<table>')
    },
  )
})
test('literal unsupported HTML copies as visible source rather than executing markup', async () => {
  await withEditor('<aside>Literal</aside>\n', (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const copied = clipboardContent(view.state.doc.content, view.state.schema)
    expect(copied.text).toContain('<aside>Literal</aside>')
    expect(copied.html).toContain('&lt;aside&gt;')
  })
})
