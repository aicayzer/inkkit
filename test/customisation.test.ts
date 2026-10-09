import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { tableBlockConfig } from '@milkdown/kit/component/table-block'
import { InkKitEditor } from '../src/index'
import { tableAvailability, tableContext, tableCommands } from '../src/tables'
import type { EditorLabels } from '../src/labels'

const events = { changed() {}, stateChanged() {}, openLink() {}, copy() {} }
const input = { documentId: 'custom', generation: 1, format: 'md' as const }
async function mount(labels: Partial<EditorLabels> = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, events, { labels })
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  return {
    root,
    editor,
    ctx,
    async destroy() {
      await editor.destroy()
      root.remove()
    },
  }
}

test('labels are per editor, safely inserted and do not change authored source', async () => {
  const malicious = '<img src=x onerror="alert(1)">'
  const one = await mount({
    copyCode: malicious,
    expandCallout: malicious,
    footnote: malicious,
    tableAddRow: malicious,
  })
  const two = await mount()
  try {
    const text =
      '```txt\nHello\n```\n\n> [!NOTE]- Folded\n> body\n\nFootnote[^a]\n\n[^a]: note'
    one.editor.loadDocument({ ...input, text })
    two.editor.loadDocument({ ...input, text })
    expect(one.root.classList.contains('inkkit-root')).toBe(true)
    expect(one.root.querySelector('.copy')?.getAttribute('aria-label')).toBe(
      malicious,
    )
    expect(two.root.querySelector('.copy')?.getAttribute('aria-label')).toBe(
      'Copy',
    )
    const toggle = one.root.querySelector<HTMLButtonElement>(
      '[data-inkkit-callout-toggle]',
    )!
    expect(toggle.textContent).toBe(malicious)
    expect(toggle.getAttribute('aria-label')).toBe(`${malicious} Folded`)
    toggle.click()
    expect(toggle.textContent).toBe('Collapse')
    expect(
      one.root
        .querySelector('.inkkit-footnote-reference')
        ?.getAttribute('aria-label'),
    ).toBe(`${malicious} a`)
    const markup = one.ctx.get(tableBlockConfig.key).renderButton('add_row')
    const holder = document.createElement('div')
    holder.innerHTML = markup
    expect(holder.textContent).toBe(malicious)
    expect(holder.querySelector('img')).toBeNull()
    expect(holder.firstElementChild?.getAttribute('aria-label')).toBe(malicious)
    expect(one.root.querySelector('img[onerror]')).toBeNull()
    expect(one.editor.snapshot()).toMatchObject({
      text,
      revision: 0,
      dirty: false,
    })
  } finally {
    await one.destroy()
    await two.destroy()
  }
})

test('placeholder and surface names use mount labels', async () => {
  const instance = await mount({
    placeholder: 'Write here',
    formattedEditor: 'Markdown',
    sourceEditor: 'Source',
    plainTextEditor: 'Text',
  })
  try {
    instance.editor.loadDocument({ ...input, text: '' })
    expect(
      instance.root
        .querySelector('[data-placeholder]')
        ?.getAttribute('data-placeholder'),
    ).toBe('Write here')
    expect(
      instance.root.querySelector('.ProseMirror')?.getAttribute('aria-label'),
    ).toBe('Markdown')
    instance.editor.setEditingMode('source')
    expect(
      instance.root.querySelector('textarea')?.getAttribute('aria-label'),
    ).toBe('Source')
    instance.editor.loadDocument({
      ...input,
      generation: 2,
      format: 'txt',
      text: 'Plain',
    })
    expect(
      instance.root.querySelector('textarea')?.getAttribute('aria-label'),
    ).toBe('Text')
  } finally {
    await instance.destroy()
  }
})

test('diagram status uses labels and retains diagnostics as plain text', async () => {
  const instance = await mount({
    diagramRendering: 'Drawing',
    diagramUnavailable: 'Unavailable:',
  })
  try {
    instance.editor.loadDocument({
      ...input,
      text: '```mermaid\nunsupported x\n```',
    })
    const preview = instance.root.querySelector('.inkkit-mermaid-preview')!
    expect(preview.textContent).toBe('Drawing')
    await Promise.resolve()
    expect(preview.textContent).toContain('Unavailable:')
    expect(preview.getAttribute('role')).toBe('status')
    expect(instance.editor.snapshot().dirty).toBe(false)
  } finally {
    await instance.destroy()
  }
})

test('table availability reports boundaries without mutation or history changes', async () => {
  const instance = await mount()
  try {
    const text = '| Key | Value |\n| --- | --- |\n| z | 2 |\n| a | 1 |\n'
    instance.editor.loadDocument({ ...input, text })
    const view = instance.ctx.get(editorViewCtx)
    let body = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table_cell' && body < 0) body = pos + 2
    })
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, body)),
    )
    const before = instance.editor.snapshot()
    const selection = view.state.selection.toJSON()
    const state = tableAvailability(instance.ctx)
    expect(Object.keys(state)).toEqual(tableCommands)
    expect(tableContext(view.state)).toEqual({
      row: 1,
      column: 0,
      rows: 3,
      columns: 2,
    })
    expect(state).toMatchObject({
      moveRowUp: false,
      moveRowDown: true,
      moveColumnLeft: false,
      moveColumnRight: true,
      sortRows: true,
    })
    expect(instance.editor.snapshot()).toEqual(before)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(instance.editor.undo()).toBe(false)
  } finally {
    await instance.destroy()
  }
})

test('package CSS scopes every selector including upstream table styles', () => {
  const css = readFileSync('src/style.css', 'utf8')
  const sheet = document.createElement('style')
  sheet.textContent = css
  document.head.append(sheet)
  try {
    function check(rules: CSSRuleList) {
      for (const rule of Array.from(rules)) {
        if ('selectorText' in rule) {
          const selectors = String(rule.selectorText).split(',')
          expect(
            selectors.every((selector) => selector.includes('.inkkit-root')),
          ).toBe(true)
        } else if ('cssRules' in rule) check(rule.cssRules as CSSRuleList)
      }
    }
    check(sheet.sheet!.cssRules)
    expect(css).not.toContain('@import')
    expect(css).not.toContain(':root')
  } finally {
    sheet.remove()
  }
})
