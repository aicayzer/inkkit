import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/index'
import { isSafeLinkTarget } from '../src/link-safety'

// The address a rendered link carries, and so what Mod-click hands the host,
// follows the same list as HTML import and print.
const addresses: [string, boolean][] = [
  ['https://example.com/a', true],
  ['HTTP://example.com/b', true],
  ['mailto:someone@example.com', true],
  ['tel:+441234567890', true],
  ['notes/a.md', true],
  ['#intro', true],
  ['?q=1', true],
  ['ftp://example.com/file', false],
  ['javascript:alert(1)', false],
  ['data:text/html,x', false],
  ['file:///etc/hosts', false],
  ['app://open/note', false],
]

test('rendered links keep only addresses on InkKit’s list, and only those open', async () => {
  const opened: string[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink: (href) => opened.push(href),
  })
  const text =
    addresses
      .map(([address], index) => `[L${index}](${address})`)
      .join('\n\n') + '\n'
  try {
    editor.loadDocument({
      documentId: 'links',
      generation: 1,
      format: 'md',
      text,
    })
    const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
    expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual(
      addresses.map(([address, safe]) => {
        expect(isSafeLinkTarget(address)).toBe(safe)
        return safe ? address : ''
      }),
    )
    // The test setup reports a Mac, so Mod is Command.
    for (const anchor of anchors)
      anchor.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      )
    expect(opened).toEqual(
      addresses.filter(([, safe]) => safe).map(([address]) => address),
    )
    const copied = await editor.clipboardSnapshot()
    expect(copied.html).not.toMatch(/ftp:|javascript:|data:text|file:|app:/)
    expect(editor.snapshot().text).toBe(text)
  } finally {
    await editor.destroy()
    root.remove()
  }
})

test('a copied link whose address is not kept pastes back as its text', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  const load = (generation: number, text: string) =>
    editor.loadDocument({ documentId: 'links', generation, format: 'md', text })
  try {
    load(1, 'X [F](ftp://h/x) [J](javascript:alert(1)) [E]() [H](https://h/)\n')
    const copied = await editor.clipboardSnapshot()
    expect(copied.html).not.toMatch(/ftp:|javascript:/)
    expect(copied.html.match(/<a\b[^>]*>[^<]*<\/a>/g)).toEqual([
      '<a href="" data-inkkit-link-form="written">E</a>',
      '<a href="https://h/" data-inkkit-link-form="written">H</a>',
    ])
    load(2, '\n')
    await editor.paste({ text: copied.text, html: copied.html })
    expect(editor.snapshot().text).toBe('X F J [E]() [H](https://h/)\n')
  } finally {
    await editor.destroy()
    root.remove()
  }
})

// `linkSchemes` adds schemes for one editor. It leaves pasted and printed HTML as strict as before.
const hostLinks = [
  ['things:///add?title=One', 'things'],
  ['Message:%3Cid@host%3E', 'message'],
  ['x-devonthink-item://UUID-1', 'x-devonthink-item'],
  ['obsidian://open?vault=a', 'obsidian'],
] as const

interface Mounted {
  editor: InkKitEditor
  root: HTMLElement
  opened: string[]
  errors: string[]
}

async function withEditors<T>(
  optionsList: (Parameters<typeof InkKitEditor.mount>[2] | undefined)[],
  run: (editors: [Mounted, Mounted, Mounted]) => Promise<T>,
): Promise<T> {
  const mounted: Mounted[] = []
  try {
    for (const options of optionsList) {
      const root = document.createElement('div')
      document.body.append(root)
      const opened: string[] = []
      const errors: string[] = []
      const editor = await InkKitEditor.mount(
        root,
        {
          changed() {},
          copy() {},
          openLink: (href) => opened.push(href),
          error: (error) => errors.push(error.code),
        },
        options,
      )
      mounted.push({ editor, root, opened, errors })
    }
    return await run(mounted as [Mounted, Mounted, Mounted])
  } finally {
    for (const { editor, root } of mounted) {
      await editor.destroy()
      root.remove()
    }
  }
}

const links = (text: string) => ({
  documentId: 'links',
  generation: 1,
  format: 'md' as const,
  text,
})

const hrefs = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].map((anchor) =>
    anchor.getAttribute('href'),
  )

const click = (anchor: Element) =>
  anchor.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
  )

test('a listed scheme is rendered, opens through openLink and is kept when copied, whatever its letter case', async () => {
  const text =
    hostLinks
      .map(([address], index) => `[L${index}](${address})`)
      .join('\n\n') + '\n'
  await withEditors(
    [{ linkSchemes: ['things', 'MESSAGE', 'X-DevonThink-Item', 'Obsidian'] }],
    async ([{ editor, root, opened, errors }]) => {
      editor.loadDocument(links(text))
      expect(hrefs(root)).toEqual(hostLinks.map(([address]) => address))
      for (const anchor of root.querySelectorAll('a[href]')) click(anchor)
      expect(opened).toEqual(hostLinks.map(([address]) => address))
      const copied = await editor.clipboardSnapshot()
      for (const [address] of hostLinks)
        expect(copied.html).toContain(`href="${address}"`)
      expect(editor.snapshot().text).toBe(text)
      expect(errors).toEqual([])
    },
  )
})

test('an unlisted scheme, and a refused one, still render empty and do not open', async () => {
  const unsafe = [
    'ftp://h/x',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    'file:///etc/hosts',
    'app://open/note',
    // A control character inside the scheme stops it reading as a listed one.
    'thi%00ngs:x',
  ]
  const text = unsafe.map((address, i) => `[L${i}](${address})`).join('\n\n')
  await withEditors(
    [{ linkSchemes: ['things'] }],
    async ([{ editor, root, opened }]) => {
      editor.loadDocument(links(`${text}\n\n[T](things:///ok)\n`))
      expect(hrefs(root)).toEqual([...unsafe.map(() => ''), 'things:///ok'])
      for (const anchor of root.querySelectorAll('a[href]')) click(anchor)
      expect(opened).toEqual(['things:///ok'])
      const copied = await editor.clipboardSnapshot()
      expect(copied.html).not.toMatch(
        /ftp:|javascript:|data:text|vbscript:|file:|app:/i,
      )
    },
  )
})

test('format(link) takes a listed scheme, and still refuses the others and control characters', () =>
  withEditors(
    [{ linkSchemes: ['things'] }, undefined],
    async ([listed, plain]) => {
      for (const { editor } of [listed, plain]) {
        editor.loadDocument(links('Open here\n'))
        editor.find('Open')
      }
      const refused = (editor: InkKitEditor, destination: string) =>
        expect(() => editor.format('link', { destination })).toThrow(
          expect.objectContaining({ code: 'invalid-argument' }),
        )
      for (const destination of [
        'ftp://h/x',
        'javascript:alert(1)',
        'file:///x',
        'thi\ngs:x',
        'things\u0000:x',
        '',
      ])
        refused(listed.editor, destination)
      // Without the option, behaviour is unchanged.
      refused(plain.editor, 'things:///add')
      expect(plain.editor.snapshot().text).toBe('Open here\n')
      expect(
        listed.editor.format('link', { destination: 'Things:///add?title=a' }),
      ).toBe(true)
      expect(listed.editor.snapshot().text).toBe(
        '[Open](Things:///add?title=a) here\n',
      )
      expect(hrefs(listed.root)).toEqual(['Things:///add?title=a'])
    },
  ))

test.each([
  ['javascript'],
  ['JaVaScRiPt'],
  ['DATA'],
  ['vbscript'],
  ['File'],
  ['file'],
])('linkSchemes refuses %s at mount', async (scheme) => {
  const root = document.createElement('div')
  await expect(
    InkKitEditor.mount(
      root,
      { changed() {} },
      { linkSchemes: ['things', scheme] },
    ),
  ).rejects.toMatchObject({ code: 'invalid-argument' })
})

test.each([
  ['a name with a colon', 'things:'],
  ['a name with a slash', 'things//'],
  ['an empty name', ''],
  ['a name that starts with a digit', '1things'],
  ['a name that starts with a dash', '-things'],
  ['a name with a space', 'my things'],
  ['a name with leading space', ' things'],
  ['a name with a line break', 'things\n'],
  ['a name with a control character', 'thi\u0000ngs'],
  ['a name with a DEL character', 'things\u007f'],
  ['a name with a non-ASCII letter', 'th\u00efngs'],
  ['a name that is not text', 5],
  ['a null entry', null],
])('linkSchemes refuses %s at mount', async (_name, entry) => {
  const root = document.createElement('div')
  await expect(
    InkKitEditor.mount(
      root,
      { changed() {} },
      { linkSchemes: ['ok', entry] as never },
    ),
  ).rejects.toMatchObject({ code: 'invalid-argument' })
})

test('linkSchemes must be a list, and null or an empty list changes nothing', async () => {
  for (const value of ['things', { 0: 'things' }, 3, true])
    await expect(
      InkKitEditor.mount(
        document.createElement('div'),
        { changed() {} },
        { linkSchemes: value as never },
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  await withEditors(
    [{ linkSchemes: null as never }, { linkSchemes: [] }, {}],
    async (editors) => {
      for (const { editor, root, opened } of editors) {
        editor.loadDocument(links('[T](things:///x) [H](https://h/)\n'))
        expect(hrefs(root)).toEqual(['', 'https://h/'])
        for (const anchor of root.querySelectorAll('a[href]')) click(anchor)
        expect(opened).toEqual(['https://h/'])
      }
    },
  )
})

test('a scheme the editor already allows is accepted and changes nothing', () =>
  withEditors(
    [{ linkSchemes: ['https', 'HTTP', 'mailto', 'tel', 'things', 'things'] }],
    async ([{ editor, root }]) => {
      editor.loadDocument(
        links('[A](https://h/) [B](things:///x) [C](ftp://h)\n'),
      )
      expect(hrefs(root)).toEqual(['https://h/', 'things:///x', ''])
    },
  ))

test('two editors on one page keep their own schemes', () =>
  withEditors(
    [
      { linkSchemes: ['things'] },
      { linkSchemes: ['message', 'obsidian'] },
      undefined,
    ],
    async ([one, two, none]) => {
      const text =
        '[T](things:///x) [M](message:%3Ca%3E) [O](obsidian://open)\n'
      for (const { editor } of [one, two, none])
        editor.loadDocument(links(text))
      expect(hrefs(one.root)).toEqual(['things:///x', '', ''])
      expect(hrefs(two.root)).toEqual([
        '',
        'message:%3Ca%3E',
        'obsidian://open',
      ])
      expect(hrefs(none.root)).toEqual(['', '', ''])
      // Loading and copying in one editor does not change the other.
      const copies = await Promise.all(
        [one, two, none].map(({ editor }) => editor.clipboardSnapshot()),
      )
      expect(copies.map((copy) => copy.html.match(/href="[^"]+"/g))).toEqual([
        ['href="things:///x"'],
        ['href="message:%3Ca%3E"', 'href="obsidian://open"'],
        null,
      ])
      for (const { root } of [one, two, none])
        for (const anchor of root.querySelectorAll('a[href]')) click(anchor)
      expect(one.opened).toEqual(['things:///x'])
      expect(two.opened).toEqual(['message:%3Ca%3E', 'obsidian://open'])
      expect(none.opened).toEqual([])
      expect(() =>
        two.editor.format('link', { destination: 'things:///x' }),
      ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
      // Destroying one leaves the other's policy in place.
      await one.editor.destroy()
      expect(hrefs(two.root)).toEqual([
        '',
        'message:%3Ca%3E',
        'obsidian://open',
      ])
    },
  ))

test('pasted and printed HTML keep only the built-in schemes', () =>
  withEditors([{ linkSchemes: ['things'] }], async ([{ editor, errors }]) => {
    editor.loadDocument(links('[T](things:///x) and [H](https://h/)\n'))
    const copied = await editor.clipboardSnapshot()
    expect(copied.html).toContain('href="things:///x"')
    editor.loadDocument({ ...links('\n'), generation: 2 })
    await editor.paste({ text: copied.text, html: copied.html })
    expect(editor.snapshot().text).toBe('T and [H](https://h/)\n')
    editor.loadDocument({
      ...links('[T](things:///x) and [H](https://h/)\n'),
      generation: 3,
    })
    const printable = await editor.printableSnapshot()
    expect(printable.html).not.toContain('things:')
    expect(printable.html).toContain('https://h/')
    editor.loadDocument({ ...links('\n'), generation: 4 })
    await editor.paste({
      text: 'T',
      html: '<a href="things:///x">T</a> <a href="THINGS:///y">U</a>',
    })
    expect(editor.snapshot().text).toBe('T U\n')
    expect(errors).toEqual([])
  }))

test('a DOM copy event keeps a listed scheme in its HTML', () =>
  withEditors([{ linkSchemes: ['things'] }], async ([{ editor, root }]) => {
    editor.loadDocument(links('[T](things:///x)\n'))
    const target = root.querySelector('.ProseMirror')!
    editor.find('T')
    const data = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.assign(event, {
      clipboardData: {
        setData: (type: string, value: string) => data.set(type, value),
      },
    })
    target.dispatchEvent(event)
    expect(data.get('text/html')).toContain('href="things:///x"')
  }))
