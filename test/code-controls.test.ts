import { withInputTimers } from './timing'
import { expect, test, vi } from 'vitest'
import { InkKitEditor } from '../src/index'

async function note(
  run: (
    editor: InkKitEditor,
    root: HTMLElement,
    errors: Error[],
  ) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    error: (error) => errors.push(error),
  })
  try {
    await run(editor, root, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const load = (editor: InkKitEditor, text: string, generation = 1) =>
  editor.loadDocument({
    documentId: 'code-controls',
    format: 'md',
    generation,
    text,
  })
function choose(root: HTMLElement, name: string) {
  root.querySelector<HTMLButtonElement>('.inkkit-code-language')!.click()
  const input = root.querySelector<HTMLInputElement>(
    '.inkkit-code-language-menu input',
  )!
  input.value = name
  input.dispatchEvent(new Event('input'))
  const option = [
    ...root.querySelectorAll<HTMLButtonElement>(
      '.inkkit-code-language-list button',
    ),
  ].find((button) => button.textContent === name)!
  expect(option).toBeDefined()
  option.click()
}

test('language selection preserves code bytes, CRLF, fence metadata and neighbours through save and reopen', () =>
  note((editor, root, errors) => {
    const source =
      'Before **bold**\r\n\r\n~~~~ js title="héllo"\r\nconst café = "☕"\r\nline two\r\n~~~~~  \r\n\r\nAfter _word_\r\n'
    load(editor, source)
    choose(root, 'TypeScript')
    const changed = source.replace('~~~~ js title=', '~~~~ typescript title=')
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe(changed)
    editor.undo()
    expect(editor.snapshot().text).toBe(source)
    editor.redo()
    expect(editor.snapshot().text).toBe(changed)
    load(editor, changed, 2)
    expect(editor.snapshot().text).toBe(changed)
  }))

test('unknown authored languages remain unchanged; search offers common languages and explicit plain text', () =>
  note((editor, root, errors) => {
    const source = '```strange-language\nhello\n```\n'
    load(editor, source)
    expect(root.querySelector('.inkkit-code-language')!.textContent).toBe(
      'strange-language',
    )
    expect(editor.snapshot().text).toBe(source)
    choose(root, 'Plain text')
    expect(root.querySelector('.inkkit-code-language')!.textContent).toBe(
      'Plain text',
    )
    expect(editor.snapshot().text).toBe(
      source.replace('strange-language', 'text'),
    )
    choose(root, 'Auto')
    expect(editor.snapshot().text).toBe(source.replace('strange-language', ''))
    expect(errors).toEqual([])
  }))

test('a changed document closes an open language menu without changing the replacement document', () =>
  note((editor, root, errors) => {
    load(editor, '```js\nlet x = 1\n```\n')
    root.querySelector<HTMLButtonElement>('.inkkit-code-language')!.click()
    const stale = [
      ...root.querySelectorAll<HTMLButtonElement>(
        '.inkkit-code-language-list button',
      ),
    ].find((button) => button.textContent === 'Bash')!
    load(editor, '```python\nprint(1)\n```\n', 2)
    stale.click()
    expect(editor.snapshot().text).toBe('```python\nprint(1)\n```\n')
    expect(errors).toEqual([])
  }))

test('composition prevents a language edit and leaves source intact', () =>
  note(async (editor, root, errors) => {
    const source = '```js\nlet x = 1\n```\n'
    load(editor, source)
    await withInputTimers(() => {
      root
        .querySelector('.ProseMirror')!
        .dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true }),
        )
      choose(root, 'Bash')
      expect(errors.length).toBeGreaterThan(0)
      root
        .querySelector('.ProseMirror')!
        .dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true }),
        )
    })
    expect(editor.snapshot().text).toBe(source)
  }))

test('read-only prevents a language edit without changing source', () =>
  note((editor, root, errors) => {
    const source = '```js\nlet x = 1\n```\n'
    load(editor, source)
    editor.setEditable(false)
    choose(root, 'Bash')
    expect(editor.snapshot().text).toBe(source)
    expect(errors.length).toBeGreaterThan(0)
  }))

test('copy contains code only, excluding the language controls', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const copy = vi.fn()
  const editor = await InkKitEditor.mount(root, { changed() {}, copy })
  try {
    load(editor, '```js\nconst café = 1\n```\n')
    root.querySelector<HTMLButtonElement>('.inkkit-code-language')!.click()
    root.querySelector<HTMLButtonElement>('.inkkit-copy')!.click()
    expect(copy).toHaveBeenCalledWith('const café = 1')
  } finally {
    await editor.destroy()
    root.remove()
  }
})
