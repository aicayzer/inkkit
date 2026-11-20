import { describe, expect, test } from 'vitest'
import { InkKitEditor } from '../src/index'
import type { TextInputPreferences } from '../src/core'
import {
  doc,
  para,
  rich,
  richSnapshot,
  select as selectRich,
  withRichEditor,
} from './formats/rtf/harness'

interface Clipboard {
  text?: string
  html?: string
  markdown?: string
}

async function session(
  source: string,
  textInput: TextInputPreferences | undefined,
  run: (editor: InkKitEditor, root: HTMLElement, errors: Error[]) => unknown,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {}, error: (e) => errors.push(e) },
    { textInput },
  )
  try {
    editor.loadDocument({
      documentId: 'paste-route',
      generation: 1,
      format: 'md',
      text: source,
    })
    await run(editor, root, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function selectTarget(editor: InkKitEditor) {
  const snapshot = editor.textSnapshot()
  const from = snapshot.text.indexOf('target')
  expect(from).toBeGreaterThanOrEqual(0)
  editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from,
    to: from + 6,
  })
}

function pasteEvent(target: Element, clipboard: Clipboard) {
  const types = Object.entries({
    'text/plain': clipboard.text,
    'text/html': clipboard.html,
    'text/markdown': clipboard.markdown,
  }).filter(([, value]) => value != null)
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        types.find(([name]) => name === type)?.[1] ?? '',
      files: [],
      types: types.map(([name]) => name),
      items: [],
    },
  })
  target.dispatchEvent(event)
}

const formattedSurface = (root: HTMLElement) =>
  root.querySelector('[contenteditable]')!
const sourceSurface = (root: HTMLElement) =>
  root.querySelector('textarea.inkkit-plain')!

const clipboard = {
  text: '**not bold** and <b>tag</b>\nnext',
  html: '<p><b>Bold</b> <a href="https://example.com">link</a></p><ul><li>item</li></ul>',
}

async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
}

/** The bytes `pasteAsPlainText` saves for `text` over the selected `target`. */
async function literal(source: string, text: string, mode = 'formatted') {
  let saved = ''
  await session(source, undefined, (editor) => {
    if (mode === 'source') editor.setEditingMode('source')
    selectTarget(editor)
    editor.pasteAsPlainText(text, 1)
    saved = editor.snapshot().text
  })
  return saved
}

describe('the plainText paste route', () => {
  for (const source of [
    'before\n\n**target**\n\nafter\n',
    'before\r\n\r\n- target\r\n- two\r\n',
    'α\n\n| H |\n| - |\n| target |\n',
  ])
    test(`a paste event inserts the plain text literally in formatted mode: ${JSON.stringify(source)}`, async () => {
      const expected = await literal(source, clipboard.text)
      await session(source, { paste: 'plainText' }, async (editor, root) => {
        selectTarget(editor)
        pasteEvent(formattedSurface(root), clipboard)
        await settle()
        expect(editor.snapshot().text).toBe(expected)
        editor.undo()
        expect(editor.snapshot().text).toBe(source)
      })
    })

  test('the formatted route still imports HTML', async () => {
    await session('target\n', undefined, async (editor, root) => {
      selectTarget(editor)
      pasteEvent(formattedSurface(root), clipboard)
      await settle()
      const saved = editor.snapshot().text
      expect(saved).toContain('**Bold**')
      expect(saved).toContain('[link](https://example.com)')
    })
  })

  test('paste() follows the route in formatted mode', async () => {
    const source = 'before\n\ntarget\n'
    const expected = await literal(source, clipboard.text)
    await session(source, { paste: 'plainText' }, async (editor) => {
      selectTarget(editor)
      await editor.paste({ ...clipboard, markdown: '# Heading' }, 1)
      expect(editor.snapshot().text).toBe(expected)
    })
  })

  test('source mode inserts the plain text instead of the Markdown representation', async () => {
    const source = 'before\r\n\r\ntarget\r\n'
    const clipboard = { text: 'plain *one*\ntwo', markdown: '# Markdown' }
    const expected = await literal(source, clipboard.text, 'source')
    await session(source, { paste: 'plainText' }, async (editor, root) => {
      editor.setEditingMode('source')
      selectTarget(editor)
      pasteEvent(sourceSurface(root), clipboard)
      await settle()
      expect(editor.snapshot().text).toBe(expected)
    })
    await session(source, undefined, async (editor) => {
      editor.setEditingMode('source')
      selectTarget(editor)
      await editor.paste(clipboard, 1)
      expect(editor.snapshot().text).toBe('before\r\n\r\n# Markdown\r\n')
    })
  })

  test('a paste with no plain text keeps the formatted route', async () => {
    for (const textInput of [undefined, { paste: 'plainText' as const }]) {
      await session('target\n', textInput, async (editor) => {
        selectTarget(editor)
        await expect(
          editor.paste(
            {
              text: '',
              images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
            },
            1,
          ),
        ).rejects.toMatchObject({ code: 'image-unsupported' })
        expect(editor.snapshot().text).toBe('target\n')
      })
    }
  })

  test('a code block still receives the text literally', async () => {
    const source = '```js\nlet target = 1\n```\n'
    await session(source, { paste: 'plainText' }, async (editor, root) => {
      selectTarget(editor)
      pasteEvent(formattedSurface(root), { text: '**x**', html: '<b>x</b>' })
      await settle()
      expect(editor.snapshot().text).toBe('```js\nlet **x** = 1\n```\n')
    })
  })

  test('setTextInputPreferences switches the route, and leaving it out restores formatted', async () => {
    await session('target\n', undefined, async (editor, root) => {
      editor.setTextInputPreferences({ paste: 'plainText' })
      selectTarget(editor)
      pasteEvent(formattedSurface(root), { text: '**a**', html: '<b>a</b>' })
      await settle()
      expect(editor.snapshot().text).toBe('\\*\\*a\\*\\*\n')
      editor.setTextInputPreferences({})
      const snapshot = editor.textSnapshot()
      editor.selectTextRange({
        snapshotId: snapshot.snapshotId,
        from: 0,
        to: snapshot.text.length,
      })
      pasteEvent(formattedSurface(root), { text: 'b', html: '<b>b</b>' })
      await settle()
      expect(editor.snapshot().text).toBe('**b**\n')
    })
  })

  test('read-only, composition and stale generations change nothing', async () => {
    await session('target\n', { paste: 'plainText' }, async (editor, root) => {
      selectTarget(editor)
      editor.setEditable(false)
      pasteEvent(formattedSurface(root), { text: 'x', html: '<b>x</b>' })
      await settle()
      await expect(editor.paste({ text: 'x' }, 1)).rejects.toMatchObject({
        code: 'read-only',
      })
      editor.setEditable(true)
      await expect(editor.paste({ text: 'x' }, 2)).rejects.toMatchObject({
        code: 'stale-document',
      })
      const view = editor['editor'].ctx.get(
        (await import('@milkdown/kit/core')).editorViewCtx,
      )
      view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
      await expect(editor.paste({ text: 'x' }, 1)).rejects.toMatchObject({
        code: 'composition',
      })
      view.dom.dispatchEvent(new CompositionEvent('compositionend'))
      expect(editor.snapshot().text).toBe('target\n')
    })
  })

  test('an unknown route is refused', async () => {
    await session('target\n', undefined, (editor) => {
      for (const paste of ['markdown', '', true, 1])
        expect(() =>
          editor.setTextInputPreferences({ paste } as never),
        ).toThrowError(expect.objectContaining({ code: 'invalid-argument' }))
    })
    await expect(
      InkKitEditor.mount(
        document.createElement('div'),
        { changed() {} },
        { textInput: { paste: 'plain' as never } },
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

describe('the plainText paste route in RTF', () => {
  test('HTML pastes as its plain text, without formatting', () =>
    withRichEditor(
      { textInput: { paste: 'plainText' } },
      async ({ editor, root }) => {
        editor.loadDocument(rich(doc(para('ab'))))
        selectRich(editor, 'ab', { caret: 'end' })
        pasteEvent(formattedSurface(root), { text: 'x', html: '<b>x</b>' })
        await settle()
        expect(richSnapshot(editor).document).toEqual(doc(para('abx')))
      },
    ))
})
