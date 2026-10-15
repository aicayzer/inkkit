import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  InkKitEditor,
  type EditorOptions,
  type FileAdapter,
  type FileReference,
  type FormatCommand,
  type ImageAdapter,
  type ShortcutName,
} from '../src/index'
import { shortcutNames } from '../src/editor'

const images: ImageAdapter = {
  presentation: () => undefined,
  importImage: async () => ({ reference: 'imported.png' }),
  exportImage: async () => ({ bytes: new Uint8Array(), mimeType: 'image/png' }),
}

interface Session {
  editor: InkKitEditor
  view: EditorView
  root: HTMLElement
  /** How many times `changed` and `error` were called. */
  sent: string[]
  /** Loads `text` under a greater generation, or under `generation`, and returns it. */
  load(text: string, generation?: number): number
  /** Selects `word`, or puts the caret `caret` characters into it. */
  select(word: string, caret?: number): void
  /** Saves, reopens the saved bytes and checks that they read back as the document shown. */
  reopens(): void
}

async function open(
  body: (session: Session) => void | Promise<void>,
  options?: EditorOptions,
): Promise<void> {
  const root = document.createElement('div')
  document.body.append(root)
  const sent: string[] = []
  const events = {
    changed: () => sent.push('changed'),
    error: (error: { code: string }) => sent.push(`error ${error.code}`),
    copy() {},
    openLink() {},
  }
  const editor = await InkKitEditor.mount(root, events, options)
  const view = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
    editorViewCtx,
  )
  let generation = 0
  const session: Session = {
    editor,
    view,
    root,
    sent,
    load(text, next = ++generation) {
      generation = next
      editor.loadDocument({
        documentId: 'commands',
        generation,
        format: 'md',
        text,
      })
      sent.length = 0
      return generation
    },
    reopens() {
      const saved = editor.snapshot().text
      const shown = view.state.doc.toJSON()
      session.load(saved)
      expect(editor.snapshot().text).toBe(saved)
      expect(view.state.doc.toJSON()).toEqual(shown)
    },
    select(word, caret) {
      let from = -1
      view.state.doc.descendants((node, pos) => {
        if (from < 0 && node.isText && node.text!.includes(word))
          from = pos + node.text!.indexOf(word)
      })
      if (from < 0) throw new Error(`No ${word}`)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            from + (caret ?? 0),
            caret === undefined ? from + word.length : from + caret,
          ),
        ),
      )
    },
  }
  try {
    await body(session)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const code = (value: string) => expect.objectContaining({ code: value })

const formatCommands: readonly FormatCommand[] = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'paragraph',
  'bold',
  'italic',
  'strikethrough',
  'highlight',
  'code',
  'codeBlock',
  'quote',
  'bulletList',
  'orderedList',
  'taskList',
  'link',
]

test('each heading level is its own command, and applying it again makes a paragraph', () =>
  open(({ editor, load, select }) => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      load('Some words\n')
      select('words')
      expect(editor.format(`heading${level}`)).toBe(true)
      expect(editor.snapshot().text).toBe(`${'#'.repeat(level)} Some words\n`)
      expect(editor.format(`heading${level}`)).toBe(true)
      expect(editor.snapshot().text).toBe('Some words\n')
    }
    load('## Some words\n')
    select('words')
    expect(editor.format('heading4')).toBe(true)
    expect(editor.snapshot().text).toBe('#### Some words\n')
  }))

test('command state lists each format command by name', () =>
  open(({ editor, load, select }) => {
    load('Some words\n')
    select('words')
    const { format } = editor.commandState().commands
    expect(Object.keys(format).sort()).toEqual([...formatCommands].sort())
    for (const level of [1, 2, 3, 4, 5, 6])
      expect(format[`heading${level}` as FormatCommand]).toBe(true)
    editor.setEditingMode('source')
    expect(
      Object.values(editor.commandState().commands.format).some(Boolean),
    ).toBe(false)
  }))

test('format reports whether the document or the next typed marks changed', () =>
  open(({ editor, view, load, select, sent }) => {
    load('Some words\n')
    select('words', 2)
    // At a caret, bold changes only the marks the next typed text takes.
    expect(editor.format('bold')).toBe(true)
    expect(editor.snapshot()).toMatchObject({
      text: 'Some words\n',
      revision: 0,
    })
    view.dispatch(view.state.tr.insertText('X'))
    expect(editor.snapshot().text).toBe('Some wo**X**rds\n')
    load('Some words\n')
    select('words')
    expect(editor.format('codeBlock', { language: 'js' })).toBe(true)
    expect(editor.snapshot().text).toBe('```js\nSome words\n```\n')
    // Nothing to remove: the call changes nothing and sends nothing.
    load('Some words\n')
    select('words', 2)
    expect(editor.format('link')).toBe(false)
    expect(editor.snapshot()).toMatchObject({
      text: 'Some words\n',
      revision: 0,
    })
    expect(sent).toEqual([])
    editor.setEditingMode('source')
    expect(editor.format('bold')).toBe(false)
  }))

test('link without a destination removes the whole link that holds the caret or selection', () =>
  open(({ editor, view, load, select, reopens }) => {
    const text = 'See [the docs](https://example.com "Docs") now.\n'
    for (const [word, caret] of [
      ['docs', 2],
      ['the', 0],
      ['he do', undefined],
      ['the docs', undefined],
    ] as const) {
      load(text)
      select(word, caret)
      expect(editor.format('link'), word).toBe(true)
      expect(editor.snapshot().text, word).toBe('See the docs now.\n')
      reopens()
    }
    // A selection that reaches past the link removes every link inside it.
    load('[One](a) and [two](b) end\n')
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(
          view.state.doc,
          1,
          view.state.doc.content.size - 2,
        ),
      ),
    )
    expect(editor.format('link')).toBe(true)
    expect(editor.snapshot().text).toBe('One and two end\n')
    reopens()
  }))

test('link with a destination edits the link that holds the caret, keeping its title', () =>
  open(({ editor, load, select, reopens, sent }) => {
    load('See [the docs](https://example.com "Docs") now.\n')
    select('docs', 1)
    expect(
      editor.format('link', { destination: 'https://example.org/x' }),
    ).toBe(true)
    expect(editor.snapshot().text).toBe(
      'See [the docs](https://example.org/x "Docs") now.\n',
    )
    // Setting the same destination again changes nothing.
    expect(
      editor.format('link', { destination: 'https://example.org/x' }),
    ).toBe(false)
    reopens()
    // An autolink given its own address keeps its form, rather than being refused.
    for (const text of [
      'See <https://example.com> now.\n',
      'See https://example.com now.\n',
    ]) {
      load(text)
      select('example', 1)
      expect(
        editor.format('link', { destination: 'https://example.com' }),
        text,
      ).toBe(false)
      expect(editor.snapshot(), text).toMatchObject({ text, revision: 0 })
      expect(sent, text).toEqual([])
    }
    load('See <https://example.com> now.\n')
    select('example', 1)
    expect(editor.format('link', { destination: 'https://example.org' })).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe(
      'See [https://example.com](https://example.org) now.\n',
    )
    reopens()
  }))

test('a link at the caret is removed or edited while another mark waits for typed text', () =>
  open(({ editor, view, load, select, reopens }) => {
    const inline = 'See [the docs](https://example.com) now.\n'
    load(inline)
    select('docs', 2)
    expect(editor.format('bold')).toBe(true)
    expect(editor.format('link')).toBe(true)
    expect(editor.snapshot().text).toBe('See the docs now.\n')
    view.dispatch(view.state.tr.insertText('X'))
    expect(editor.snapshot().text).toBe('See the do**X**cs now.\n')
    reopens()

    load(inline)
    select('docs', 2)
    editor.format('bold')
    expect(editor.format('link', { destination: 'https://example.org' })).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe(
      'See [the docs](https://example.org) now.\n',
    )
    view.dispatch(view.state.tr.insertText('X'))
    expect(editor.snapshot().text).toBe(
      'See [the do**X**cs](https://example.org) now.\n',
    )
    reopens()

    const reference = 'See [the docs][ref] now.\n\n[ref]: https://example.com\n'
    load(reference)
    select('docs', 2)
    editor.format('bold')
    expect(editor.format('link', { destination: 'https://example.org' })).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe(
      'See [the docs][ref] now.\n\n[ref]: https://example.org\n',
    )
    reopens()
    load(reference)
    select('docs', 2)
    editor.format('bold')
    expect(editor.format('link')).toBe(true)
    expect(editor.snapshot().text).toBe(
      'See the docs now.\n\n[ref]: https://example.com\n',
    )
    reopens()
  }))

test('a link destination must be one the editor opens and can save', () =>
  open(({ editor, view, load, select, reopens }) => {
    load('See [the docs][ref] now.\n\n[ref]: https://example.com\n')
    select('docs', 2)
    const state = view.state
    for (const destination of [
      '',
      ' ',
      '\t \t',
      'javascript:alert(1)',
      'ftp://example.com',
      'file:///etc/hosts',
      'app-scheme:open',
      'https://example.com/a\nb',
      '<x>',
    ]) {
      expect(() => editor.format('link', { destination }), destination).toThrow(
        code('invalid-argument'),
      )
      expect(
        () => editor.editReferenceDefinition('ref', destination),
        destination,
      ).toThrow(code('invalid-argument'))
      expect(view.state, destination).toBe(state)
    }
    // Addresses Markdown writes in another form still read back as given.
    for (const destination of [
      'notes/a b.md',
      'a(b)',
      'café',
      '#intro',
      '?q=1',
      'mailto:a@example.com',
    ]) {
      load('Some words\n')
      select('words')
      expect(editor.format('link', { destination }), destination).toBe(true)
      reopens()
      select('words', 1)
      expect(editor.format('link', { destination }), destination).toBe(false)
    }
  }))

test('link with a destination links the selection, or the text typed next at a caret', () =>
  open(({ editor, view, load, select }) => {
    load('Some words\n')
    select('words')
    expect(editor.format('link', { destination: 'https://example.com' })).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe('Some [words](https://example.com)\n')
    load('Some words\n')
    select('words', 0)
    expect(editor.format('link', { destination: 'https://example.com' })).toBe(
      true,
    )
    expect(editor.snapshot().revision).toBe(0)
    view.dispatch(view.state.tr.insertText('new'))
    expect(editor.snapshot().text).toBe(
      'Some [new](https://example.com)words\n',
    )
    // A pending link is removed like any other.
    load('Some words\n')
    select('words', 0)
    editor.format('link', { destination: 'https://example.com' })
    expect(editor.format('link')).toBe(true)
    view.dispatch(view.state.tr.insertText('new'))
    expect(editor.snapshot().text).toBe('Some newwords\n')
  }))

test('format refuses options that do not belong to the command', () =>
  open(({ editor, view, load, select }) => {
    load('Some words\n')
    select('words')
    const state = view.state
    const bad = (value: unknown) => value as never
    for (const call of [
      () => editor.format(bad('heading')),
      () => editor.format(bad('heading'), bad(2)),
      () => editor.format('heading2', bad({ level: 2 })),
      () => editor.format('bold', { destination: 'https://example.com' }),
      () => editor.format('codeBlock', { destination: 'https://example.com' }),
      () => editor.format('link', { language: 'js' }),
      () => editor.format('link', bad('https://example.com')),
      () => editor.format('link', { destination: bad(1) }),
      () => editor.format('codeBlock', { language: bad(true) }),
    ]) {
      expect(call).toThrow(code('invalid-argument'))
      expect(view.state).toBe(state)
    }
    // Null means omitted, as a WebKit bridge sends it.
    expect(
      editor.format('codeBlock', {
        language: bad(null),
        destination: bad(null),
      }),
    ).toBe(true)
  }))

test('commands with an expected generation refuse a stale one and change nothing', () =>
  open(
    ({ editor, view, load, select }) => {
      load('Some words\n', 4)
      select('words')
      const state = view.state
      for (const call of [
        () => editor.format('bold', undefined, 3),
        () => editor.table('insert', undefined, 3),
        () => editor.insertPaths(['a'], { clientX: 0, clientY: 0 }, 3),
        () =>
          editor.insertImages([{ reference: 'a.png', alt: '' }], undefined, 3),
      ]) {
        expect(call).toThrow(code('stale-document'))
        expect(view.state).toBe(state)
      }
      expect(editor.format('bold', undefined, 4)).toBe(true)
      expect(editor.table('insert', undefined, 4)).toBe(true)
      expect(
        editor.insertImages([{ reference: 'a.png', alt: 'A' }], undefined, 4),
      ).toBe(true)
      expect(editor.insertPaths(['p'], { clientX: -1, clientY: -1 }, 4)).toBe(
        true,
      )
    },
    { images },
  ))

test('keyDown takes each modifier from one object', () =>
  open(({ editor, load, select }) => {
    const bindings = {
      bold: ['Meta-F2'],
      italic: ['Ctrl-F2'],
      strikethrough: ['Alt-F2'],
      highlight: ['Shift-F2'],
    } as const
    editor.setKeymap(bindings)
    const presses = [
      ['bold', { key: 'F2', metaKey: true }, 'Some **words**\n'],
      ['italic', { key: 'F2', ctrlKey: true }, 'Some *words*\n'],
      ['strikethrough', { key: 'F2', altKey: true }, 'Some ~~words~~\n'],
      ['highlight', { key: 'F2', shiftKey: true }, 'Some ==words==\n'],
    ] as const
    for (const [name, input, saved] of presses) {
      const generation = load('Some words\n')
      select('words')
      expect(editor.keyDown(input, generation), name).toBe(true)
      expect(editor.snapshot().text, name).toBe(saved)
    }
    // Omitted and null modifiers are not held, so no binding matches.
    const generation = load('Some words\n')
    select('words')
    expect(editor.keyDown({ key: 'F2' }, generation)).toBe(false)
    const omitted = null as never
    expect(
      editor.keyDown(
        {
          key: 'F2',
          code: omitted,
          metaKey: omitted,
          ctrlKey: omitted,
          altKey: omitted,
          shiftKey: omitted,
        },
        generation,
      ),
    ).toBe(false)
    expect(editor.snapshot().text).toBe('Some words\n')
  }))

test('keyDown refuses a malformed key and a stale generation', () =>
  open(({ editor, view, load }) => {
    load('Some words\n', 2)
    const state = view.state
    const bad = (value: unknown) => value as never
    for (const [input, generation, expected] of [
      [bad('Enter'), 2, 'invalid-argument'],
      [bad({ code: 'Enter' }), 2, 'invalid-argument'],
      [bad({ key: 'Enter', meta: true }), 2, 'invalid-argument'],
      [bad({ key: 'Enter', shiftKey: 'yes' }), 2, 'invalid-argument'],
      [{ key: 'Enter' }, bad(undefined), 'invalid-argument'],
      [{ key: 'Enter' }, 1, 'stale-document'],
    ] as const) {
      expect(() => editor.keyDown(input, generation)).toThrow(code(expected))
      expect(view.state).toBe(state)
    }
  }))

test('insertImages works with a file adapter alone and reports when it cannot insert', async () => {
  const resolved: FileReference[] = []
  const files: FileAdapter = {
    resolve: async (reference) => {
      resolved.push(reference)
      return { kind: 'file' }
    },
  }
  await open(
    ({ editor, load, select }) => {
      load('Some words\n')
      select('words', 5)
      expect(editor.commandState().commands.insertImages).toBe(true)
      expect(
        editor.insertImages([
          { reference: 'Scans/My%23Notes.png', alt: 'Scan' },
        ]),
      ).toBe(true)
      expect(editor.snapshot().text).toBe(
        'Some words\n\n![Scan](Scans/My%23Notes.png)\n',
      )
      expect(editor.insertImages([])).toBe(false)
    },
    { files },
  )
  // The reference reaches the file adapter as written: `%23` stays part of the target.
  await expect
    .poll(() => resolved.map(({ target, fragment }) => ({ target, fragment })))
    .toContainEqual({ target: 'Scans/My%23Notes.png', fragment: undefined })
  await open(({ editor, load, select, sent }) => {
    load('Some words\n')
    select('words', 0)
    expect(editor.commandState().commands.insertImages).toBe(false)
    expect(editor.insertImages([{ reference: 'a.png', alt: 'A' }])).toBe(false)
    expect(editor.snapshot()).toMatchObject({
      text: 'Some words\n',
      revision: 0,
    })
    expect(sent).toEqual([])
  })
})

test('insertImages and insertPaths take a client point', () =>
  open(
    ({ editor, load }) => {
      load('One\n\nTwo\n')
      // A point outside the page, which jsdom does not lay out, resolves to the caret.
      expect(
        editor.insertImages([{ reference: 'a.png', alt: 'A' }], {
          clientX: -100,
          clientY: -100,
        }),
      ).toBe(true)
      expect(editor.snapshot().text).toBe('One\n\nTwo\n\n![A](a.png)\n')
      expect(editor.insertPaths([], { clientX: 0, clientY: 0 })).toBe(false)
      expect(
        editor.insertPaths(['/a b.txt'], { clientX: -100, clientY: -100 }),
      ).toBe(true)
      expect(editor.snapshot().text).toBe(
        'One\n\nTwo\n\n![A](a.png)\n\n/a b.txt\n',
      )
      editor.setEditingMode('source')
      expect(editor.insertPaths(['/c'], { clientX: 0, clientY: 0 })).toBe(true)
      const bad = (value: unknown) => value as never
      for (const call of [
        () => editor.insertPaths(['/c'], bad(undefined)),
        () => editor.insertPaths(['/c'], bad({ x: 0, y: 0 })),
        () => editor.insertPaths(['/c'], { clientX: 0, clientY: Number.NaN }),
        () => editor.insertImages([], bad({ clientX: 0 })),
      ])
        expect(call).toThrow(code('invalid-argument'))
    },
    { images },
  ))

test('ShortcutName lists every binding, as the API reference documents them', () => {
  const names: readonly ShortcutName[] = shortcutNames
  const reference = readFileSync('docs/api.md', 'utf8')
  const section = reference.slice(
    reference.indexOf('`EditorOptions.keymap`'),
    reference.indexOf('## Opening links'),
  )
  const documented = new Set(
    [...section.matchAll(/`([a-z][A-Za-z0-9]*)`/g)].map((match) => match[1]),
  )
  for (const name of names) expect(documented, name).toContain(name)
  expect(new Set(names).size).toBe(names.length)
  expect(names).toContain('tableSortRows')
  expect(names).not.toContain('link')
})

test('a bound shortcut runs the format command of the same name', async () => {
  const commands = formatCommands.filter(
    (command): command is Exclude<FormatCommand, 'link'> => command !== 'link',
  )
  for (const command of commands) {
    // `paragraph` changes only a block that is not one already.
    const text = command === 'paragraph' ? '## Some words\n' : 'Some words\n'
    let byCall = ''
    await open(({ editor, load, select }) => {
      load(text)
      select('words')
      expect(editor.format(command), command).toBe(true)
      byCall = editor.snapshot().text
      expect(byCall, command).not.toBe(text)
    })
    await open(({ editor, load, select }) => {
      editor.setKeymap({ [command]: ['Ctrl-F3'] })
      load(text)
      select('words')
      expect(editor.keyDown({ key: 'F3', ctrlKey: true }, 1), command).toBe(
        true,
      )
      expect(editor.snapshot().text, command).toBe(byCall)
    })
  }
})
