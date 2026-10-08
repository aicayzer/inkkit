import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor } from '../src/editor'

async function run(
  source: string,
  action: (
    editor: InkKitEditor,
    ctx: Ctx,
    root: HTMLElement,
  ) => void | Promise<void>,
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
    editor.loadDocument({
      documentId: 'callouts',
      generation: 1,
      format: 'md',
      text: source,
    })
    await action(editor, ctx, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])(
  'supported %s callout edits immediately and preserves adjacent source',
  (kind) => {
    const source = `\uFEFF__Before__ &amp;\r\n\r\n> [!${kind}]\r\n> __Body__ &amp; next\r\n\r\nAfter\r\n`
    return run(source, (editor, ctx, root) => {
      expect(root.querySelector('[data-inkkit-callout]')).toBeTruthy()
      expect(editor.snapshot().text).toBe(source)
      editor.find('next')
      editor.insertText('edited', 1)
      expect(editor.snapshot().text).toBe(source.replace('next', 'edited'))
      undo(ctx.get(editorViewCtx).state, ctx.get(editorViewCtx).dispatch)
      expect(editor.snapshot().text).toBe(source)
    })
  },
)

test.each(['+', '-'])(
  'custom titles and adjacent %s fold marker survive edit, save/reopen and keyboard folding',
  (fold) => {
    const source = `> [!note]${fold} Custom title\n> Body text\n\n[Keep]: /unused\n`
    return run(source, async (editor, _ctx, root) => {
      const before = editor.snapshot()
      const button = root.querySelector<HTMLButtonElement>(
        '[data-inkkit-callout-toggle]',
      )!
      expect(button.getAttribute('aria-expanded')).toBe(String(fold !== '-'))
      button.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      expect(button.getAttribute('aria-expanded')).toBe(String(fold === '-'))
      expect(editor.snapshot()).toEqual(before)
      editor.find('Body')
      editor.insertText('Edited', 1)
      const saved = editor.snapshot().text
      expect(saved).toBe(source.replace('Body', 'Edited'))
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: saved,
      })
      expect(editor.snapshot().dirty).toBe(false)
      const copied = await editor.clipboardSnapshot()
      expect(copied.text).toContain('Custom title')
      expect(copied.text).toContain('Edited text')
      expect(copied.html).toContain('Edited text')
      expect(copied.html).not.toContain('<button')
      expect(copied.html).not.toContain('data-inkkit-folded')
    })
  },
)

test('an edit keeps continuation indentation and entity spelling inside quotes', () => {
  const source = '> [!NOTE]\n> First line\n>     second indent &amp; line\n'
  return run(source, (editor) => {
    editor.find('line')
    editor.insertText('edited', 1)
    expect(editor.snapshot().text).toBe(
      source.replace('First line', 'First edited'),
    )
  })
})

test('plain title entities render semantically while authored spelling survives body edits', () => {
  const source = '> [!NOTE]+ A &amp; B\n> Body\n'
  return run(source, async (editor, _ctx, root) => {
    expect(root.querySelector('.inkkit-callout-title')!.textContent).toBe(
      'A & B',
    )
    editor.find('Body')
    editor.insertText('Edited', 1)
    expect(editor.snapshot().text).toBe(source.replace('Body', 'Edited'))
    const copied = await editor.clipboardSnapshot()
    expect(copied.text).toContain('A & B')
  })
})

test('ordinary rich callout paste retains authored empty and entity title forms', async () => {
  for (const source of [
    '> [!NOTE]\n> Body\n',
    '> [!note]- A &amp; B\n> Body\n',
  ]) {
    await run(source, async (editor) => {
      const copied = await editor.clipboardSnapshot()
      editor.loadDocument({
        documentId: 'paste',
        generation: 2,
        format: 'md',
        text: '',
      })
      await editor.paste({ text: copied.text, html: copied.html })
      expect(editor.snapshot().text).toBe(source)
    })
  }
})

test('plain paste keeps Unicode and delimiter-looking text literal beside authored source', () =>
  run('__Before__ &amp;', async (editor) => {
    const text = '🙂%%literal%% ==text=='
    editor.pasteAsPlainText(text)
    const saved = editor.snapshot().text
    expect(saved.startsWith('__Before__ &amp;')).toBe(true)
    expect((await editor.clipboardSnapshot()).text).toBe(`Before &${text}`)
    editor.loadDocument({
      documentId: 'literal',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot().dirty).toBe(false)
    expect((await editor.clipboardSnapshot()).text).toBe(`Before &${text}`)
  }))

test.each([
  '> [!UNKNOWN]\n> Body\n',
  '> [!NOTE] - spaced marker\n> Body\n',
  '> [!NOTE]-- Title\n> Body\n',
  '> [!NOTE] **formatted title**\n> Body\n',
])('unsupported variant remains editable literal source: %s', (source) =>
  run(source, (editor, _ctx, root) => {
    expect(root.querySelector('[data-inkkit-callout]')).toBeNull()
    expect(root.querySelector('.literal-markdown')).toBeTruthy()
    editor.find('Body')
    editor.insertText('Changed', 1)
    expect(editor.snapshot().text).toBe(source.replace('Body', 'Changed'))
  }),
)

test('delimiter-looking footnote identifiers stay literal while body comments are hidden', () =>
  run(
    'Public[^a%%Label%%]\n\n[^a%%Label%%]: Body %%Hidden%%\n',
    async (editor, _ctx, root) => {
      expect(root.querySelectorAll('[data-inkkit-comment]').length).toBe(1)
      const before = await editor.clipboardSnapshot()
      editor.setCommentsVisible(true)
      const after = await editor.clipboardSnapshot()
      expect(after.text).toBe(before.text)
      expect(after.text).toContain('a%%Label%%')
      expect(after.html).not.toContain('Hidden')
      expect(after.markdown).toContain('%%Hidden%%')
    },
  ))
