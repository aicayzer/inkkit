import { afterEach, expect, test } from 'vitest'
import {
  InkKitEditor,
  type EditorOptions,
  type WikiLinkReference,
} from '../src/core'

const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const e of editors.splice(0)) await e.destroy()
  document.body.replaceChildren()
})
async function mount(
  text: string,
  options: EditorOptions = { wikiLinks: { open() {} } },
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
  editor.loadDocument({ documentId: 'wiki', generation: 1, format: 'md', text })
  return { root, editor, errors }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const links = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.inkkit-wiki-link'), (e) => e.textContent)
function type(editor: InkKitEditor, text: string) {
  for (const character of text) editor.insertText(character, 1)
}

for (const [typed, label] of [
  ['[[Note]]', 'Note'],
  ['[[Note|alias]]', 'alias'],
  ['[[Note#Heading]]', 'Note#Heading'],
  ['[[Note#Heading|alias]]', 'alias'],
  ['[[#Heading]]', '#Heading'],
  ['[[Café 日本語]]', 'Café 日本語'],
  ['[[A\\|B]]', 'A|B'],
] as const)
  for (const [where, source, expected] of [
    ['an empty note', '', (t: string) => `${t}\n`],
    ['after existing text', 'Before TARGET\n', (t: string) => `Before ${t}\n`],
    ['a heading', '# TARGET\n', (t: string) => `# ${t}\n`],
    ['a list item', '* TARGET\n', (t: string) => `* ${t}\n`],
    ['a quote', '> TARGET\n', (t: string) => `> ${t}\n`],
    [
      'a note with CRLF endings',
      'One\r\n\r\nTARGET\r\n\r\nTwo _kept_.\r\n',
      (t: string) => `One\r\n\r\n${t}\r\n\r\nTwo _kept_.\r\n`,
    ],
  ] as const)
    test(`typing ${typed} in ${where} saves a wiki link and reopens identically`, async () => {
      const { editor, root, errors } = await mount(source)
      if (source) {
        editor.find('TARGET')
        // The selected placeholder goes when the first character is typed.
      }
      type(editor, typed)
      await settle()
      const saved = editor.snapshot().text
      expect(saved).toBe(expected(typed))
      expect(links(root)).toEqual([label])
      const reader = await mount(saved)
      expect(reader.editor.snapshot().text).toBe(saved)
      expect(links(reader.root)).toEqual([label])
      expect(errors).toEqual([])
    })

test('typing a wiki link in a table cell saves the cell form of its pipe', async () => {
  const source = '| TARGET | B |\n| - | - |\n| x | y |\n'
  const { editor, root } = await mount(source)
  editor.find('TARGET')
  type(editor, '[[A|b]]')
  const saved = editor.snapshot().text
  expect(saved).toBe('| [[A\\|b]] | B |\n| - | - |\n| x | y |\n')
  expect(links(root)).toEqual(['b'])
  const reader = await mount(saved)
  expect(reader.editor.snapshot().text).toBe(saved)
  expect(links(reader.root)).toEqual(['b'])
})

test('a typed wiki link is the reference the host resolves and opens', async () => {
  const opened: WikiLinkReference[] = []
  const { editor } = await mount('', {
    wikiLinks: {
      open: (reference) => void opened.push(reference),
      resolve: (reference) => ({ missing: reference.target === 'Gone' }),
    },
  })
  type(editor, '[[Gone#Part|text]]')
  const link = document.querySelector<HTMLElement>('.inkkit-wiki-link')!
  expect(link.dataset.missing).toBe('true')
  link.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  )
  expect(opened).toEqual([{ target: 'Gone', fragment: 'Part', label: 'text' }])
})

test('typing the closing brackets after a suggestion list opened closes it and keeps the link', async () => {
  const { editor, root, errors } = await mount('', {
    wikiLinks: { open() {}, suggest: async () => ['Alpha'] },
  })
  type(editor, '[[Al')
  await settle()
  expect(root.querySelector('[role=listbox]')).not.toBeNull()
  type(editor, ']]')
  await settle()
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toBe('[[Al]]\n')
  expect(links(root)).toEqual(['Al'])
  expect(errors).toEqual([])
})

test('typing the brackets after the host-chosen link and Undo behave as typing', async () => {
  const { editor, root } = await mount('')
  type(editor, '[[Note]]')
  expect(links(root)).toEqual(['Note'])
  expect(editor.undo()).toBe(true)
  expect(editor.snapshot().text).not.toContain('Note')
  expect(editor.redo()).toBe(true)
  expect(editor.snapshot().text).toBe('[[Note]]\n')
})

// Text that is not a complete wiki link of the supported syntax stays text.
for (const [typed, saved] of [
  ['![[Note]]', '!\\[\\[Note]]'],
  ['[[[Note]]', '\\[\\[\\[Note]]'],
  ['\\[[Note]]', '\\\\\\[\\[Note]]'],
  ['[[ ]]', '\\[\\[ ]]'],
  ['[[#^block]]', '\\[\\[#^block]]'],
  ['[[a[b]]', '\\[\\[a\\[b]]'],
  ['[[Note]', '\\[\\[Note]'],
  ['[Note]]', '\\[Note]]'],
] as const)
  test(`typing ${typed} is not a wiki link`, async () => {
    const { editor, root, errors } = await mount('')
    type(editor, typed)
    await settle()
    expect(links(root)).toEqual([])
    expect(editor.snapshot().text).toBe(`${saved}\n`)
    expect(errors).toEqual([])
  })

test('typing brackets in inline code and code blocks stays text', async () => {
  const { editor, root } = await mount('')
  editor.format('code')
  type(editor, '[[Note]]')
  expect(links(root)).toEqual([])
  expect(editor.snapshot().text).toBe('`[[Note]]`\n')
  const block = await mount('```\nTARGET\n```\n')
  block.editor.find('TARGET')
  type(block.editor, '[[Note]]')
  expect(links(block.root)).toEqual([])
  expect(block.editor.snapshot().text).toBe('```\n[[Note]]\n```\n')
})

test('without a WikiLinkAdapter typed brackets stay text', async () => {
  const { editor, root } = await mount('', {})
  type(editor, '[[Note]]')
  expect(links(root)).toEqual([])
  expect(editor.snapshot().text).toBe('\\[\\[Note]]\n')
})

test('a note that already holds the link is not rewritten by an edit beside it', async () => {
  const source = 'See [[Note|a]]  and [[B#c]]\n\nTail\n'
  const { editor } = await mount(source)
  editor.find('Tail')
  type(editor, 'Tail [[More]]')
  expect(editor.snapshot().text).toBe(
    'See [[Note|a]]  and [[B#c]]\n\nTail [[More]]\n',
  )
})

test('typing a wiki link inside formatted text keeps the formatting and reopens identically', async () => {
  for (const [source, expected] of [
    ['**TARGET**\n', '**[[Note]]**\n'],
    ['_TARGET_\n', '_[[Note]]_\n'],
    ['x ==TARGET==\n', 'x ==[[Note]]==\n'],
  ] as const) {
    const { editor, root, errors } = await mount(source)
    editor.find('TARGET')
    type(editor, '[[Note]]')
    const saved = editor.snapshot().text
    expect(saved).toBe(expected)
    expect(links(root)).toEqual(['Note'])
    const reader = await mount(saved)
    expect(reader.editor.snapshot().text).toBe(saved)
    expect(links(reader.root)).toEqual(['Note'])
    expect(errors).toEqual([])
  }
})

test('brackets typed across a link or a formatting change stay text', async () => {
  const link = await mount('[a](https://example.com/x)\n')
  link.editor.find('a')
  type(link.editor, '[[Note]]')
  expect(links(link.root)).toEqual([])
  const mixed = await mount('')
  type(mixed.editor, '[[No')
  mixed.editor.format('bold')
  type(mixed.editor, 'te]]')
  expect(links(mixed.root)).toEqual([])
  expect(mixed.editor.snapshot().text).toBe('\\[\\[No**te]]**\n')
})
