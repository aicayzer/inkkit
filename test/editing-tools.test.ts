import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor, InkKitError } from '../src/index'
import { findLiteral, replaceLiteral } from '../src/search'

async function run(
  text: string,
  callback: (
    editor: InkKitEditor,
    root: HTMLElement,
    ctx: Ctx,
  ) => void | Promise<void>,
  format: 'md' | 'txt' = 'md',
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
    {
      images: {
        presentation() {
          return undefined
        },
        async importImage() {
          return { reference: 'unused.png' }
        },
        async exportImage() {
          return { bytes: new Uint8Array([1]), mimeType: 'image/png' }
        },
      },
    },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  editor.loadDocument({ documentId: 'tools', generation: 4, format, text })
  try {
    await callback(editor, root, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('literal matching uses Unicode case folding without normalisation or offset expansion', () => {
  expect(findLiteral('İx K K k é e\u0301', 'x')).toEqual({ from: 1, to: 2 })
  expect(
    replaceLiteral('K K k', 'k', '$&$1$$', { from: 0, to: 0 }, true),
  ).toEqual({
    text: '$&$1$$ $&$1$$ $&$1$$',
    count: 3,
    from: 0,
    to: 0,
  })
  expect(findLiteral('e\u0301', 'é')).toBeUndefined()
  expect(findLiteral('a.*b', '.*')).toEqual({ from: 1, to: 3 })
  expect(
    replaceLiteral('aa aa', 'aa', 'aaa', { from: 3, to: 5 }, true),
  ).toEqual({
    text: 'aaa aaa',
    count: 2,
    from: 4,
    to: 7,
  })
  expect(replaceLiteral('aA', 'a', 'a', { from: 0, to: 2 }, true).count).toBe(1)
  expect(replaceLiteral('word', '', 'x', { from: 0, to: 0 }, true).count).toBe(
    0,
  )
})

test('formatted replacement preserves Unicode offsets, literal replacement tokens and canonical distinctions', () =>
  run('İx K K k é e\u0301', (editor, _root, ctx) => {
    expect(editor.replace('x', 'X')).toBe(true)
    expect(ctx.get(editorViewCtx).state.doc.textContent).toBe(
      'İX K K k é e\u0301',
    )
    expect(editor.replaceAll('k', '$&$1$$')).toBe(3)
    expect(ctx.get(editorViewCtx).state.doc.textContent).toBe(
      'İX $&$1$$ $&$1$$ $&$1$$ é e\u0301',
    )
    expect(editor.replaceAll('é', 'accent')).toBe(1)
    expect(ctx.get(editorViewCtx).state.doc.textContent).toContain(
      'accent e\u0301',
    )
  }))

test('single replacement prefers a matching selection, then advances and wraps, selecting inserted text', () =>
  run('first first first', (editor, _root, ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)),
    )
    expect(editor.replace('first', 'SECOND')).toBe(true)
    expect(editor.snapshot().text).toBe('first SECOND first')
    expect(
      view.state.doc.textBetween(
        view.state.selection.from,
        view.state.selection.to,
      ),
    ).toBe('SECOND')
    expect(editor.replace('first', 'LAST')).toBe(true)
    expect(editor.snapshot().text).toBe('first SECOND LAST')
    expect(editor.replace('first', 'START')).toBe(true)
    expect(editor.snapshot().text).toBe('START SECOND LAST')
    const before = editor.snapshot()
    expect(editor.replace('', 'unused')).toBe(false)
    expect(editor.replaceAll('START', 'START')).toBe(0)
    expect(editor.replaceAll('missing', 'unused')).toBe(0)
    expect(editor.snapshot()).toEqual(before)
  }))

test('replace-all scans original nonoverlapping text once and forms one isolated undo event', () =>
  run('aaa aa', (editor, _root, ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 7)),
    )
    expect(editor.replaceAll('aa', 'aaa')).toBe(2)
    expect(editor.snapshot().text).toBe('aaaa aaa')
    expect(
      view.state.doc.textBetween(
        view.state.selection.from,
        view.state.selection.to,
      ),
    ).toBe('aaa')
    editor.insertText('!', 4)
    expect(editor.undo(4)).toBe(true)
    expect(editor.snapshot().text).toBe('aaaa aaa')
    expect(editor.undo(4)).toBe(true)
    expect(editor.snapshot().text).toBe('aaa aa')
    expect([view.state.selection.from, view.state.selection.to]).toEqual([5, 7])
    expect(editor.snapshot().dirty).toBe(false)
    expect(editor.redo(4)).toBe(true)
    expect(editor.snapshot().text).toBe('aaaa aaa')
  }))

test('formatted matching spans marks but excludes attributes, atoms and structural boundaries', () =>
  run(
    'one **two** three\n\nleft ![alt](/private/image) right\n\nlast\n\n[visible](/secret/url "title") [ref][id]\n\n[id]: /private/reference\n',
    (editor) => {
      expect(editor.replace('one two', 'joined')).toBe(true)
      expect(editor.snapshot().text).toContain('joined')
      const before = editor.snapshot()
      for (const query of [
        'left alt right',
        'left  right',
        'three\nleft',
        '/secret/url',
        '/private/reference',
        'title',
        'id',
      ])
        expect(editor.replaceAll(query, 'lost')).toBe(0)
      expect(editor.snapshot()).toEqual(before)
      expect(editor.replace('ref', 'renamed')).toBe(true)
      expect(editor.snapshot().text).toContain('[renamed][id]')
      expect(editor.snapshot().text).toContain('[id]: /private/reference')
    },
  ))

test('comment body replacement stays private while preserving source delimiters and undo', () =>
  run(
    'before %%private body%% after\n\n%%\nsecret block\n%%\n',
    async (editor) => {
      const original = editor.snapshot().text
      expect(editor.replace('private', 'edited')).toBe(true)
      expect(editor.replaceAll('secret', 'changed')).toBe(1)
      expect(editor.snapshot().text).toContain('%%edited body%%')
      expect(editor.snapshot().text).toContain('changed block')
      const clip = await editor.clipboardSnapshot()
      expect(clip.text).not.toMatch(/edited|changed|private|secret/)
      expect(clip.html).not.toMatch(/edited|changed|private|secret/)
      expect(clip.markdown).toContain('edited')
      expect(editor.undo(4)).toBe(true)
      expect(editor.undo(4)).toBe(true)
      expect(editor.snapshot().text).toBe(original)
    },
  ))

test('replacement newline creates a hard break in prose and remains literal in code', () =>
  run('prose needle\n\n```text\ncode needle\n```\n', (editor, _root, ctx) => {
    expect(editor.replaceAll('needle', 'a\r\nb')).toBe(2)
    const view = ctx.get(editorViewCtx)
    const names: string[] = []
    view.state.doc.descendants((node) => {
      names.push(node.type.name)
    })
    expect(names.filter((name) => name === 'hardbreak')).toHaveLength(1)
    expect(editor.snapshot().text).toContain('code a\nb')
    const saved = editor.snapshot().text
    editor.loadDocument({
      documentId: 'reopened',
      generation: 5,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot().text).toBe(saved)
    expect(view.state.doc.textContent).toContain('code a\nb')
  }))

test('replacement preserves implicit reference destinations and retained definitions through save and reopen', () =>
  run(
    '[route] and [route][]\n\n[route]: /kept "Title"\n[unused]: /retained\n',
    async (editor) => {
      const original = editor.snapshot().text
      expect(editor.replaceAll('route', 'renamed')).toBe(2)
      const saved = editor.snapshot().text
      expect(saved).toContain('[renamed][route]')
      expect(saved).toContain('[route]: /kept "Title"')
      expect(saved).toContain('[unused]: /retained')
      const clip = await editor.clipboardSnapshot()
      expect(clip.html.match(/href="\/kept"/g)).toHaveLength(2)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(original)
      editor.loadDocument({
        documentId: 'saved',
        generation: 5,
        format: 'md',
        text: saved,
      })
      expect(
        (await editor.clipboardSnapshot()).html.match(/href="\/kept"/g),
      ).toHaveLength(2)
      expect(editor.snapshot().text).toBe(saved)
    },
  ))

test('multiline preserved literal and comment body replacement retains literal structure and privacy', () =>
  run(
    '<custom>needle\nnext</custom>\n\nbefore %%needle%% after\n',
    async (editor, _root, ctx) => {
      const original = editor.snapshot().text
      expect(editor.replaceAll('needle', 'first\nsecond')).toBe(2)
      expect(editor.snapshot().text).toContain(
        '<custom>first\nsecond\nnext</custom>',
      )
      expect(editor.snapshot().text).toContain('%%first\nsecond%%')
      const types: string[] = []
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        types.push(node.type.name)
      })
      expect(types).not.toContain('hardbreak')
      const clip = await editor.clipboardSnapshot()
      expect(clip.text).toContain('<custom>first\nsecond\nnext</custom>')
      expect(clip.text).toContain('before  after')
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(original)
    },
  ))

test('formatted replacement retains a wholly matched mark and rejects matches crossing private comment boundaries', () =>
  run('__styled__ left %%private%% right\n', (editor, _root, ctx) => {
    expect(editor.replace('styled', 'new')).toBe(true)
    expect(editor.snapshot().text).toContain('__new__')
    const before = editor.snapshot()
    for (const query of [
      'left private',
      'private right',
      'left  private',
      'private  right',
    ])
      expect(editor.replaceAll(query, 'lost')).toBe(0)
    expect(editor.snapshot()).toEqual(before)
    expect(
      ctx.get(editorViewCtx).state.doc.firstChild!.firstChild!.marks[0]!.type
        .name,
    ).toBe('strong')
  }))

test('unrepresentable table replacement rejects every match before document or selection mutation', () =>
  run('outside needle\n\n| H |\n| - |\n| needle |\n', (editor, _root, ctx) => {
    const view = ctx.get(editorViewCtx)
    const before = editor.snapshot()
    const selection = view.state.selection
    expect(() => editor.replaceAll('needle', 'a\nb')).toThrow(InkKitError)
    expect(editor.snapshot()).toEqual(before)
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(editor.undo(4)).toBe(false)
    expect(editor.replaceAll('needle', 'safe')).toBe(2)
    expect(editor.undo(4)).toBe(true)
    expect(editor.snapshot().text).toBe(before.text)
  }))

test.each(['source', 'txt'] as const)(
  '%s replacement searches complete literal text including metadata and exact line endings',
  (mode) =>
    run(
      '\uFEFF# Heading\r\n\r\n[visible](/private/url) %%secret%%\r\nend',
      (editor, root) => {
        if (mode === 'source') editor.setEditingMode('source', 4)
        const textarea = root.querySelector('textarea')!
        textarea.setSelectionRange(0, 0)
        expect(editor.replaceAll('/private/url', '$&')).toBe(1)
        expect(editor.replaceAll('secret', 'changed')).toBe(1)
        expect(editor.replaceAll('\r\n', '\n')).toBe(3)
        expect(editor.snapshot().text).toBe(
          '\uFEFF# Heading\n\n[visible]($&) %%changed%%\nend',
        )
        expect(editor.undo(4)).toBe(true)
        expect(editor.snapshot().text).toContain('\r\n')
        expect(editor.replaceAll('', 'nothing')).toBe(0)
        expect(editor.snapshot().text).not.toContain('nothing')
      },
      mode === 'txt' ? 'txt' : 'md',
    ),
)

test('source replacement maps raw CRLF positions back to the displayed textarea selection', () =>
  run('first\r\nneedle\r\nneedle', (editor, root) => {
    editor.setEditingMode('source')
    const textarea = root.querySelector('textarea')!
    textarea.setSelectionRange(6, 12)
    expect(editor.replace('needle', 'a\r\nb')).toBe(true)
    expect(editor.snapshot().text).toBe('first\r\na\r\nb\r\nneedle')
    expect(
      textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
    ).toBe('a\nb')
    expect(editor.undo()).toBe(true)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 12])
  }))

test.each([
  ['md', '\r'],
  ['md', '\n'],
  ['txt', '\r'],
  ['txt', '\n'],
] as const)(
  '%s find and replace retain the exact raw %j match inside CRLF',
  (format, search) =>
    run(
      'first\r\nsecond\r\nthird',
      (editor, root) => {
        if (format === 'md') editor.setEditingMode('source')
        const textarea = root.querySelector('textarea')!
        textarea.setSelectionRange(0, 0)
        editor.find(search)
        expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([5, 6])
        expect(editor.replace(search, 'X')).toBe(true)
        expect(editor.snapshot().text).toBe(
          'first\r\nsecond\r\nthird'.replace(search, 'X'),
        )
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe('first\r\nsecond\r\nthird')
      },
      format,
    ),
)

test('replacement rejects stale generations and active composition without changing source', () =>
  run('needle', (editor, root, ctx) => {
    const before = editor.snapshot()
    expect(() => editor.replaceAll('needle', 'lost', 3)).toThrow(
      'Document changed',
    )
    const view = ctx.get(editorViewCtx)
    Object.defineProperty(view, 'composing', {
      configurable: true,
      value: true,
    })
    expect(() => editor.replace('needle', 'lost', 4)).toThrow('composition')
    Object.defineProperty(view, 'composing', {
      configurable: true,
      value: false,
    })
    editor.setEditingMode('source')
    const textarea = root.querySelector('textarea')!
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(() => editor.replaceAll('needle', 'lost', 4)).toThrow('composition')
    textarea.dispatchEvent(new Event('compositionend'))
    expect(editor.snapshot()).toEqual(before)
    editor.loadDocument({
      documentId: 'other',
      generation: 5,
      format: 'md',
      text: 'other',
    })
    expect(() => editor.replace('other', 'lost', 4)).toThrow('Document changed')
    expect(editor.snapshot().text).toBe('other')
  }))

const outlined =
  '# Main **bold** %%private%% ![alt|120](/image) [link](/url) [^n]\n\nSetext\n------\n\n> ### Quote\n\n- #### List\n\n> [!NOTE]- Folded\n> ## Inner\n>\n> > [!TIP]- Nested\n> > ##### Deep\n\n```md\n# Code\n```\n\n[^n]: footnote\n'

test('outline exposes ordered actual headings with readable labels and JSON-safe navigation', () =>
  run(outlined, (editor, _root, ctx) => {
    const headings = editor.headings(4)
    expect(headings.map(({ level, text }) => [level, text])).toEqual([
      [1, 'Main bold  alt link [n]'],
      [2, 'Setext'],
      [3, 'Quote'],
      [4, 'List'],
      [2, 'Inner'],
      [5, 'Deep'],
    ])
    expect(Object.isFrozen(headings)).toBe(true)
    expect(Object.isFrozen(headings[0])).toBe(true)
    const before = editor.snapshot()
    expect(
      editor.navigateHeading(JSON.parse(JSON.stringify(headings[2]))),
    ).toBe(true)
    expect(
      ctx.get(editorViewCtx).state.selection.$from.parent.textContent,
    ).toBe('Quote')
    expect(editor.snapshot()).toEqual(before)
    expect(editor.undo(4)).toBe(false)
    for (const invalid of [
      null,
      undefined,
      {},
      { ...headings[0], text: 'forged' },
    ])
      expect(() => editor.navigateHeading(invalid as never)).toThrow(
        InkKitError,
      )
    expect(editor.snapshot()).toEqual(before)
  }))

test('heading navigation reveals every folded callout ancestor without editing source or history', () =>
  run(outlined, (editor, root) => {
    expect(root.querySelectorAll('[data-inkkit-folded="true"]')).toHaveLength(2)
    const before = editor.snapshot()
    expect(
      editor.navigateHeading(
        editor.headings().find((heading) => heading.text === 'Deep')!,
      ),
    ).toBe(true)
    expect(root.querySelectorAll('[data-inkkit-folded="true"]')).toHaveLength(0)
    expect(editor.snapshot()).toEqual(before)
    expect(editor.undo()).toBe(false)
  }))

test('source outline uses normalised textarea coordinates for BOM, CRLF, Setext and nested headings', () =>
  run(
    '\uFEFF# First\r\n\r\nSetext\r\n------\r\n\r\n> ## Quoted\r\n',
    (editor, root) => {
      editor.setEditingMode('source')
      const textarea = root.querySelector('textarea')!
      const headings = editor.headings()
      expect(headings.map((heading) => heading.text)).toEqual([
        'First',
        'Setext',
        'Quoted',
      ])
      expect(
        editor.navigateHeading(JSON.parse(JSON.stringify(headings[1]))),
      ).toBe(true)
      expect(textarea.selectionStart).toBe(textarea.value.indexOf('Setext'))
      expect(editor.navigateHeading(headings[2]!)).toBe(true)
      expect(textarea.selectionStart).toBe(textarea.value.indexOf('## Quoted'))
      expect(editor.snapshot().dirty).toBe(false)
    },
  ))

test('outline refreshes after edits and invalidates entries after edits, mode changes, reloads and document switches', () =>
  run('# Initial', (editor) => {
    const old = editor.headings()[0]!
    expect(editor.replace('Initial', 'Edited')).toBe(true)
    expect(editor.headings()[0]!.text).toBe('Edited')
    expect(() => editor.navigateHeading(old)).toThrow(
      'heading is no longer current',
    )
    const formatted = editor.headings()[0]!
    editor.setEditingMode('source')
    expect(() => editor.navigateHeading(formatted)).toThrow(
      'heading is no longer current',
    )
    const source = editor.headings()[0]!
    editor.replaceSource('# Revised\n\n## New')
    expect(editor.headings().map((heading) => heading.text)).toEqual([
      'Revised',
      'New',
    ])
    expect(() => editor.navigateHeading(source)).toThrow(
      'heading is no longer current',
    )
    const current = editor.headings()[0]!
    editor.loadDocument({
      documentId: 'tools',
      generation: 4,
      format: 'md',
      text: '# Revised\n\n## New',
    })
    expect(() => editor.navigateHeading(current)).toThrow(
      'heading is no longer current',
    )
    const reloaded = editor.headings()[0]!
    editor.loadDocument({
      documentId: 'other',
      generation: 5,
      format: 'md',
      text: '# Revised',
    })
    expect(() => editor.navigateHeading(reloaded)).toThrow('Document changed')
    editor.loadDocument({
      documentId: 'literal',
      generation: 6,
      format: 'txt',
      text: '# Literal',
    })
    expect(editor.headings()).toEqual([])
  }))

test('headings in an authored footnote definition retain document order and source navigation positions', () =>
  run(
    '[^note]:\n    ## Note heading\n\n# Main heading\n\nBody[^note]\n',
    (editor, root) => {
      expect(editor.headings().map(({ level, text }) => [level, text])).toEqual(
        [
          [2, 'Note heading'],
          [1, 'Main heading'],
        ],
      )
      editor.setEditingMode('source')
      const textarea = root.querySelector('textarea')!
      const headings = editor.headings()
      expect(headings.map(({ level, text }) => [level, text])).toEqual([
        [2, 'Note heading'],
        [1, 'Main heading'],
      ])
      editor.navigateHeading(headings[0]!)
      expect(textarea.selectionStart).toBe(
        textarea.value.indexOf('## Note heading'),
      )
      editor.navigateHeading(headings[1]!)
      expect(textarea.selectionStart).toBe(
        textarea.value.indexOf('# Main heading'),
      )
    },
  ))

test('unsupported callout contents and incomplete fences contribute no invented headings in source mode', () =>
  run(
    '> [!UNKNOWN]\n> # Literal\n\n# Actual\n\n```md\n## Incomplete',
    (editor) => {
      expect(editor.headings().map((heading) => heading.text)).toEqual([
        'Actual',
      ])
      editor.setEditingMode('source')
      expect(editor.headings().map((heading) => heading.text)).toEqual([
        'Actual',
      ])
    },
  ))
