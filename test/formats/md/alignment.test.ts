import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { ctxOf } from '../../editor-access'
import { input, withEditor } from '../harness'

// The paragraph's `align` attribute belongs to RTF. Nothing that reads Markdown or HTML sets it,
// so a Markdown paragraph always has the default and saves as it did before RTF existed.
function alignments(doc: ProseNode): unknown[] {
  const found: unknown[] = []
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') found.push(node.attrs.align)
  })
  return found
}

test('pasted HTML alignment never reaches a Markdown paragraph', () =>
  withEditor(undefined, async ({ editor }) => {
    editor.loadDocument(input('md', 'First\n'))
    await editor.paste({
      text: 'Centre',
      html: '<p>Lead</p><p style="text-align:center" align="center">Centre</p><div style="text-align:right">Right</div>',
    })
    const view = ctxOf(editor).get(editorViewCtx)
    expect(alignments(view.state.doc).every((align) => align === null)).toBe(
      true,
    )
    const saved = editor.snapshot().text
    expect(saved).not.toMatch(/center|right|align/)
    editor.loadDocument(input('md', saved))
    expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
  }))

test('a Markdown paragraph is drawn without alignment and parses without one', () =>
  withEditor(undefined, ({ editor, root }) => {
    editor.loadDocument(input('md', 'One\n\nTwo\n'))
    const view = ctxOf(editor).get(editorViewCtx)
    expect(alignments(view.state.doc)).toEqual([null, null])
    expect(root.querySelector('p[style]')).toBeNull()
  }))
