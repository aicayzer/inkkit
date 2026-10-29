import { expect, test } from 'vitest'
import { InkKitEditor, type EditorOptions } from '../../src/core'
import { input, withEditor } from './harness'

test('an editor offers Markdown and TXT unless the host chooses', () =>
  withEditor(undefined, ({ editor }) => {
    expect(editor.formats).toEqual([
      { format: 'md', promise: 'exact' },
      { format: 'txt', promise: 'exact' },
    ])
    expect(Object.isFrozen(editor.formats)).toBe(true)
    expect(Object.isFrozen(editor.formats[0])).toBe(true)
    // The list is fixed at mount, so reading it twice gives the same list.
    expect(editor.formats).toBe(editor.formats)
  }))

test('null formats count as omitted', () =>
  withEditor({ formats: null } as unknown as EditorOptions, ({ editor }) => {
    expect(editor.formats.map((entry) => entry.format)).toEqual(['md', 'txt'])
  }))

test('the host chooses the formats and their order', () =>
  withEditor({ formats: ['txt', 'md'] }, ({ editor }) => {
    expect(editor.formats).toEqual([
      { format: 'txt', promise: 'exact' },
      { format: 'md', promise: 'exact' },
    ])
  }))

test('a host that offers one format can load only that format', () =>
  withEditor({ formats: ['txt'] }, ({ editor }) => {
    expect(editor.formats).toEqual([{ format: 'txt', promise: 'exact' }])
    expect(() => editor.loadDocument(input('md', '# Heading\n'))).toThrow(
      expect.objectContaining({
        code: 'invalid-argument',
        message: "input.format must be one of 'txt'",
      }),
    )
    // The refused load changed nothing: there is still no document.
    expect(() => editor.snapshot()).toThrow(
      expect.objectContaining({ code: 'not-ready' }),
    )
    editor.loadDocument(input('txt', '# Heading\n'))
    expect(editor.snapshot()).toMatchObject({
      format: 'txt',
      text: '# Heading\n',
    })
  }))

test('loading or reloading a format the host did not offer changes nothing', () =>
  withEditor({ formats: ['md'] }, ({ editor, changes, states }) => {
    const loaded = input('md', 'Line one\r\n\r\nLine two\r\n')
    editor.loadDocument(loaded)
    editor.setEditingMode('source')
    editor.replaceSource('Line one\r\n\r\nLine two, edited\r\n')
    const before = editor.snapshot()
    const sent = { changes: changes.length, states: states.length }
    for (const call of [
      () => editor.loadDocument(input('txt', 'Plain')),
      () => editor.reloadDocument(input('txt', 'Plain')),
      () => editor.reloadDocument(input('txt', 'Plain'), loaded.generation),
    ])
      expect(call).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
    expect(editor.snapshot()).toEqual(before)
    expect(editor.editingMode).toBe('source')
    expect(editor.commandState().commands.undo).toBe(true)
    expect({ changes: changes.length, states: states.length }).toEqual(sent)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(loaded.text)
  }))

test('a format list must name known formats once each', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  try {
    for (const formats of [
      [],
      ['rtf'],
      ['md', 'MD'],
      ['md', 'md'],
      ['txt', 'md', 'txt'],
      [null],
      'md',
      { 0: 'md', length: 1 },
    ])
      await expect(
        InkKitEditor.mount(root, { changed() {} }, {
          formats,
        } as unknown as EditorOptions),
      ).rejects.toMatchObject({ code: 'invalid-argument' })
    // A refused mount leaves the root as it was.
    expect(root.childElementCount).toBe(0)
  } finally {
    root.remove()
  }
})

test('the format list reads before the first load and throws once destroyed', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {} },
    { formats: ['md'] },
  )
  expect(editor.formats).toEqual([{ format: 'md', promise: 'exact' }])
  await editor.destroy()
  root.remove()
  expect(() => editor.formats).toThrow(
    expect.objectContaining({ code: 'destroyed' }),
  )
})
