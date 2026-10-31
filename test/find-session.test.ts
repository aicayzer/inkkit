import { expect, test } from 'vitest'
import {
  InkKitEditor,
  type DocumentInput,
  type FindSession,
  type FindState,
} from '../src/core'

const input: DocumentInput = {
  documentId: 'find',
  generation: 1,
  format: 'md',
  text: 'One cat, two cats.\r\n\r\n**Cat** and CAT.\r\n',
}

async function run(
  body: (
    editor: InkKitEditor,
    session: FindSession,
    states: FindState[],
  ) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, { changed() {} })
  const states: FindState[] = []
  try {
    editor.loadDocument(input)
    const session = editor.findSession((state) => states.push(state))
    await body(editor, session, states)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const position = (session: FindSession) => {
  const { current, total } = session.state()
  return [current, total]
}

test('find reports the count and selects the first match at or after the selection', () =>
  run((editor, session, states) => {
    expect(session.state()).toMatchObject({
      query: '',
      current: 0,
      total: 0,
      documentId: 'find',
      generation: 1,
    })
    expect(session.find('cat')).toBe(true)
    expect(position(session)).toEqual([1, 4])
    expect(states.at(-1)).toMatchObject({ query: 'cat', current: 1, total: 4 })
    expect(session.find('absent')).toBe(false)
    expect(states.at(-1)).toMatchObject({ current: 0, total: 0 })
    // The editor's own selection is on the first match, so the count is not an index of text.
    expect(editor.snapshot().text).toBe(input.text)
  }))

test('next and previous wrap, and the handler hears only changes', () =>
  run((_editor, session, states) => {
    session.find('cat')
    for (const expected of [2, 3, 4, 1]) {
      expect(session.next()).toBe(true)
      expect(session.state().current).toBe(expected)
    }
    expect(session.previous()).toBe(true)
    expect(session.state().current).toBe(4)
    // Stepping reports each distinct position once, with no intermediate states.
    expect(states.map((state) => state.current)).toEqual([1, 2, 3, 4, 1, 4])
    expect(session.find('cat')).toBe(true)
    expect(session.state().current).toBe(4)
    expect(states).toHaveLength(6)
  }))

test('a new query starting in the middle chooses by direction', () =>
  run((_editor, session) => {
    session.find('cat')
    session.next()
    session.next()
    expect(session.find('cats', { direction: 'previous' })).toBe(true)
    expect(position(session)).toEqual([1, 1])
    expect(session.find('t', { direction: 'previous' })).toBe(true)
    // The last match that ends before the selection, wrapping to the last overall.
    const { total, current } = session.state()
    expect(current).toBeGreaterThan(0)
    expect(current).toBeLessThanOrEqual(total)
  }))

test('replace changes one match, advances and reports the new count', () =>
  run((editor, session, states) => {
    session.find('cat')
    expect(session.replace('cat', 'dog')).toBe(true)
    expect(editor.snapshot().text).toBe(
      'One dog, two cats.\r\n\r\n**Cat** and CAT.\r\n',
    )
    expect(states.at(-1)).toMatchObject({ query: 'cat', total: 3, current: 1 })
    expect(
      editor
        .textSnapshot()
        .text.slice(
          editor.textSnapshot().selection.from,
          editor.textSnapshot().selection.to,
        ),
    ).toBe('cat')
    expect(session.replace('cat', 'dog')).toBe(true)
    expect(session.replace('cat', 'dog')).toBe(true)
    expect(session.replace('cat', 'dog')).toBe(true)
    expect(editor.snapshot().text).toBe(
      'One dog, two dogs.\r\n\r\n**dog** and dog.\r\n',
    )
    expect(session.state().total).toBe(0)
    expect(session.replace('cat', 'dog')).toBe(false)
    expect(editor.undo()).toBe(true)
    expect(session.state().total).toBe(1)
  }))

test('a match that already reads as the replacement is passed over without an undo step', () =>
  run((editor, session) => {
    session.find('cat')
    const before = editor.snapshot()
    expect(session.replace('cat', 'cat')).toBe(false)
    expect(editor.snapshot().text).toBe(before.text)
    expect(editor.snapshot().revision).toBe(before.revision)
    expect(session.state().current).toBe(2)
  }))

test('replaceAll is one undo step and updates the count', () =>
  run((editor, session, states) => {
    session.find('cat')
    expect(session.replaceAll('cat', 'owl')).toBe(4)
    expect(editor.snapshot().text).toBe(
      'One owl, two owls.\r\n\r\n**owl** and owl.\r\n',
    )
    expect(states.at(-1)).toMatchObject({ total: 0 })
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(input.text)
    expect(session.state().total).toBe(4)
    expect(session.replaceAll('absent', 'x')).toBe(0)
  }))

test('edits, undo and mode changes refresh the state without a call', () =>
  run((editor, session, states) => {
    session.find('cat')
    editor.selectTextRange({
      ...editor.textSnapshot().selection,
      from: 0,
      to: 0,
    })
    editor.insertText('cat ', 1)
    expect(states.at(-1)).toMatchObject({ total: 5 })
    editor.undo()
    expect(states.at(-1)).toMatchObject({ total: 4 })
    expect(editor.setEditingMode('source')).toBe(true)
    expect(states.at(-1)).toMatchObject({ query: 'cat', total: 4 })
    expect(editor.setEditingMode('formatted')).toBe(true)
    expect(states.at(-1)).toMatchObject({ query: 'cat', total: 4 })
    expect(session.next()).toBe(true)
  }))

test('a reload keeps the query and a load clears it', () =>
  run((editor, session, states) => {
    session.find('cat')
    editor.reloadDocument({
      ...input,
      generation: 2,
      text: `${input.text}More cat.\r\n`,
    })
    expect(states.at(-1)).toMatchObject({
      query: 'cat',
      total: 5,
      generation: 2,
    })
    expect(
      document.querySelectorAll('.ProseMirror-search-match').length,
    ).toBeGreaterThan(0)
    editor.loadDocument({ ...input, documentId: 'other', generation: 3 })
    expect(states.at(-1)).toMatchObject({
      query: '',
      total: 0,
      documentId: 'other',
    })
    expect(document.querySelectorAll('.ProseMirror-search-match')).toHaveLength(
      0,
    )
  }))

test('a failed replacement puts the query and selection back', () =>
  run((editor, session) => {
    session.find('cat')
    session.next()
    const selection = editor.textSnapshot().selection
    editor.setEditable(false)
    expect(() => session.replace('cats', 'x')).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    )
    expect(editor.textSnapshot().selection).toEqual(selection)
    expect(session.state()).toMatchObject({ query: 'cat', current: 2 })
    expect(() => session.find('cat', undefined, 99)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
  }))

test('clear and close remove the highlights and stop the handler', () =>
  run((_editor, session, states) => {
    session.find('cat')
    session.clear()
    expect(states.at(-1)).toMatchObject({ query: '', total: 0 })
    session.find('cat')
    const count = states.length
    session.close()
    session.close()
    expect(document.querySelectorAll('.ProseMirror-search-match')).toHaveLength(
      0,
    )
    expect(() => session.next()).toThrow(
      expect.objectContaining({ code: 'destroyed' }),
    )
    expect(states).toHaveLength(count)
  }))

test('source mode counts and replaces over the displayed text', () =>
  run((editor, session) => {
    editor.setEditingMode('source')
    session.find('cat')
    expect(position(session)).toEqual([1, 4])
    expect(session.replace('cat', 'x')).toBe(true)
    expect(editor.snapshot().text).toBe(
      'One x, two cats.\r\n\r\n**Cat** and CAT.\r\n',
    )
    expect(session.state().total).toBe(3)
  }))

test('a handler that throws does not break the session', () =>
  run(async (editor) => {
    const session = editor.findSession(() => {
      throw new Error('host failure')
    })
    expect(session.find('cat')).toBe(true)
    expect(session.state().total).toBe(4)
  }))
