import { nextTask } from './timing'
import { ctxOf } from './editor-access'
import { afterEach, expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import {
  InkKitEditor,
  type FilePresentation,
  type FileReference,
  type WikiLinkReference,
} from '../src/index'

const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})

const text =
  'See [[Plan]] and [[Other]] and ![a](plan.png) and ![[other.png]].\r\n\r\nTail\r\n'

async function mount(source = text) {
  const root = document.createElement('div')
  document.body.append(root)
  const links: WikiLinkReference[] = []
  const files: FileReference[] = []
  const known = new Set<string>()
  const present = new Set<string>()
  const errors: unknown[] = []
  const held: { answer?: Promise<FilePresentation> } = {}
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      error: (error) => errors.push(error),
    },
    {
      wikiLinks: {
        open() {},
        resolve(reference) {
          links.push(reference)
          return { missing: !known.has(reference.target) }
        },
      },
      files: {
        async resolve(reference): Promise<FilePresentation> {
          files.push(reference)
          if (held.answer) return held.answer
          return present.has(reference.target)
            ? { kind: 'file', label: reference.target }
            : { kind: 'missing', label: reference.target }
        },
      },
    },
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'note',
    generation: 1,
    format: 'md',
    text: source,
  })
  await vi.waitFor(() => expect(files.length).toBeGreaterThanOrEqual(2))
  await settle()
  const view = () => ctxOf(editor).get(editorViewCtx)
  const link = (target: string) =>
    [...root.querySelectorAll<HTMLElement>('.inkkit-wiki-link')].find(
      (element) => element.textContent === target,
    )!
  const card = (target: string) =>
    [...root.querySelectorAll<HTMLElement>('.inkkit-file')].find(
      (element) => element.getAttribute('aria-label') === target,
    )!
  const calls = () => links.length + files.length
  return {
    root,
    editor,
    links,
    files,
    known,
    present,
    errors,
    held,
    view,
    link,
    card,
    calls,
  }
}

// Reference resolvers return promises; cross a task only after their continuations.
const settle = nextTask

function observed(state: HTMLElement) {
  const seen: string[] = []
  const observer = new MutationObserver(() =>
    seen.push(state.dataset.inkkitFileState!),
  )
  observer.observe(state, {
    attributes: true,
    attributeFilter: ['data-inkkit-file-state'],
  })
  return { seen, stop: () => observer.disconnect() }
}

// The snapshot is refused during composition, so the revision and undo state stand for it there.
function state(host: Awaited<ReturnType<typeof mount>>) {
  const { composing: _composing, ...command } = host.editor.commandState()
  return {
    text: host.view().state.doc.textContent,
    command,
    selection: host.view().state.selection.toJSON(),
    doc: host.view().state.doc,
  }
}

test('a link that was missing resolves after a named refresh, and nothing else is asked', async () => {
  const host = await mount()
  expect(host.link('Plan').dataset.missing).toBe('true')
  expect(host.link('Other').dataset.missing).toBe('true')
  const before = state(host)
  host.known.add('Plan')
  const asked = host.calls()
  host.editor.refreshReferences(['Plan'])
  expect(host.link('Plan').dataset.missing).toBeUndefined()
  expect(host.link('Plan').title).toBe('')
  expect(host.link('Other').dataset.missing).toBe('true')
  expect(host.calls() - asked).toBe(1)
  await settle()
  expect(host.calls() - asked).toBe(1)
  expect(state(host)).toEqual(before)
  expect(state(host).doc).toBe(before.doc)
  expect(host.errors).toEqual([])
})

test('a file card changes to its new answer without showing a loading card', async () => {
  const host = await mount()
  const element = host.card('plan.png')
  expect(element.dataset.inkkitFileState).toBe('resolved')
  expect(element.dataset.inkkitFileKind).toBe('missing')
  const states = observed(element)
  const before = state(host)
  host.present.add('plan.png')
  host.editor.refreshReferences(['plan.png'])
  await vi.waitFor(() => expect(element.dataset.inkkitFileKind).toBe('file'))
  states.stop()
  expect(states.seen.every((seen) => seen === 'resolved')).toBe(true)
  expect(host.card('other.png').dataset.inkkitFileKind).toBe('missing')
  expect(host.files.filter((r) => r.target === 'plan.png')).toHaveLength(2)
  expect(host.files.filter((r) => r.target === 'other.png')).toHaveLength(1)
  expect(state(host)).toEqual(before)
  expect(host.errors).toEqual([])
})

test('a card whose answer is unchanged is left as it is', async () => {
  const host = await mount()
  const element = host.card('plan.png')
  const footer = element.firstElementChild
  const asked = host.files.length
  host.editor.refreshReferences()
  await vi.waitFor(() => expect(host.files.length).toBe(asked + 2))
  await settle()
  expect(host.card('plan.png')).toBe(element)
  expect(element.firstElementChild).toBe(footer)
})

test('omitting the targets refreshes every reference, and an empty list refreshes none', async () => {
  const host = await mount()
  let asked = host.calls()
  host.editor.refreshReferences([])
  host.editor.refreshReferences(['absent'])
  await settle()
  expect(host.calls()).toBe(asked)
  host.editor.refreshReferences()
  await vi.waitFor(() => expect(host.calls() - asked).toBe(4))
  asked = host.calls()
  host.editor.refreshReferences(undefined, 1)
  await vi.waitFor(() => expect(host.calls() - asked).toBe(4))
})

test('a refresh works in a read-only editor and during composition', async () => {
  const host = await mount()
  host.editor.setEditable(false)
  host.known.add('Plan')
  host.editor.refreshReferences(['Plan'])
  expect(host.link('Plan').dataset.missing).toBeUndefined()
  host.editor.setEditable(true)
  host.present.add('other.png')
  host
    .view()
    .dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
  expect(host.editor.commandState().composing).toBe(true)
  const before = state(host)
  host.known.add('Other')
  host.editor.refreshReferences(['Other', 'other.png'])
  expect(host.link('Other').dataset.missing).toBeUndefined()
  await vi.waitFor(() =>
    expect(host.card('other.png').dataset.inkkitFileKind).toBe('file'),
  )
  expect(state(host)).toEqual(before)
  host
    .view()
    .dom.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
})

test('a stale generation, a bad target and a destroyed editor change nothing', async () => {
  const host = await mount()
  host.known.add('Plan')
  const asked = host.calls()
  expect(() => host.editor.refreshReferences(['Plan'], 2)).toThrow(
    expect.objectContaining({ code: 'stale-document' }),
  )
  for (const bad of ['Plan', [1], [['Plan']], {}])
    expect(() =>
      host.editor.refreshReferences(bad as unknown as string[]),
    ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
  await settle()
  expect(host.calls()).toBe(asked)
  expect(host.link('Plan').dataset.missing).toBe('true')
  await host.editor.destroy()
  expect(() => host.editor.refreshReferences()).toThrow(
    expect.objectContaining({ code: 'destroyed' }),
  )
})

test('an editor with no document loaded rejects the call', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, { changed() {} })
  editors.push(editor)
  expect(() => editor.refreshReferences()).toThrow(
    expect.objectContaining({ code: 'not-ready' }),
  )
})

test('source mode draws no references, so a refresh asks for nothing and formatted mode resolves afresh', async () => {
  const host = await mount()
  host.editor.setEditingMode('source')
  await settle()
  const asked = host.calls()
  host.known.add('Plan')
  host.editor.refreshReferences()
  await settle()
  expect(host.calls()).toBe(asked)
  host.editor.setEditingMode('formatted')
  await vi.waitFor(() =>
    expect(host.link('Plan').dataset.missing).toBeUndefined(),
  )
})

test('a refresh answered after the document reloads is ignored', async () => {
  const host = await mount()
  let release!: (value: FilePresentation) => void
  host.held.answer = new Promise((resolve) => {
    release = resolve
  })
  host.editor.refreshReferences(['plan.png'])
  host.held.answer = undefined
  host.editor.reloadDocument({
    documentId: 'note',
    generation: 2,
    format: 'md',
    text: 'Other\r\n',
  })
  release({ kind: 'file', label: 'late' })
  await settle()
  expect(host.root.querySelector('.inkkit-file')).toBeNull()
  expect(host.errors).toEqual([])
})

test('a host that dispatches the media policy event still redraws wiki links', async () => {
  const host = await mount()
  host.known.add('Plan')
  host.view().dom.dispatchEvent(new Event('inkkit-media-policy'))
  expect(host.link('Plan').dataset.missing).toBeUndefined()
})
