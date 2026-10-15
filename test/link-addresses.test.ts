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
    stateChanged() {},
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
    stateChanged() {},
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
