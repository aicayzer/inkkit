import { afterEach, expect, test } from 'vitest'
import { InkKitEditor, type WikiLinkReference } from '../src/core'

const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})

async function mount(resolve: (reference: WikiLinkReference) => unknown) {
  const root = document.createElement('div')
  document.body.append(root)
  const opened: string[] = []
  const errors: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (error) => errors.push(error.code) },
    {
      labels: { wikiMissing: 'Introuvable' },
      wikiLinks: {
        open: (reference) => void opened.push(reference.target),
        resolve: resolve as never,
      },
    },
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'note',
    generation: 1,
    format: 'md',
    text: '[[Here]] [[Gone]] [[Broken]]\n',
  })
  const link = (text: string) =>
    [...root.querySelectorAll<HTMLElement>('.inkkit-wiki-link')].find(
      (element) => element.textContent === text,
    )!
  return { editor, link, opened, errors }
}

test('a missing link is described with the label, stays enabled and still opens', async () => {
  const { link, opened } = await mount((reference) => {
    if (reference.target === 'Broken') throw new Error('index unavailable')
    return { missing: reference.target === 'Gone' }
  })
  expect(link('Gone').getAttribute('aria-description')).toBe('Introuvable')
  expect(link('Gone').title).toBe('Introuvable')
  expect(link('Gone').hasAttribute('aria-disabled')).toBe(false)
  expect(link('Gone').getAttribute('role')).toBe('link')
  link('Gone').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  )
  expect(opened).toEqual(['Gone'])
  for (const present of ['Here', 'Broken']) {
    expect(link(present).hasAttribute('aria-description')).toBe(false)
    expect(link(present).hasAttribute('title')).toBe(false)
    expect(link(present).hasAttribute('data-missing')).toBe(false)
  }
})

test('the description follows the host answer and is gone when the link resolves', async () => {
  const gone = new Set(['Gone'])
  const { editor, link, errors } = await mount((reference) => ({
    missing: gone.has(reference.target),
  }))
  expect(link('Gone').getAttribute('aria-description')).toBe('Introuvable')
  gone.delete('Gone')
  gone.add('Here')
  editor.refreshReferences()
  expect(link('Gone').hasAttribute('aria-description')).toBe(false)
  expect(link('Gone').hasAttribute('title')).toBe(false)
  expect(link('Here').getAttribute('aria-description')).toBe('Introuvable')
  expect(errors).toEqual([])
})

test('a resolve that throws clears the missing state and reports the failure', async () => {
  let fail = false
  const { editor, link, errors } = await mount((reference) => {
    if (fail) throw new Error('index unavailable')
    return { missing: reference.target === 'Gone' }
  })
  expect(link('Gone').getAttribute('aria-description')).toBe('Introuvable')
  fail = true
  editor.refreshReferences(['Gone'])
  expect(link('Gone').hasAttribute('aria-description')).toBe(false)
  expect(link('Gone').hasAttribute('data-missing')).toBe(false)
  expect(errors).toEqual(['file-unavailable'])
})
