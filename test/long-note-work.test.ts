import { expect, test, vi } from 'vitest'
import { remarkCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { preservationWork } from '../src/preserve'
import { edit } from './edit-source'
import { SearchQuery } from 'prosemirror-search'
import { cleanSourceDoc } from '../src/source'

test('typing beside a resolved footnote validates only its block', async () => {
  const source =
    Array.from(
      { length: 100 },
      (_, i) => `Paragraph ${i} with a note[^n${i}].`,
    ).join('\n\n') +
    '\n\n' +
    Array.from({ length: 100 }, (_, i) => `[^n${i}]: Note ${i}.`).join('\n\n') +
    '\n'
  await edit(source, ({ editor, caret, type }) => {
    caret('Paragraph 50')
    preservationWork.characters = 0
    type('x')
    expect(editor.snapshot().text).toBe(
      source.replace('Paragraph 50', 'Paragraph 50x'),
    )
    expect(preservationWork.characters).toBeLessThan(1000)
  })
})

test('an active query searches only changed blocks and does not search on selection changes', async () => {
  const source =
    Array.from({ length: 200 }, (_, i) => `Paragraph ${i} alpha.`).join(
      '\n\n',
    ) + '\n'
  await edit(source, ({ editor, caret, type, view }) => {
    editor.find('alpha')
    const find = vi.spyOn(SearchQuery.prototype, 'findNext')
    caret('Paragraph 101')
    expect(find).not.toHaveBeenCalled()
    type('x')
    expect(find.mock.calls.length).toBeLessThan(10)
    expect(
      view.dom.querySelectorAll(
        '.ProseMirror-search-match, .ProseMirror-active-search-match',
      ),
    ).toHaveLength(200)
    expect(editor.snapshot().text).toBe(
      source.replace('Paragraph 101', 'Paragraph 101x'),
    )
    find.mockRestore()
    editor.find('alpha')
    editor.insertText('beta', 1)
    expect(
      view.dom.querySelectorAll(
        '.ProseMirror-search-match, .ProseMirror-active-search-match',
      ),
    ).toHaveLength(199)
    editor.undo(1)
    expect(
      view.dom.querySelectorAll(
        '.ProseMirror-search-match, .ProseMirror-active-search-match',
      ),
    ).toHaveLength(200)
  })
})

test.each(['\n', '\r\n', '\r'])(
  'incremental source parsing agrees with a full reopen around block boundaries (%j)',
  async (ending) => {
    const source =
      [
        '# Heading',
        'First **bold** paragraph.',
        'Second paragraph.',
        'Setext\n------',
        'Last paragraph.',
      ]
        .join('\n\n')
        .replaceAll('\n', ending) + ending
    for (const replacement of [
      'changed',
      '\n\nNew paragraph\n\n',
      '\n---\n',
      '\n```\n',
      '[missing][ref]',
      '<div>\n',
      '%%\n\n',
    ]) {
      await edit(source, ({ editor, view }) => {
        editor.setEditingMode('source')
        editor.headings()
        const snapshot = editor.textSnapshot()
        const from = snapshot.text.indexOf('Second')
        editor.selectTextRange({
          snapshotId: snapshot.snapshotId,
          from,
          to: from + 6,
        })
        editor.insertText(replacement, 1)
        const expected = source.replace(
          'Second',
          replacement.replaceAll('\n', ending),
        )
        const headings = editor
          .headings()
          .map(({ text, level }) => ({ text, level }))
        editor.setEditingMode('formatted')
        expect(editor.snapshot().text).toBe(expected)
        const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
        const shape = (doc: typeof view.state.doc) =>
          JSON.stringify(doc.toJSON(), (key, value) =>
            key === 'id' ? undefined : value,
          )
        expect(shape(cleanSourceDoc(view.state.doc))).toBe(
          shape(ctx.get(parserCtx)(expected)),
        )
        expect(
          editor.headings().map(({ text, level }) => ({ text, level })),
        ).toEqual(headings)
      })
    }
  },
)

test('source outline caches unchanged text and reuses safe unchanged blocks', async () => {
  const source =
    Array.from({ length: 200 }, (_, i) =>
      i % 20 === 0 ? `## Heading ${i}` : `Paragraph ${i}.`,
    ).join('\n\n') + '\n'
  await edit(source, ({ editor }) => {
    editor.setEditingMode('source')
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const parse = vi.spyOn(ctx.get(remarkCtx), 'parse')
    const first = editor.headings()
    parse.mockClear()
    expect(editor.headings()).toEqual(first)
    expect(parse).not.toHaveBeenCalled()
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('Paragraph 101') + 13
    editor.selectTextRange({ snapshotId: snapshot.snapshotId, from, to: from })
    editor.insertText('x', 1)
    preservationWork.characters = 0
    expect(editor.headings().map((heading) => heading.text)).toEqual(
      first.map((heading) => heading.text),
    )
    expect(preservationWork.characters).toBeLessThan(1000)
    editor.setEditingMode('formatted')
    expect(editor.snapshot().text).toBe(
      source.replace('Paragraph 101', 'Paragraph 101x'),
    )
    parse.mockRestore()
  })
})

test('source history changes provenance without recreating untouched DOM', async () => {
  await edit(
    '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n',
    ({ editor, view }) => {
      const heading = view.dom.firstChild
      const paragraph = view.dom.lastChild
      editor.setEditingMode('source')
      editor.replaceSource(
        '# Title\n\nChanged paragraph.\n\nSecond paragraph.\n',
        1,
      )
      editor.setEditingMode('formatted')
      expect(view.dom.firstChild).toBe(heading)
      expect(view.dom.lastChild).toBe(paragraph)
      expect(editor.snapshot().text).toContain('Changed paragraph')
      editor.undo(1)
      expect(editor.snapshot().text).toContain('First paragraph')
      expect(view.dom.firstChild).toBe(heading)
      editor.redo(1)
      expect(editor.snapshot().text).toContain('Changed paragraph')
      expect(view.dom.lastChild).toBe(paragraph)
    },
  )
})
