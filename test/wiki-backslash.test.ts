import { afterEach, expect, test } from 'vitest'
import {
  InkKitEditor,
  type DocumentInput,
  type WikiLinkReference,
} from '../src/core'

// Marfa reads a backslash in a wiki link as an ordinary character, so a link written there
// opens the same note in both editors.
const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})
async function open(text: string, format: DocumentInput['format'] = 'md') {
  const root = document.createElement('div')
  document.body.append(root)
  const opened: WikiLinkReference[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {} },
    { wikiLinks: { open: (reference) => opened.push({ ...reference }) } },
  )
  editors.push(editor)
  editor.loadDocument({ documentId: 'w', generation: 1, format, text })
  const links = () =>
    [...root.querySelectorAll('.inkkit-wiki-link')].map(
      (node) => node.textContent,
    )
  return { editor, root, opened, links }
}
const press = (root: HTMLElement, index = 0) =>
  root
    .querySelectorAll('[role=link]')
    [index]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )

for (const ending of ['\n', '\r\n']) {
  test(`\\[[escaped]] is a link named escaped, and [[x\\]] is a link named x\\ (${JSON.stringify(ending)})`, async () => {
    const source = `\\[[escaped]] then [[x\\]]${ending}`
    const { editor, root, opened, links } = await open(source)
    expect(links()).toEqual(['escaped', 'x\\'])
    expect(root.querySelector('p')?.textContent?.startsWith('\\')).toBe(true)
    press(root, 0)
    press(root, 1)
    expect(opened.map(({ target, raw }) => [target, raw])).toEqual([
      ['escaped', '[[escaped]]'],
      ['x\\', '[[x\\]]'],
    ])
    expect(editor.snapshot().text).toBe(source)
  })
}

test('the source survives an edit in the same paragraph and in other blocks', async () => {
  const source =
    '\\[[escaped]] and [[x\\]]\n\n| a |\n| - |\n| \\[[cell]] [[y\\]] |\n\nTail\n'
  const { editor, links } = await open(source)
  expect(links()).toEqual(['escaped', 'x\\', 'cell', 'y\\'])
  for (const marker of ['and', 'cell', 'Tail']) {
    const snapshot = editor.textSnapshot()
    const at = snapshot.text.indexOf(marker) + marker.length
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: at,
      to: at,
    })
    editor.insertText('!', 1)
  }
  expect(editor.snapshot().text).toBe(
    '\\[[escaped]] and! [[x\\]]\n\n| a |\n| - |\n| \\[[cell]]! [[y\\]] |\n\nTail!\n',
  )
  expect(editor.undo()).toBe(true)
  expect(editor.undo()).toBe(true)
  expect(editor.undo()).toBe(true)
  expect(editor.snapshot().text).toBe(source)
})

test('an escaped backslash and an escaped bracket are still CommonMark escapes', async () => {
  const source = '\\\\[[Two]] and \\[x] and \\[y\n'
  const { editor, links } = await open(source)
  expect(links()).toEqual(['Two'])
  expect(editor.snapshot().text).toBe(source)
})

test('backslashes are plain in the alias and fragment, and a bracket still cannot be escaped', async () => {
  const { editor, links } = await open('[[a\\b#c\\d|e\\f]] and [[g\\|h]]\n')
  expect(links()).toEqual(['e\\f', 'h'])
  const source = '[[i\\]j]]\n'
  const unsupported = await open(source)
  expect(unsupported.links()).toEqual([])
  expect(unsupported.editor.snapshot().text).toBe(source)
  expect(editor.snapshot().text).toBe('[[a\\b#c\\d|e\\f]] and [[g\\|h]]\n')
})

test('without a wiki link adapter a backslash before brackets keeps its CommonMark meaning', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, { changed() {} })
  editors.push(editor)
  editor.loadDocument({
    documentId: 'w',
    generation: 1,
    format: 'md',
    text: '\\[[escaped]] [[x\\]]\n',
  })
  expect(root.querySelectorAll('.inkkit-wiki-link')).toHaveLength(0)
  expect(editor.snapshot().text).toBe('\\[[escaped]] [[x\\]]\n')
})
