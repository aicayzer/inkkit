import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor } from '../src/index'

for (const spacing of [
  ' ',
  ' &#x20;',
  ' &#32;',
  ' &#x0020;',
  '&#x20;',
  '&#32;',
]) {
  test(`reference replacement preserves newly exposed whitespace with authored entities: ${JSON.stringify(spacing)}`, async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
    })
    const input = {
      documentId: 'boundary',
      generation: 1,
      format: 'md' as const,
    }
    const source = `[Destination][Original]${spacing}and [Retained][Original]\n\n[Original]: /destination\n`
    try {
      editor.loadDocument({ ...input, text: source })
      editor.find('Destination')
      await editor.paste({
        text: 'ignored',
        markdown: '[Revised][Original]\n\n[Original]: /incoming\n',
      })
      const saved = editor.snapshot().text
      const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
      const view = ctx.get(editorViewCtx)
      const paragraphs: string[] = []
      view.state.doc.forEach((node) => {
        if (node.type.name === 'paragraph') paragraphs.push(node.textContent)
      })
      expect(paragraphs).toContain(
        `${spacing.replace(/&#(?:x0020|x20|32);/g, ' ')}and Retained`,
      )
      const preserved = spacing.startsWith(' ')
        ? `&#x20;${spacing.slice(1)}`
        : spacing
      expect(saved).toContain(`${preserved}and [Retained][Original]`)
      undo(view.state, view.dispatch)
      expect(editor.snapshot().text).toBe(source)
      editor.loadDocument({ ...input, generation: 2, text: saved })
      const reopened: string[] = []
      view.state.doc.forEach((node) => {
        if (node.type.name === 'paragraph') reopened.push(node.textContent)
      })
      expect(reopened).toEqual(paragraphs)
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
}

test('an authored space entity before a newly exposed trailing space is not duplicated', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  const input = {
    documentId: 'trailing-boundary',
    generation: 1,
    format: 'md' as const,
  }
  const source =
    '[Retained][Original] and&#x20; [Destination][Original]\n\n[Original]: /destination\n'
  try {
    editor.loadDocument({ ...input, text: source })
    editor.find('Destination')
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.deleteSelection())
    const saved = editor.snapshot().text
    expect(saved).toContain('[Retained][Original] and&#x20;&#x20;')
    const paragraphs: string[] = []
    view.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph') paragraphs.push(node.textContent)
    })
    expect(paragraphs).toContain('Retained and  ')
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    editor.loadDocument({ ...input, generation: 2, text: saved })
    const reopened: string[] = []
    view.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph') reopened.push(node.textContent)
    })
    expect(reopened).toEqual(paragraphs)
  } finally {
    await editor.destroy()
    root.remove()
  }
})
