import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor } from '../src/index'
import { footnoteDefinitions, referenceDefinitions } from '../src/references'

const link = (text: string, referenceType: string) =>
  `<a href="https://example.com/reference" title="Shared title" data-inkkit-reference="authored" data-inkkit-label="Authored" data-inkkit-reference-type="${referenceType}" data-inkkit-reference-content='[{"type":"text","value":"${text}"}]'>${text}</a>`
const paragraph = `<p>A\u00a0<strong>bold</strong>\u00a0${link('shared link', 'full')} and ${link('Authored', 'collapsed')} with note<sup data-inkkit-footnote-reference="note" data-inkkit-label="Note">Note</sup>.</p>`
const definition = `<div data-inkkit-footnote-definition="note" data-inkkit-label="Note">[Note]\u00a0<p>Footnote body with ${link('nested', 'full')}.</p><p>Continued footnote paragraph.</p></div>`

for (const full of [true, false]) {
  test(`Mail ${full ? 'full' : 'partial'} HTML without the Markdown wrapper imports readable content`, async () => {
    await verifyImport(
      '',
      `<head><meta charset="UTF-8"></head>${full ? '<h1>Transfer</h1>' : ''}${paragraph}${full ? `<p>Repeated ${link('Authored', 'shortcut')}.</p>` : ''}${definition}`,
      full ? 4 : 3,
    )
  })
}

test('incomplete native reference metadata does not bind to destination definitions', async () => {
  await verifyImport(
    '[Authored]: /existing\n\n[^Note]: Existing body\n\nDestination\n',
    paragraph + definition,
    3,
  )
})

async function verifyImport(source: string, html: string, count: number) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  const input = { documentId: 'mail', generation: 1, format: 'md' as const }
  try {
    editor.loadDocument({ ...input, text: source })
    if (source) editor.find('Destination')
    await editor.paste({ text: 'Readable Mail content', html })
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const view = ctx.get(editorViewCtx)
    const targets = () => {
      const links: string[] = []
      view.state.doc.descendants((node) => {
        for (const mark of node.marks)
          if (mark.type.name === 'link') {
            expect(mark.attrs.identifier).toBeNull()
            links.push(mark.attrs.href)
          }
      })
      return links
    }
    const saved = editor.snapshot().text
    expect(targets()).toEqual(
      Array(count).fill('https://example.com/reference'),
    )
    expect(saved).toContain('with noteNote.')
    expect(saved).toContain(
      'Footnote body with [nested](https://example.com/reference "Shared title")',
    )
    expect(saved).toContain('Continued footnote paragraph.')
    expect(referenceDefinitions(view.state.doc).size).toBe(source ? 1 : 0)
    expect(footnoteDefinitions(view.state.doc).size).toBe(source ? 1 : 0)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(targets()).toEqual(
      Array(count).fill('https://example.com/reference'),
    )
    expect(editor.snapshot().text).toBe(saved)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
