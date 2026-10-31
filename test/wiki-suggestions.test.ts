import { afterEach, expect, test } from 'vitest'
import {
  InkKitEditor,
  type EditorOptions,
  type FileContext,
  type WikiLinkAdapter,
  type WikiLinkReference,
} from '../src/core'
const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const e of editors.splice(0)) await e.destroy()
  document.body.replaceChildren()
})
async function mount(
  text: string,
  suggest?: (query: string, context: FileContext) => Promise<readonly string[]>,
  slashMenu?: EditorOptions['slashMenu'],
  adapter: Partial<WikiLinkAdapter> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: unknown[] = []
  const options: EditorOptions = {
    wikiLinks: { open() {}, suggest, ...adapter },
    slashMenu,
  }
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (e) => errors.push(e) },
    options,
  )
  editors.push(editor)
  editor.loadDocument({ documentId: 'wiki', generation: 1, format: 'md', text })
  return { root, editor, errors }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
for (const ending of ['\n', '\r\n'])
  for (const body of [
    'TARGET',
    '# TARGET',
    '* TARGET',
    '> TARGET',
    '> [!TIP]\n> TARGET',
    '| TARGET | B |\n| - | - |\n| x | y |',
  ]) {
    test(`in ${body} with ${JSON.stringify(ending)} preserves bytes, reopens, undo and redo`, async () => {
      const source = `Before  \n\n${body}\n\nAfter _kept_.\n`.replaceAll(
        '\n',
        ending,
      )
      const { editor, root, errors } = await mount(source, async () => [
        'Café 日本語',
      ])
      editor.find('TARGET')
      editor.insertText('look ', 1)
      editor.insertText('[', 1)
      editor.insertText('[', 1)
      editor.insertText('caf', 1)
      const typed = editor.snapshot().text
      await settle()
      expect(root.querySelector('[role=option]')?.textContent).toBe(
        'Café 日本語',
      )
      expect(editor.keyDown({ key: 'Enter' }, 1)).toBe(true)
      expect(errors).toEqual([])
      const saved = editor.snapshot().text
      expect(saved).toBe(source.replace('TARGET', 'look [[Café 日本語]]'))
      const reader = await mount(saved, async () => [])
      expect(reader.editor.snapshot().text).toBe(saved)
      expect(reader.root.querySelector('[role=link]')?.textContent).toBe(
        'Café 日本語',
      )
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(typed)
      expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe(saved)
    })
  }
test('ignores stale answers and aborts superseded requests without blocking input', async () => {
  const pending: {
    query: string
    context: FileContext
    resolve: (names: readonly string[]) => void
  }[] = []
  const { editor, root } = await mount(
    '',
    (query, context) =>
      new Promise((resolve) => pending.push({ query, context, resolve })),
  )
  editor.insertText('[[', 1)
  await settle()
  editor.insertText('a', 1)
  await settle()
  expect(editor.textSnapshot().text).toContain('[[a')
  expect(pending.map((p) => p.query)).toEqual(['', 'a'])
  expect(pending[0]!.context.signal.aborted).toBe(true)
  pending[1]!.resolve(['Alpha'])
  await settle()
  expect(root.querySelector('[role=option]')?.textContent).toBe('Alpha')
  pending[0]!.resolve(['Stale'])
  await settle()
  expect(root.querySelector('[role=option]')?.textContent).toBe('Alpha')
  editor.keyDown({ key: 'Escape' }, 1)
  expect(pending[1]!.context.signal.aborted).toBe(true)
  expect(root.querySelector('[role=listbox]')).toBeNull()
})
test('without suggest the adapter behaves as before', async () => {
  const { editor, root } = await mount('')
  editor.insertText('[[', 1)
  expect(root.querySelector('[role=listbox]')).toBeNull()
})
test('buffered brackets in pending inline code never request note suggestions', async () => {
  const queries: string[] = []
  const { editor, root } = await mount('', async (query) => {
    queries.push(query)
    return ['Alpha']
  })
  editor.format('code')
  editor.insertText('[[', 1)
  await settle()
  expect(queries).toEqual([])
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toBe('`[[`\n')
})
test('a rejected or malformed answer reports a coded error and keeps the typed text', async () => {
  for (const suggest of [
    async () => {
      throw Error('offline')
    },
    async () => [null] as never,
  ]) {
    const { editor, root, errors } = await mount('', suggest)
    editor.insertText('[[x', 1)
    await settle()
    expect(editor.textSnapshot().text).toContain('[[x')
    expect(root.querySelector('[role=listbox]')).toBeNull()
    expect(errors).toMatchObject([{ code: 'file-unavailable' }])
  }
})
test('closed, replaced, and destroyed sessions ignore late results', async () => {
  for (const close of ['escape', 'load', 'destroy']) {
    let resolve!: (names: readonly string[]) => void
    const { editor, root, errors } = await mount(
      '',
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    editor.insertText('[[', 1)
    await settle()
    if (close === 'escape') editor.keyDown({ key: 'Escape' }, 1)
    else if (close === 'load')
      editor.loadDocument({
        documentId: 'next',
        generation: 2,
        format: 'md',
        text: 'New',
      })
    else await editor.destroy()
    resolve(['Late'])
    await settle()
    expect(root.querySelector('[role=listbox]')).toBeNull()
    expect(errors).toEqual([])
  }
})

test('a backslash in a note name is text, and reserved characters are refused', async () => {
  for (const name of ['Résumé 日本語', 'A\\E', 'Trailing\\', ' A name ']) {
    const { editor, root, errors } = await mount(
      'Before\n\nTARGET\n\nAfter\n',
      async () => [name],
    )
    editor.find('TARGET')
    editor.insertText('[[', 1)
    await settle()
    expect(root.querySelector('[role=option]')?.textContent).toBe(name)
    editor.keyDown({ key: 'Tab' }, 1)
    const expected = `Before\n\n[[${name}]]\n\nAfter\n`
    expect(editor.snapshot().text).toBe(expected)
    const reader = await mount(expected)
    expect(reader.editor.snapshot().text).toBe(expected)
    expect(reader.root.querySelector('[role=link]')?.textContent).toBe(name)
    expect(errors).toEqual([])
  }
})

test('invalid names fail without inserting or changing history', async () => {
  for (const name of [
    '',
    '  ',
    '^block',
    'line\nfeed',
    '\u0000',
    // The delimiters cannot be escaped, so a name holding one cannot be written.
    'A#B',
    'A|B',
    'A[B]',
    'A]] **injection**',
  ]) {
    const { editor, root, errors } = await mount('', async () => [name])
    editor.insertText('[[', 1)
    const before = editor.snapshot()
    await settle()
    expect(editor.snapshot()).toEqual(before)
    expect(errors).toMatchObject([{ code: 'file-unavailable' }])
    expect(root.querySelector('[role=listbox]')).toBeNull()
  }
})

test('old matches cannot be chosen while the replacement query is pending', async () => {
  let resolve!: (names: readonly string[]) => void
  const { editor, root } = await mount('', async (query) =>
    query
      ? new Promise((r) => {
          resolve = r
        })
      : ['Old'],
  )
  editor.insertText('[[', 1)
  await settle()
  expect(root.querySelector('[role=option]')?.textContent).toBe('Old')
  editor.insertText('new', 1)
  await settle()
  expect(root.querySelector('[role=option]')).toBeNull()
  expect(root.querySelector('[role=listbox]')?.getAttribute('aria-busy')).toBe(
    'true',
  )
  resolve(['New'])
  await settle()
  expect(root.querySelector('[role=option]')?.textContent).toBe('New')
})

test('closing brackets belong to wiki queries, not slash command filters', async () => {
  const { editor, root, errors } = await mount('', async () => ['Note'], {
    enabled: true,
    commands: [],
    customCommands: [{ name: 'Bracket ]]', action: () => 'Chosen' }],
  })
  editor.insertText('/', 1)
  editor.insertText('bracket ]]', 1)
  expect(root.querySelector('[role=option]')?.textContent).toBe('Bracket ]]')
  editor.keyDown({ key: 'Enter' }, 1)
  expect(editor.snapshot().text).toBe('Chosen\n')
  editor.loadDocument({
    documentId: 'wiki',
    generation: 2,
    format: 'md',
    text: '',
  })
  editor.insertText('[[', 2)
  await settle()
  expect(root.querySelector('[role=listbox]')).not.toBeNull()
  editor.insertText('Note]]', 2)
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toBe('[[Note]]\n')
  expect(root.querySelector('.inkkit-wiki-link')?.textContent).toBe('Note')
  expect(errors).toEqual([])
})

for (const name of [' A\\B 日本語 😀 ', 'A\\\\B', 'A\\', ' A\tCafé ']) {
  test(`table suggestion keeps callback spelling across save and reopen: ${JSON.stringify(name)}`, async () => {
    const references: {
      resolve: WikiLinkReference[]
      open: WikiLinkReference[]
    } = { resolve: [], open: [] }
    const adapter: Partial<WikiLinkAdapter> = {
      resolve(reference) {
        references.resolve.push({ ...reference })
        return { missing: false }
      },
      open(reference) {
        references.open.push({ ...reference })
      },
    }
    const source =
      'Before  \r\n\r\n| TARGET | B |\r\n| --- | --- |\r\n| c | d |\r\n\r\nAfter _kept_.\r\n'
    const { editor, root, errors } = await mount(
      source,
      async () => [name],
      undefined,
      adapter,
    )
    editor.find('TARGET')
    editor.insertText('[[', 1)
    await settle()
    const typed = editor.snapshot().text
    editor.keyDown({ key: 'Enter' }, 1)
    await settle()
    const expected = { raw: `[[${name}]]`, target: name, label: name }
    expect(references.resolve.at(-1)).toEqual(expected)
    root
      .querySelector<HTMLElement>('[role=link]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    await settle()
    expect(references.open.at(-1)).toEqual(expected)
    const saved = editor.snapshot().text
    expect(saved).toBe(source.replace('TARGET', `[[${name}]]`))
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(typed)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(saved)
    const reader = await mount(saved, undefined, undefined, adapter)
    await settle()
    expect(references.resolve.at(-1)).toEqual(expected)
    reader.root
      .querySelector<HTMLElement>('[role=link]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    await settle()
    expect(references.open.at(-1)).toEqual(expected)
    expect(reader.editor.snapshot().text).toBe(saved)
    expect(errors).toEqual([])
  })
}
