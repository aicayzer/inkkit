import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/core'

async function open(
  text: string,
  run: (editor: InkKitEditor, root: HTMLElement) => void,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  editor.loadDocument({
    documentId: 'tasks',
    format: 'md',
    text,
    generation: 1,
  })
  try {
    run(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

for (const marker of ['-', '*', '+', '3.', '4)']) {
  for (const newline of ['\n', '\r\n']) {
    test(`${JSON.stringify(marker + newline)} task toggles preserve bytes and history`, () => {
      const source = `Before${newline}${newline}${marker} [ ] Café 🐈${newline}${newline}After  ${newline}`
      return open(source, (editor, root) => {
        expect(editor.find('Café 🐈')).toBe(true)
        expect(editor.commandState().commands.format.toggleTask).toBe(true)
        expect(editor.format('toggleTask')).toBe(true)
        const checked = source.replace('[ ]', '[x]')
        expect(editor.snapshot().text).toBe(checked)
        expect(
          root.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'),
        ).toBe('true')
        editor.undo()
        expect(editor.snapshot().text).toBe(source)
        editor.redo()
        expect(editor.snapshot().text).toBe(checked)
        expect(editor.format('toggleTask')).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        editor.loadDocument({
          documentId: 'reopened',
          format: 'md',
          text: editor.snapshot().text,
          generation: 2,
        })
        expect(editor.snapshot().text).toBe(source)
        expect(
          root.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'),
        ).toBe('false')
      })
    })

    test(`${JSON.stringify(marker + newline)} task-list formatting preserves markers`, () => {
      const source = `${marker} Café 🐈${newline}`
      return open(source, (editor) => {
        expect(editor.format('taskList')).toBe(true)
        const task = `${marker} [ ] Café 🐈${newline}`
        expect(editor.snapshot().text).toBe(task)
        editor.undo()
        expect(editor.snapshot().text).toBe(source)
        editor.redo()
        expect(editor.snapshot().text).toBe(task)
        expect(editor.format('taskList')).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        editor.loadDocument({
          documentId: 'reopened',
          format: 'md',
          text: task,
          generation: 2,
        })
        expect(editor.snapshot().text).toBe(task)
      })
    })
  }
}

test('task command has an optional shortcut and obeys mutation guards', () =>
  open('- [ ] Task\n', (editor, root) => {
    editor.setKeymap({ toggleTask: ['Ctrl-Enter'] })
    expect(editor.keyDown({ key: 'Enter', ctrlKey: true }, 1)).toBe(true)
    expect(editor.snapshot().text).toBe('- [x] Task\n')
    editor.setEditable(false)
    expect(editor.commandState().commands.format.toggleTask).toBe(false)
    expect(() => editor.format('toggleTask')).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    )
    const checkbox = root.querySelector<HTMLElement>('[role="checkbox"]')!
    expect(checkbox.getAttribute('aria-readonly')).toBe('true')
    checkbox.click()
    expect(editor.snapshot().text).toBe('- [x] Task\n')
    editor.setEditable(true)
    expect(() => editor.format('toggleTask', undefined, 0)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    const surface = root.querySelector<HTMLElement>('.ProseMirror')!
    surface.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(editor.commandState().commands.format.toggleTask).toBe(false)
    expect(() => editor.format('toggleTask')).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    checkbox.click()
    surface.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    expect(editor.snapshot().text).toBe('- [x] Task\n')
  }))

test('toggleTask uses the innermost task and does nothing elsewhere', () =>
  open('- [ ] Parent\n  - [ ] Child\n  - Ordinary\n\nAfter\n', (editor) => {
    editor.find('Child')
    editor.format('toggleTask')
    expect(editor.snapshot().text).toBe(
      '- [ ] Parent\n  - [x] Child\n  - Ordinary\n\nAfter\n',
    )
    for (const text of ['Ordinary', 'After']) {
      editor.find(text)
      expect(editor.commandState().commands.format.toggleTask).toBe(false)
      expect(editor.format('toggleTask')).toBe(false)
    }
  }))

test('checkboxes follow edits, list conversions, undo and document replacement', () =>
  open('Intro\n\n- [ ] First\n- [x] Second\n', (editor, root) => {
    const boxes = () =>
      [...root.querySelectorAll('[role="checkbox"]')].map((node) => [
        node.getAttribute('aria-label'),
        node.getAttribute('aria-checked'),
      ])
    editor.find('Intro')
    editor.insertText('Longer intro', 1)
    expect(boxes()).toEqual([
      ['First', 'false'],
      ['Second', 'true'],
    ])
    editor.find('First')
    editor.insertText('Edited 🐈', 1)
    expect(boxes()).toEqual([
      ['Edited 🐈', 'false'],
      ['Second', 'true'],
    ])
    editor.format('taskList')
    expect(boxes()).toEqual([['Second', 'true']])
    editor.undo()
    expect(boxes()).toEqual([
      ['Edited 🐈', 'false'],
      ['Second', 'true'],
    ])
    editor.redo()
    editor.format('taskList')
    expect(boxes()).toEqual([
      ['Edited 🐈', 'false'],
      ['Second', 'true'],
    ])
    const detached = root.querySelector<HTMLElement>('[role="checkbox"]')!
    editor.loadDocument({
      documentId: 'new',
      format: 'md',
      text: '- [ ] Replacement\n',
      generation: 2,
    })
    detached.click()
    expect(editor.snapshot().text).toBe('- [ ] Replacement\n')
    expect(boxes()).toEqual([['Replacement', 'false']])
  }))
