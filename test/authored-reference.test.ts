import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { Schema } from '@milkdown/kit/prose/model'
import type { Ctx } from '@milkdown/kit/ctx'
import { fileReference } from '../src/linked-syntax'
import {
  InkKitEditor,
  InkKitError,
  type FileReference,
  type WikiLinkReference,
} from '../src/index'

async function mount(
  text: string,
  adapters: { files?: boolean; wikiLinks?: boolean } = {
    files: true,
    wikiLinks: true,
  },
) {
  const root = document.createElement('div')
  document.body.append(root)
  const files: FileReference[] = []
  const links: WikiLinkReference[] = []
  const menus: FileReference[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {} },
    {
      ...(adapters.files && {
        files: {
          resolve: async (reference) => {
            files.push(reference)
            return { kind: 'file', label: reference.target }
          },
          contextMenu: (reference) => menus.push(reference),
        },
      }),
      ...(adapters.wikiLinks && {
        wikiLinks: {
          open() {},
          resolve: (reference) => {
            links.push(reference)
            return undefined
          },
        },
      }),
    },
  )
  editor.loadDocument({ documentId: 'note', generation: 1, format: 'md', text })
  const done = async () => {
    await editor.destroy()
    root.remove()
  }
  return { editor, files, links, menus, done }
}

const raws = (references: FileReference[]) =>
  references.map((reference) => reference.raw)

test('a file reference carries its embed as written, escapes and table pipes included', async () => {
  const text =
    'Edit ![a b|120](a\\_b.png "T") and ![[x\\#y.png|300]].\r\n\r\n| h |\r\n| - |\r\n| ![[t.png\\|200]] |\r\n'
  const { editor, files, menus, done } = await mount(text)
  try {
    await vi.waitFor(() => expect(files).toHaveLength(3))
    const written = [
      '![a b|120](a\\_b.png "T")',
      '![[x\\#y.png|300]]',
      '![[t.png\\|200]]',
    ]
    expect(raws(files)).toEqual(written)
    expect(files[0]!.target).toBe('a_b.png')

    // An edit beside the embeds keeps their text, and so their raw form.
    expect(editor.find('Edit', 1)).toBe(true)
    expect(editor.insertText('Changed', 1)).toBe(true)
    expect(editor.snapshot().text).toContain(written[0])
    document
      .querySelector('.inkkit-file')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(raws(menus)).toEqual([written[0]])
  } finally {
    await done()
  }
})

test('an image with no authored text carries the text InkKit writes for it', async () => {
  const { editor, files, done } = await mount('Text\n')
  try {
    expect(
      editor.insertImages([{ reference: 'new file_1.png', alt: 'New|80' }]),
    ).toBe(true)
    await vi.waitFor(() => expect(files).toHaveLength(1))
    expect(editor.snapshot().text).toContain(files[0]!.raw)
    expect(files[0]!.raw).toMatch(/^!\[New\|80\]\(.+\)$/)
  } finally {
    await done()
  }
})

test('a wiki link carries its text as written, telling an alias equal to the name apart', async () => {
  const { links, done } = await mount(
    '[[Plan]] and [[Plan|Plan]] and [[A\\|B]]\n',
  )
  try {
    await vi.waitFor(() => expect(links.length).toBeGreaterThanOrEqual(3))
    expect([...new Set(links.map((link) => link.raw))]).toEqual([
      '[[Plan]]',
      '[[Plan|Plan]]',
      '[[A\\|B]]',
    ])
  } finally {
    await done()
  }
})

test('a resized path image carries the text InkKit writes for it', async () => {
  const { editor, menus, done } = await mount('See ![a](a\\_b.png) here\n')
  try {
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const view = ctx.get(editorViewCtx)
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image')
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            alt: 'a|240',
          }),
        )
    })
    document
      .querySelector('.inkkit-file')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(menus).toHaveLength(1)
    expect(menus[0]!.raw).toMatch(/^!\[a\|240\]\(.+\)$/)
    expect(editor.snapshot().text).toContain(menus[0]!.raw)
  } finally {
    await done()
  }
})

test('a path image keeps the line endings, Unicode and byte order mark of its source', async () => {
  const written = '![café 日本|90](a\\_b.png "one\r\ntwo \u{1F600}")'
  const { files, done } = await mount(
    `\uFEFFFirst\r\n\r\nSee ${written} now\r\n`,
  )
  try {
    await vi.waitFor(() => expect(files).toHaveLength(1))
    expect(files[0]!.raw).toBe(written)
    expect(files[0]!.target).toBe('a_b.png')
  } finally {
    await done()
  }
})

test('a file reference gets the table spelling when an embed moves into a table, without a wiki adapter', async () => {
  const source = '| TARGET | b |\r\n| --- | --- |\r\n| c | d |\r\n'
  const { editor, files, done } = await mount(source, { files: true })
  try {
    editor.find('TARGET')
    await editor.paste(
      { text: 'x', markdown: '![[x.png|40]] ![a|50](b.png)' },
      1,
    )
    expect(editor.snapshot().text).toBe(
      source.replace('TARGET', '![[x.png\\|40]] ![a\\|50](b.png)'),
    )
    await vi.waitFor(() =>
      expect(raws(files.slice(-2))).toEqual([
        '![[x.png\\|40]]',
        '![a\\|50](b.png)',
      ]),
    )
  } finally {
    await done()
  }
})

test('a stale paste changes no reference and runs no callback', async () => {
  const { editor, files, links, done } = await mount(
    '![a](a.png) [[Plan]]\n\nTARGET\n',
  )
  try {
    await vi.waitFor(() => expect(files).toHaveLength(1))
    const seen = [files.length, links.length]
    editor.find('TARGET')
    await expect(
      editor.paste({ text: 'x', markdown: '![b](b.png) [[Other]]' }, 2),
    ).rejects.toMatchObject({ code: 'stale-document' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect([files.length, links.length]).toEqual(seen)
    expect(editor.snapshot().text).toBe('![a](a.png) [[Plan]]\n\nTARGET\n')
  } finally {
    await done()
  }
})

test('an image node with no writer reports an internal error, not an empty raw', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'image*' },
      image: {
        attrs: { src: { default: 'a.png' }, alt: { default: '' } },
      },
      text: {},
    },
  })
  const node = schema.nodes.image!.create()
  expect(() => fileReference(node)).toThrowError(
    expect.objectContaining({ code: 'internal' }),
  )
  expect(() => fileReference(node)).toThrowError(InkKitError)
})
