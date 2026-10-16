import { afterEach, expect, test } from 'vitest'
import { InkKitEditor, type EditorOptions } from '../src/index'

const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})
async function mount(
  text: string,
  options: EditorOptions = { slashMenu: { enabled: true } },
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: unknown[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (e) => errors.push(e) },
    options,
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'slash',
    generation: 1,
    format: 'md',
    text,
  })
  return { editor, root, errors }
}
const commands = [
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Bulleted List',
  'Numbered List',
  'Checklist',
  'Quote',
  'Code Block',
  'Table',
  'Callout',
  'Divider',
  'Diagram',
]
for (const ending of ['\n', '\r\n']) {
  for (const [name, body] of Object.entries({
    paragraph: 'TARGET',
    list: '* TARGET',
    quote: '> TARGET',
    callout: '> [!TIP]\n> TARGET',
  })) {
    for (const command of commands)
      test(`${name} ${JSON.stringify(ending)}: ${command} saves, reopens, undoes and redoes`, async () => {
        const source = `Before  \n\n${body}\n\nAfter _unchanged_.\n`.replaceAll(
          '\n',
          ending,
        )
        const { editor, root, errors } = await mount(source)
        editor.find('TARGET')
        editor.insertText('', 1)
        const before = editor.snapshot().text
        editor.insertText('/', 1)
        expect(root.querySelector('[role=listbox]')).not.toBeNull()
        const row = [...root.querySelectorAll('[role=option]')].find(
          (el) => el.textContent === command,
        )
        expect(row, command).toBeDefined()
        row!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        if (command === 'Callout') {
          const note = [...root.querySelectorAll('[role=option]')].find(
            (el) => el.textContent === 'Note',
          )!
          note.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
        expect(errors).toEqual([])
        const selectors: Record<string, string> = {
          'Heading 1': 'h1',
          'Heading 2': 'h2',
          'Heading 3': 'h3',
          'Bulleted List': 'ul',
          'Numbered List': 'ol',
          Checklist: 'li[data-item-type="task"]',
          Quote: 'blockquote',
          'Code Block': 'pre',
          Table: 'table',
          Callout: '.inkkit-callout',
          Divider: 'hr',
          Diagram: 'pre',
        }
        expect(root.querySelector(selectors[command]!)).not.toBeNull()
        const saved = editor.snapshot().text
        expect(saved).toMatchSnapshot()
        expect(editor.textSnapshot().text).not.toContain('/')
        expect(saved.startsWith(`Before  ${ending}${ending}`)).toBe(true)
        expect(
          saved.endsWith(`${ending}${ending}After _unchanged_.${ending}`),
        ).toBe(true)
        expect(saved.replaceAll('\r\n', '')).not.toContain(
          ending === '\r\n' ? '\n' : '\r',
        )
        const reader = await mount(saved)
        expect(reader.editor.snapshot().text).toBe(saved)
        expect(reader.root.querySelector(selectors[command]!)).not.toBeNull()
        expect(reader.editor.textSnapshot().text).toBe(
          editor.textSnapshot().text,
        )
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(before)
        expect(editor.redo()).toBe(true)
        expect(editor.snapshot().text).toBe(saved)
      })
  }
}

test('off by default; enabling and command names are validated', async () => {
  const { editor, root } = await mount('', {})
  editor.insertText('/', 1)
  expect(root.querySelector('[role=listbox]')).toBeNull()
  for (const slashMenu of [
    { enabled: 'yes' },
    { enabled: true, commands: ['typo'] },
    { enabled: true, unknown: true },
  ]) {
    await expect(mount('', { slashMenu } as never)).rejects.toMatchObject({
      code: 'invalid-argument',
    })
  }
})

test('an unrelated host edit closes the menu and cannot be rolled back', async () => {
  const { editor, root } = await mount('Before\n\nTARGET\n')
  editor.find('TARGET')
  editor.insertText('', 1)
  editor.insertText('/', 1)
  expect(root.querySelector('[role=listbox]')).not.toBeNull()
  editor.replaceAll('Before', 'Update')
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toContain('Update')
})
test('presentation changes close the menu without restoring old policy', async () => {
  const { editor, root } = await mount('%%hidden%%\n\nTARGET\n')
  editor.find('TARGET')
  editor.insertText('', 1)
  editor.insertText('/', 1)
  editor.setCommentsVisible(true)
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toContain('%%hidden%%')
})

for (const context of ['heading', 'hard break']) {
  test(`opens on an empty ${context} line and keeps preceding content through undo and redo`, async () => {
    const { editor, root, errors } = await mount(
      context === 'heading'
        ? '## TARGET\r\n\r\nAfter _kept_.\r\n'
        : 'Before lineTARGET\r\n\r\nAfter _kept_.\r\n',
    )
    editor.find('TARGET')
    editor.insertText('', 1)
    if (context === 'hard break')
      editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
    const before = editor.snapshot().text
    editor.insertText('/', 1)
    editor.insertText('h1', 1)
    expect(root.querySelector('[role=listbox]')).not.toBeNull()
    editor.keyDown({ key: 'Enter' }, 1)
    expect(root.querySelector('h1')).not.toBeNull()
    const saved = editor.snapshot().text
    if (context === 'hard break') expect(saved).toContain('Before line')
    expect(saved).toContain('After _kept_.\r\n')
    expect(errors).toEqual([])
    editor.undo()
    expect(editor.snapshot().text).toBe(before)
    editor.redo()
    expect(editor.snapshot().text).toBe(saved)
  })
}

test('the combobox does not keep textbox-only attributes and an empty result has valid listbox structure', async () => {
  const { editor, root } = await mount('')
  editor.insertText('/', 1)
  expect(
    root.querySelector('[role=combobox]')?.hasAttribute('aria-multiline'),
  ).toBe(false)
  editor.insertText('no-such-command', 1)
  expect(
    root.querySelector('[role=listbox] [role=option][aria-disabled=true]')
      ?.textContent,
  ).toBe('No matches')
  editor.keyDown({ key: 'Escape' }, 1)
  expect(
    root.querySelector('[role=textbox]')?.getAttribute('aria-multiline'),
  ).toBe('true')
})

test('typing after a divider uses a new paragraph and leaves the following block alone', async () => {
  const { editor, root } = await mount('Before\n\nTARGET\n\nAfter\n')
  editor.find('TARGET')
  editor.insertText('', 1)
  editor.insertText('/', 1)
  editor.insertText('divider', 1)
  editor.keyDown({ key: 'Enter' }, 1)
  const divided = editor.snapshot().text
  editor.insertText('New', 1)
  expect(editor.snapshot().text).toBe('Before\n\n---\n\nNew\n\nAfter\n')
  expect(root.querySelector('hr')).not.toBeNull()
  editor.undo()
  expect(editor.snapshot().text).toBe(divided)
})
