import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { InkKitEditor } from '../src/index'

const input = { documentId: 'urls', format: 'md' as const }

// Applies an edit to the text block holding `anchor`, at offsets within it,
// and returns what was saved and whether it reopens as the same document.
async function edit(
  source: string,
  anchor: string,
  change: (text: string) => [from: number, to: number, insert: string],
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    editor.loadDocument({ ...input, generation: 1, text: source })
    const view = ctxOf(editor).get(editorViewCtx)
    let start = -1,
      text = ''
    view.state.doc.descendants((node, pos) => {
      if (start < 0 && node.isTextblock && node.textContent.includes(anchor)) {
        start = pos + 1
        text = node.textContent
      }
    })
    const [from, to, insert] = change(text)
    view.dispatch(view.state.tr.insertText(insert, start + from, start + to))
    // How a link was written is not part of what the document reads as.
    const content = () =>
      JSON.parse(
        JSON.stringify(view.state.doc.toJSON(), (key, value) =>
          key === 'form' ? undefined : value,
        ),
      )
    const edited = content()
    const saved = editor.snapshot().text
    editor.loadDocument({ ...input, generation: 2, text: saved })
    const reopened = content()
    const links: string[] = []
    view.state.doc.descendants((node) => {
      const link = node.marks.find((mark) => mark.type.name === 'link')
      if (node.isText && link) links.push(`${node.text} -> ${link.attrs.href}`)
    })
    return { saved, errors, edited, reopened, links }
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const url = 'https://example.com/path'
const blocks: [string, (url: string) => string][] = [
  ['a paragraph', (url) => `Visit ${url} today.\n`],
  ['a list item', (url) => `- ${url}\n`],
  ['a table cell', (url) => `| Link |\n| --- |\n| ${url} |\n`],
]
const edits: [string, (text: string) => [number, number, string], string][] = [
  [
    'typing at the end of the path',
    (text) => [text.indexOf('path') + 4, text.indexOf('path') + 4, 's'],
    'https://example.com/paths',
  ],
  [
    'typing inside the domain',
    (text) => [text.indexOf('ample'), text.indexOf('ample'), 'x'],
    'https://exxample.com/path',
  ],
  [
    'deleting a character',
    (text) => [text.indexOf('path') + 3, text.indexOf('path') + 4, ''],
    'https://example.com/pat',
  ],
  [
    'replacing a selection',
    (text) => [text.indexOf('path'), text.indexOf('path') + 4, 'docs'],
    'https://example.com/docs',
  ],
]

for (const [block, write] of blocks) {
  for (const [name, change, edited] of edits)
    test(`${name} of a bare URL in ${block} saves it as a bare URL`, async () => {
      const result = await edit(write(url), 'https', change)
      expect(result.errors).toEqual([])
      expect(result.saved).toBe(write(edited))
      expect(result.links).toEqual([`${edited} -> ${edited}`])
      expect(result.reopened).toEqual(result.edited)
    })

  test(`typing after a bare URL in ${block} saves the URL and the text`, async () => {
    const result = await edit(write(url), 'https', (text) => {
      const end = text.indexOf('path') + 4
      return [end, end, ' and more']
    })
    expect(result.errors).toEqual([])
    expect(result.saved).toBe(write(`${url} and more`))
    expect(result.links).toEqual([`${url} -> ${url}`])
    expect(result.reopened).toEqual(result.edited)
  })

  test(`an edit that leaves no URL in ${block} saves plain text`, async () => {
    const result = await edit(write(url), 'https', (text) => {
      const start = text.indexOf('https')
      return [start, start + 5, 'htps']
    })
    expect(result.errors).toEqual([])
    expect(result.links).toEqual([])
    expect(result.reopened).toEqual(result.edited)
  })
}

const cases: [
  string,
  string,
  string,
  (text: string) => [number, number, string],
  string[],
][] = [
  [
    'a www address',
    'Go to www.example.com now.\n',
    'www',
    (text: string) => [text.indexOf('.com'), text.indexOf('.com'), 's'],
    ['www.examples.com -> http://www.examples.com'],
  ],
  [
    'an email address',
    'Write to ada@example.com now.\n',
    'ada',
    (text: string) => [text.indexOf('@'), text.indexOf('@'), 'm'],
    ['adam@example.com -> mailto:adam@example.com'],
  ],
  [
    'a URL that gains closing punctuation',
    `See ${url} now.\n`,
    'https',
    (text: string) => [text.indexOf('path') + 4, text.indexOf('path') + 4, '.'],
    [`${url} -> ${url}`],
  ],
  [
    'a URL in parentheses',
    `See (${url}) now.\n`,
    'https',
    (text: string) => [text.indexOf('path') + 4, text.indexOf('path') + 4, 's'],
    ['https://example.com/paths -> https://example.com/paths'],
  ],
  [
    'a URL beside bold text',
    `**Bold** ${url} now.\n`,
    'https',
    (text: string) => [text.indexOf('ample'), text.indexOf('ample'), 'x'],
    ['https://exxample.com/path -> https://exxample.com/path'],
  ],
]
for (const [name, source, anchor, change, links] of cases)
  test(`editing ${name} keeps its link following its text`, async () => {
    const result = await edit(source, anchor, change)
    expect(result.errors).toEqual([])
    expect(result.links).toEqual(links)
    expect(result.reopened).toEqual(result.edited)
  })

test('editing the label of a written link keeps its destination', async () => {
  const result = await edit(`See [the page](${url}) now.\n`, 'page', (text) => [
    text.indexOf('page'),
    text.indexOf('page'),
    'new ',
  ])
  expect(result.saved).toBe(`See [the new page](${url}) now.\n`)
  expect(result.links).toEqual([`the new page -> ${url}`])
})

test('editing a written link whose label is another URL keeps its destination', async () => {
  const result = await edit(
    `See [${url}](https://other.example) now.\n`,
    'https',
    (text) => [text.indexOf('path'), text.indexOf('path'), 's'],
  )
  expect(result.errors).toEqual([])
  expect(result.links).toEqual([
    'https://example.com/spath -> https://other.example',
  ])
  expect(result.reopened).toEqual(result.edited)
})

test('text typed after a bare URL without its link joins the URL', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      ...input,
      generation: 1,
      text: `Visit ${url} today.\n`,
    })
    const view = ctxOf(editor).get(editorViewCtx)
    const end = 1 + 'Visit '.length + url.length
    view.dispatch(view.state.tr.insert(end, view.state.schema.text('s')))
    expect(editor.snapshot().text).toBe(`Visit ${url}s today.\n`)
    const link = view.state.doc.firstChild!.child(1)
    expect([link.text, link.marks[0]?.attrs.href]).toEqual([
      `${url}s`,
      `${url}s`,
    ])
  } finally {
    await editor.destroy()
    root.remove()
  }
})

test('undoing an edit inside a bare URL restores its source', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    const source = `Visit ${url} today.\n`
    editor.loadDocument({ ...input, generation: 1, text: source })
    const view = ctxOf(editor).get(editorViewCtx)
    const end = 1 + 'Visit '.length + url.length
    view.dispatch(view.state.tr.insertText('s', end))
    expect(editor.snapshot().text).toBe(`Visit ${url}s today.\n`)
    editor.undo()
    expect(editor.snapshot().text).toBe(source)
  } finally {
    await editor.destroy()
    root.remove()
  }
})

const typed: [string, string, string, string][] = [
  [
    'a path with parentheses and underscores',
    'See https://en.wikipedia.org/wiki/Foo_(bar) now.\n',
    'Foo',
    'd',
  ],
  ['a query string', 'See https://example.com/?a=1&b=2 now.\n', 'a=1', '0'],
]
for (const [name, source, anchor, insert] of typed) {
  test(`editing ${name} saves the URL as typed`, async () => {
    const result = await edit(source, 'https', (text) => {
      const at = text.indexOf(anchor) + anchor.length
      return [at, at, insert]
    })
    expect(result.errors).toEqual([])
    const edited = source.replace(anchor, anchor + insert)
    expect(result.saved).toBe(edited)
    expect(result.reopened).toEqual(result.edited)
  })
}

for (const [block, write] of blocks) {
  test(`a space typed after a bare URL at the end of ${block} is kept`, async () => {
    const source = block === 'a paragraph' ? `Visit ${url}\n` : write(url)
    const result = await edit(source, 'https', (text) => {
      const end = text.indexOf('path') + 4
      return [end, end, ' ']
    })
    expect(result.errors).toEqual([])
    expect(result.saved).toContain(`<${url}>&#x20;`)
    expect(result.links).toEqual([`${url} -> ${url}`])
    expect(result.reopened).toEqual(result.edited)
  })

  test(`a space typed before a bare URL at the start of ${block} is kept`, async () => {
    const source = block === 'a paragraph' ? `${url} today.\n` : write(url)
    const result = await edit(source, 'https', (text) => {
      const start = text.indexOf('https')
      return [start, start, ' ']
    })
    expect(result.errors).toEqual([])
    expect(result.links).toEqual([`${url} -> ${url}`])
    expect(result.reopened).toEqual(result.edited)
  })
}
