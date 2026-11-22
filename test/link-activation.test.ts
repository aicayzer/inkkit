import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  InkKitEditor,
  type EditorOptions,
  type LinkMenuTarget,
  type WikiLinkReference,
} from '../src/core'

const editors: InkKitEditor[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  vi.useRealTimers()
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})

const text =
  [
    'A [plain link](https://example.com/a) here.',
    'A [**bold** and *italic* link](https://example.com/b) there.',
    '[ref link][r] and [[Note#Part|Shown]] and [bad](javascript:alert) and [empty]().',
    '[r]: https://example.com/ref',
  ].join('\n\n') + '\n'

interface Seen {
  opened: string[]
  wiki: WikiLinkReference[]
  menus: { link: LinkMenuTarget; point: { clientX: number; clientY: number } }[]
  errors: string[]
}

async function mount(
  {
    events = {},
    options = {},
    editable = true,
  }: {
    events?: Record<string, unknown>
    options?: EditorOptions
    editable?: boolean
  } = {},
  source = text,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const seen: Seen = { opened: [], wiki: [], menus: [], errors: [] }
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      openLink: (href) => seen.opened.push(href),
      linkMenu: (link, point) => seen.menus.push({ link, point }),
      error: (error) => seen.errors.push(error.code),
      ...events,
    },
    {
      wikiLinks: { open: (reference) => seen.wiki.push(reference) },
      ...options,
    },
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'links',
    generation: 1,
    format: 'md',
    text: source,
  })
  if (!editable) editor.setEditable(false)
  const anchor = (label: string) =>
    [...root.querySelectorAll<HTMLElement>('a[href]')].find(
      (element) => element.textContent === label,
    )!
  const wiki = (label: string) =>
    [...root.querySelectorAll<HTMLElement>('.inkkit-wiki-link')].find(
      (element) => element.textContent === label,
    )!
  return { editor, root, seen, anchor, wiki }
}

const click = (target: Element, init: MouseEventInit = {}) =>
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
  )
const hover = (target: Element, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerType: 'mouse',
      ...init,
    }),
  )
const menu = (target: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 31,
    clientY: 47,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

// The test setup reports a Mac, so Mod is Command.
test('in an editor that can be edited, a plain click only places the caret and Mod-click opens', async () => {
  const { anchor, wiki, seen } = await mount()
  for (const target of [anchor('plain link'), wiki('Shown')]) {
    click(target)
    click(target, { ctrlKey: true })
    click(target, { metaKey: true, button: 2 })
  }
  expect(seen.opened).toEqual([])
  expect(seen.wiki).toEqual([])
  click(anchor('plain link'), { metaKey: true })
  click(wiki('Shown'), { metaKey: true })
  expect(seen.opened).toEqual(['https://example.com/a'])
  expect(seen.wiki.map((reference) => reference.label)).toEqual(['Shown'])
})

test('in an editor that cannot be edited, a plain click opens, and turning editing back on stops it', async () => {
  const { editor, anchor, wiki, seen } = await mount({ editable: false })
  click(anchor('plain link'))
  click(wiki('Shown'))
  click(anchor('plain link'), { metaKey: true })
  click(wiki('Shown'), { metaKey: true })
  expect(seen.opened).toEqual([
    'https://example.com/a',
    'https://example.com/a',
  ])
  expect(seen.wiki).toHaveLength(2)
  // A secondary button, and an unopenable address, open nothing.
  click(anchor('plain link'), { button: 2 })
  click(anchor('bad'))
  click(anchor('empty'))
  expect(seen.opened).toHaveLength(2)
  editor.setEditable(true)
  click(anchor('plain link'))
  click(wiki('Shown'))
  expect(seen.opened).toHaveLength(2)
  expect(seen.wiki).toHaveLength(2)
})

test('a click that ends a text selection, or the second click of a double click, opens nothing', async () => {
  const { anchor, wiki, seen } = await mount({ editable: false })
  click(anchor('plain link'), { detail: 2 })
  click(wiki('Shown'), { detail: 2 })
  const target = anchor('plain link')
  const selection = document.getSelection()!
  selection.selectAllChildren(target)
  click(target)
  expect(seen.opened).toEqual([])
  expect(seen.wiki).toEqual([])
  selection.removeAllRanges()
  click(target)
  expect(seen.opened).toEqual(['https://example.com/a'])
})

test('a read-only editor without a link handler opens nothing and still keeps the browser from following', async () => {
  const { anchor, seen } = await mount({
    editable: false,
    events: { openLink: undefined },
  })
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  anchor('plain link').dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(seen.opened).toEqual([])
})

test('the root shows Mod held over the editor, and not once it is released or the window loses focus', async () => {
  const { root, anchor } = await mount()
  hover(anchor('plain link'))
  expect(root.classList.contains('inkkit-link-modifier')).toBe(false)
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }),
  )
  expect(root.classList.contains('inkkit-link-modifier')).toBe(true)
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
  expect(root.classList.contains('inkkit-link-modifier')).toBe(false)
})

const rested = () => vi.advanceTimersByTime(700)
const hint = (root: Element) => root.querySelector('.inkkit-link-hint')

test('a link the pointer rests on shows the hint, outside the document, and it goes away', async () => {
  const { editor, root, anchor, wiki } = await mount()
  const before = editor.snapshot().text
  const surface = root.querySelector('.ProseMirror')!
  hover(anchor('plain link'))
  expect(hint(root)).toBeNull()
  rested()
  expect(hint(root)?.textContent).toBe('⌘-click to open')
  expect(hint(root)?.getAttribute('role')).toBe('tooltip')
  expect(surface.contains(hint(root))).toBe(false)
  expect(editor.snapshot().text).toBe(before)
  root.dispatchEvent(new PointerEvent('pointerleave'))
  expect(hint(root)).toBeNull()
  hover(wiki('Shown'))
  rested()
  expect(hint(root)?.textContent).toBe('⌘-click to open')
  surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(hint(root)).toBeNull()
  // The copy and the saved text never carry it.
  hover(anchor('plain link'))
  rested()
  expect((await editor.clipboardSnapshot()).html).not.toContain('click to open')
  expect(editor.snapshot().text).toBe(before)
})

test('the hint follows the host label, and an empty label draws none', async () => {
  const { root, anchor } = await mount({
    options: { labels: { linkOpenHint: 'Cmd-clic pour ouvrir' } },
  })
  hover(anchor('plain link'))
  rested()
  expect(hint(root)?.textContent).toBe('Cmd-clic pour ouvrir')
  const silent = await mount({ options: { labels: { linkOpenHint: '' } } })
  hover(silent.anchor('plain link'))
  rested()
  expect(hint(silent.root)).toBeNull()
})

test('no hint where it would mislead: read-only, Mod held, touch, no handler, no address, or a tooltip already', async () => {
  const readOnly = await mount({ editable: false })
  hover(readOnly.anchor('plain link'))
  rested()
  expect(hint(readOnly.root)).toBeNull()

  const { root, anchor, wiki } = await mount()
  hover(anchor('plain link'), { metaKey: true })
  rested()
  expect(hint(root)).toBeNull()
  root.dispatchEvent(new PointerEvent('pointerleave'))

  hover(anchor('plain link'), { pointerType: 'touch' })
  rested()
  expect(hint(root)).toBeNull()
  hover(anchor('bad'))
  rested()
  expect(hint(root)).toBeNull()
  hover(anchor('empty'))
  rested()
  expect(hint(root)).toBeNull()
  // A link that moves the pointer away before the delay never shows it.
  hover(anchor('plain link'))
  vi.advanceTimersByTime(300)
  hover(root.querySelector('p')!)
  rested()
  expect(hint(root)).toBeNull()

  const titled = await mount({}, '[titled](https://example.com "Authored")\n')
  hover(titled.anchor('titled'))
  rested()
  expect(hint(titled.root)).toBeNull()

  const none = await mount({ events: { openLink: undefined } })
  hover(none.anchor('plain link'))
  rested()
  expect(hint(none.root)).toBeNull()
  // A wiki link opens through its adapter, so it needs no link handler.
  hover(none.wiki('Shown'))
  rested()
  expect(hint(none.root)).not.toBeNull()
  void wiki
})

test('a context menu on a web link selects it and hands the host its facts', async () => {
  const { editor, anchor, seen } = await mount()
  const event = menu(anchor('plain link'))
  expect(event.defaultPrevented).toBe(true)
  expect(seen.menus).toHaveLength(1)
  const { link, point } = seen.menus[0]!
  expect(point).toEqual({ clientX: 31, clientY: 47 })
  expect(link).toMatchObject({
    kind: 'web',
    href: 'https://example.com/a',
    openable: true,
    text: 'plain link',
  })
  const snapshot = editor.textSnapshot()
  expect(snapshot.selection).toEqual(link.range)
  expect(snapshot.text.slice(link.range.from, link.range.to)).toBe('plain link')
  expect(editor.commandState().caret.marks).toContain('link')
})

test('a link split by formatting is one link, and a reference link gives its definition address', async () => {
  const { editor, anchor, seen } = await mount()
  const bold = anchor('bold')
  menu(bold)
  menu(anchor('ref link'))
  const [split, reference] = seen.menus.map(({ link }) => link)
  expect(split).toMatchObject({
    kind: 'web',
    href: 'https://example.com/b',
    text: 'bold and italic link',
  })
  expect(reference).toMatchObject({
    kind: 'web',
    href: 'https://example.com/ref',
    text: 'ref link',
  })
  void editor
})

test('an address Inkkit does not open is marked, and still reaches the menu', async () => {
  const { anchor, seen } = await mount()
  menu(anchor('bad'))
  menu(anchor('empty'))
  expect(seen.menus.map(({ link }) => link)).toMatchObject([
    { kind: 'web', href: 'javascript:alert', openable: false },
    { kind: 'web', href: '', openable: false },
  ])
  const things = await mount(
    { options: { linkSchemes: ['things'] } },
    '[todo](things:///add) [rel](notes/a.md)\n',
  )
  menu(things.anchor('todo'))
  menu(things.anchor('rel'))
  expect(things.seen.menus.map(({ link }) => link)).toMatchObject([
    { href: 'things:///add', openable: true },
    { href: 'notes/a.md', openable: true },
  ])
})

test('a context menu on a wiki link selects it and hands the host its reference', async () => {
  const { editor, wiki, seen } = await mount()
  const event = menu(wiki('Shown'))
  expect(event.defaultPrevented).toBe(true)
  const { link } = seen.menus[0]!
  expect(link).toMatchObject({
    kind: 'wiki',
    text: 'Shown',
    reference: {
      raw: '[[Note#Part|Shown]]',
      target: 'Note',
      fragment: 'Part',
      label: 'Shown',
    },
  })
  expect(editor.textSnapshot().selection).toEqual(link.range)
})

test('the host edits and removes the selected web link with the format command', async () => {
  const { editor, anchor, seen } = await mount()
  menu(anchor('bold'))
  expect(editor.commandState().commands.format.link).toBe(true)
  expect(editor.commandState().caret.href).toBe('https://example.com/b')
  expect(
    editor.format('link', { destination: 'https://example.com/new' }),
  ).toBe(true)
  expect(editor.snapshot().text).toContain(
    '[**bold** and *italic* link](https://example.com/new)',
  )
  menu(anchor('plain link'))
  expect(editor.format('link')).toBe(true)
  expect(editor.snapshot().text).toContain('A plain link here.')
  expect(seen.errors).toEqual([])
})

test('the host can remove a wiki link, keeping its text', async () => {
  const { editor, wiki, seen } = await mount()
  menu(wiki('Shown'))
  const { link } = seen.menus[0]!
  expect(link.kind).toBe('wiki')
  expect(editor.pasteAsPlainText('Shown')).toBe(true)
  expect(editor.snapshot().text).toContain('and Shown and')
  expect(editor.snapshot().text).not.toContain('[[Note')
})

test('the host rewrites the selected wiki link by pasting its new Markdown', async () => {
  const { editor, wiki } = await mount()
  menu(wiki('Shown'))
  await editor.paste({ text: '', markdown: '[[Other|Shown]]' })
  expect(editor.snapshot().text).toContain('[[Other|Shown]]')
  expect(editor.snapshot().text).not.toContain('[[Note')
})

test('a read-only editor still hands over the menu, and one without a handler keeps the web view menu', async () => {
  const readOnly = await mount({ editable: false })
  menu(readOnly.anchor('plain link'))
  menu(readOnly.wiki('Shown'))
  expect(readOnly.seen.menus.map(({ link }) => link.kind)).toEqual([
    'web',
    'wiki',
  ])

  const none = await mount({ events: { linkMenu: undefined } })
  expect(menu(none.anchor('plain link')).defaultPrevented).toBe(false)
  expect(menu(none.wiki('Shown')).defaultPrevented).toBe(false)
  expect(none.editor.textSnapshot().selection.from).toBe(
    none.editor.textSnapshot().selection.to,
  )
})

test('a context menu off a link, or in source mode, is left to the web view', async () => {
  const { editor, root, seen } = await mount()
  expect(menu(root.querySelector('p')!).defaultPrevented).toBe(false)
  editor.setEditingMode('source')
  expect(
    menu(root.querySelector('.inkkit-source') ?? root).defaultPrevented,
  ).toBe(false)
  expect(seen.menus).toEqual([])
})

test('a link menu changes neither the document nor its history', async () => {
  const { editor, anchor, wiki } = await mount()
  const before = editor.snapshot()
  menu(anchor('plain link'))
  menu(wiki('Shown'))
  expect(editor.snapshot()).toEqual(before)
  expect(editor.commandState().commands.undo).toBe(false)
})

test('a handler that throws is the host’s problem and the menu is still handled', async () => {
  const reported: unknown[] = []
  vi.stubGlobal('reportError', (error: unknown) => reported.push(error))
  const { anchor, seen } = await mount({
    events: {
      linkMenu: () => {
        throw new Error('menu failed')
      },
    },
  })
  expect(menu(anchor('plain link')).defaultPrevented).toBe(true)
  expect(reported).toHaveLength(1)
  expect(seen.errors).toEqual([])
  vi.unstubAllGlobals()
})

test('the open-link binding follows ProseMirror notation: Mod-O is Command-Shift-O, and Mod-Shift-Enter is a free example', async () => {
  const { editor, seen } = await mount(
    {},
    'A [link](https://example.com/k) here.\n',
  )
  editor.find('link')
  editor.setKeymap({ openLink: ['Mod-O'] })
  expect(editor.keyDown({ key: 'o', metaKey: true }, 1)).toBe(false)
  expect(editor.keyDown({ key: 'O', metaKey: true, shiftKey: true }, 1)).toBe(
    true,
  )
  expect(seen.opened).toEqual(['https://example.com/k'])
  editor.setKeymap({ openLink: ['Mod-o'] })
  expect(editor.keyDown({ key: 'o', metaKey: true }, 1)).toBe(true)
  editor.setKeymap({ openLink: ['Mod-Shift-Enter'] })
  expect(
    editor.keyDown({ key: 'Enter', metaKey: true, shiftKey: true }, 1),
  ).toBe(true)
  expect(seen.opened).toHaveLength(3)
  editor.keyDown({ key: 'Enter' }, 1)
  expect(seen.opened).toHaveLength(3)
})

test('Enter and Space on a focused wiki link still open it', async () => {
  const { wiki, seen } = await mount()
  for (const key of ['Enter', ' '])
    wiki('Shown').dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  expect(seen.wiki).toHaveLength(2)
})
