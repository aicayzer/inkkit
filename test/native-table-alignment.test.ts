import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor } from '../src/index'
import { normalizeTableAlignment } from '../src/table-alignment'

const input = {
  documentId: 'native-table',
  generation: 1,
  format: 'md' as const,
}
async function run(
  html: string,
  alignment: 'left' | 'right' | null,
  text = 'head',
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument({ ...input, text: '' })
    await editor.paste({ text: `${text}\ncell`, html })
    const view = ctx.get(editorViewCtx)
    const before = view.state.doc.toJSON()
    const saved = editor.snapshot().text
    const cells: { alignment: string | null; text: string }[] = []
    view.state.doc.descendants((node) => {
      if (['table_header', 'table_cell'].includes(node.type.name))
        cells.push({ alignment: node.attrs.alignment, text: node.textContent })
    })
    expect(cells).toEqual([
      { alignment, text },
      { alignment, text: 'cell' },
    ])
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe('')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(editor.snapshot().text).toBe(saved)
    expect(view.state.doc.toJSON()).toEqual(before)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

// Reduced from the disposable Obsidian WKWebView clipboard return.
const obsidian =
  '<meta charset="utf-8"><div class="el-h1"><h1>InkKit 0.0.6 transfer</h1></div><div class="el-table"><table><thead><tr><th dir="ltr" style="text-align: start">head</th></tr></thead><tbody><tr><td dir="auto" style="text-align: start">cell</td></tr></tbody></table></div><p>After surrounding text.</p>'
test('native Obsidian mixed HTML logical alignment survives save, reopen and undo', () =>
  run(obsidian, 'left'))

test.each([
  ['start', 'rtl', 'head', 'right'],
  ['end', 'rtl', 'head', 'left'],
  ['start', 'ltr', 'head', 'left'],
  ['end', 'ltr', 'head', 'right'],
  ['justify', 'ltr', 'head', null],
] as const)(
  'mixed clipboard alignment %s inherits direction %s without corrupting cells',
  (align, dir, text, expected) =>
    run(
      `<div dir="${dir}"><p>Before</p><table><tr><th style="text-align:${align}">${text}</th></tr><tr><td style="text-align:${align}">cell</td></tr></table></div>`,
      expected,
      text,
    ),
)

test.each([
  [
    '<table><tr><td dir="auto" style="text-align:start"> 123 שלום</td></tr></table>',
    'right',
  ],
  [
    '<table><tr><td dir="auto" style="text-align:end"> 123 مرحبا</td></tr></table>',
    'left',
  ],
  [
    '<table><tr><td dir="auto" style="text-align:start"> 123 Latin שלום</td></tr></table>',
    'left',
  ],
  [
    '<table><tr><td dir="auto" style="text-align:start"></td></tr></table>',
    'left',
  ],
  [
    '<table dir="rtl"><tr><td dir="auto" style="text-align:start"></td></tr></table>',
    'right',
  ],
  [
    '<table dir="rtl"><tr><td style="direction:ltr;text-align:start">שלום</td></tr></table>',
    'left',
  ],
  ['<table><tr><td align="CENTER">head</td></tr></table>', 'center'],
] as const)(
  'logical alignment normalisation reads direction and first meaningful letter: %s',
  (html, expected) => {
    const template = document.createElement('template')
    template.innerHTML = html
    expect(normalizeTableAlignment(template.content.querySelector('td')!)).toBe(
      expected,
    )
  },
)

test('standalone spreadsheet logical alignment uses the same direction rules', () =>
  run(
    '<table dir="rtl"><tr><th style="text-align:start">head</th></tr><tr><td style="text-align:start">cell</td></tr></table>',
    'right',
  ))
