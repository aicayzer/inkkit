import { afterEach, expect, test } from 'vitest'
import { InkKitEditor, type WikiLinkReference } from '../src/core'

const glyph =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Cpath d='M0 0h1v1H0z'/%3E%3C/svg%3E"
const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})

const source =
  '# [[Plan]]\n\nSee [[Plan]] and [[Gone]].\n\n| A |\n| - |\n| [[Plan]] |\n'

async function mount(
  resolve: (reference: WikiLinkReference) => unknown,
  text = source,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (error) => errors.push(error.code) },
    { wikiLinks: { open() {}, resolve: resolve as never } },
  )
  editors.push(editor)
  editor.loadDocument({ documentId: 'note', generation: 1, format: 'md', text })
  const icons = () => [
    ...root.querySelectorAll<HTMLElement>('.inkkit-wiki-link-icon'),
  ]
  return { root, editor, errors, icons }
}

const present = (reference: WikiLinkReference) =>
  reference.target === 'Gone'
    ? { missing: true, icon: glyph }
    : { icon: glyph, iconColor: 'rgb(200, 30, 30)' }

test('a link without a presentation draws no icon and keeps its text as its name', async () => {
  for (const answer of [undefined, {}, { missing: false }]) {
    const { root, icons } = await mount(() => answer)
    expect(icons()).toHaveLength(0)
    const link = root.querySelector('.inkkit-wiki-link')!
    expect(link.textContent).toBe('Plan')
    expect(link.children).toHaveLength(0)
  }
})

test('a presented link has a decoration-only icon in a paragraph, a heading and a table cell', async () => {
  const { root, icons } = await mount(present)
  expect(icons()).toHaveLength(3)
  for (const icon of icons()) {
    const link = icon.closest('.inkkit-wiki-link')!
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.textContent).toBe('')
    expect(link.textContent).toBe('Plan')
    expect(link.getAttribute('role')).toBe('link')
    expect(link.hasAttribute('aria-label')).toBe(false)
    expect(link.firstElementChild).toBe(icon)
    expect(icon.style.getPropertyValue('--_inkkit-wiki-icon')).toContain(
      'image/svg+xml',
    )
    expect(icon.style.getPropertyValue('--_inkkit-wiki-icon-color')).toBe(
      'rgb(200, 30, 30)',
    )
  }
  expect(root.querySelector('h1 .inkkit-wiki-link-icon')).not.toBeNull()
  expect(root.querySelector('td .inkkit-wiki-link-icon')).not.toBeNull()
})

test('the icon is not in the saved bytes, the clipboard, or what undo and redo restore', async () => {
  const { editor, root } = await mount(present)
  const loaded = editor.snapshot().text
  expect(loaded).toBe(source)
  const output = await editor.clipboardSnapshot('document')
  for (const text of [output.text, output.html, output.markdown])
    expect(text).not.toMatch(/inkkit-wiki-link-icon|svg\+xml/)
  expect(output.markdown).toBe(source)
  editor.insertText('x', 1)
  const edited = editor.snapshot().text
  expect(edited).not.toBe(loaded)
  expect(edited.replace('x', '')).toBe(loaded)
  expect(editor.undo()).toBe(true)
  expect(editor.snapshot().text).toBe(loaded)
  expect(editor.redo()).toBe(true)
  expect(editor.snapshot().text).toBe(edited)
  expect(root.querySelectorAll('.inkkit-wiki-link-icon')).toHaveLength(3)
})

test('a missing link shows no icon, and a refresh follows the host answer', async () => {
  let iconic = true
  const { editor, icons, root } = await mount((reference) =>
    iconic ? present(reference) : { missing: reference.target === 'Gone' },
  )
  const gone = [...root.querySelectorAll('.inkkit-wiki-link')].find(
    (link) => link.textContent === 'Gone',
  )!
  expect(gone.getAttribute('data-missing')).toBe('true')
  expect(gone.querySelector('.inkkit-wiki-link-icon')).toBeNull()
  expect(icons()).toHaveLength(3)
  iconic = false
  editor.refreshReferences()
  expect(icons()).toHaveLength(0)
  expect(gone.getAttribute('data-missing')).toBe('true')
})

test.each([
  [
    'an address that loads from the network',
    { icon: 'https://example.test/i.svg' },
  ],
  ['a script address', { icon: 'javascript:void(0)' }],
  ['data that is not an image', { icon: 'data:text/html,<p>x' }],
  [
    'a color that carries a second declaration',
    { icon: glyph, iconColor: 'red; background: url(x)' },
  ],
])(
  'an icon with %s is refused and reported, and the link stays',
  async (_, answer) => {
    const { icons, root, errors } = await mount(() => answer)
    expect(icons()).toHaveLength(0)
    expect(root.querySelectorAll('.inkkit-wiki-link')).toHaveLength(4)
    expect(errors).toContain('file-unavailable')
  },
)

test('source mode draws no links and so no icons', async () => {
  const { editor, root } = await mount(present)
  expect(editor.setEditingMode('source')).toBe(true)
  expect(root.querySelectorAll('.inkkit-wiki-link-icon')).toHaveLength(0)
  expect(editor.snapshot().text).toBe(source)
})
