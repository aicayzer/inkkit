import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  NodeSelection,
  TextSelection,
  type Selection,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  InkKitEditor,
  type EditorOptions,
  type FileAdapter,
  type ImageAdapter,
} from '../src/index'

const images: ImageAdapter = {
  presentation: (reference) => ({ url: `blob:image/${reference}` }),
  importImage: async () => ({ reference: 'imported.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}
const files: FileAdapter = {
  resolve: async () => ({ kind: 'image', url: 'blob:file-image' }),
}

interface Harness {
  editor: InkKitEditor
  view: () => EditorView
  root: HTMLElement
  text: () => string
}

async function run(
  text: string,
  body: (harness: Harness) => void | Promise<void>,
  options: EditorOptions = { images },
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
    options,
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text,
    })
    await body({
      editor,
      root,
      view: () => ctx.get(editorViewCtx),
      text: () => editor.snapshot().text,
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function blocks(view: EditorView): string[] {
  const names: string[] = []
  view.state.doc.forEach((node) => names.push(node.type.name))
  return names
}

/** Position of the nth standalone image block. */
function imageBlock(view: EditorView, index = 0): number {
  const found: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image_block') found.push(pos)
  })
  expect(found.length).toBeGreaterThan(index)
  return found[index]!
}

function select(view: EditorView, selection: Selection): void {
  view.dispatch(view.state.tr.setSelection(selection))
}

const gapAfter = (view: EditorView, index = 0) =>
  new GapCursor(view.state.doc.resolve(imageBlock(view, index) + 1))
const gapBefore = (view: EditorView, index = 0) =>
  new GapCursor(view.state.doc.resolve(imageBlock(view, index)))
const imageSelected = (view: EditorView, index = 0) =>
  NodeSelection.create(view.state.doc, imageBlock(view, index))

function key(editor: InkKitEditor, name: string): boolean {
  return editor.keyDown(name, name, false, false, false, false, 1)
}

const roundTrips = {
  'standalone image': 'Before\n\n![Photo](photo.png)\n\nAfter\n',
  'standalone with width and title':
    '![A photo|320](../Attachments/Photo%201.png "Sunset")\n',
  'mixed paragraph': 'Text beside ![Photo|400](photo.png) the image.\n',
  'table cell':
    '| Picture | Size |\n| --- | --- |\n| ![Small\\|200](s.png) | small |\n',
  'several in a row': '![One](1.png)\n\n![Two](2.png)\n\n![Three](3.png)\n',
  'at start and end': '![First](1.png)\n\nMiddle\n\n![Last](2.png)',
  'trailing spaces': 'Intro\n\n![Photo](photo.png)   \n\nOutro\n',
  'hard break after': '![Photo](photo.png)  \nCaption line\n',
  'two in one paragraph': '![One](1.png)![Two](2.png)\n',
  'in a quote and list':
    '> ![Quoted](q.png)\n\n- ![Listed](l.png)\n\n  ![Second](s.png)\n',
  'CRLF endings': 'Before\r\n\r\n![Photo](photo.png)\r\n\r\nAfter\r\n',
}

test.each(Object.entries(roundTrips))(
  'loading and saving keeps exact bytes: %s',
  (_name, text) =>
    run(text, ({ text: current }) => {
      expect(current()).toBe(text)
    }),
)

// From the MAPP corpus: wiki embeds, a cell embed and text beside embeds.
const embeds = `# Embedded files

![[Recording 1.m4a]]

![[Attachments/Walkthrough.mov|640x360]]

![[Plan.pdf#page=2]]

![A photo|320](../Attachments/Photo%201.png "Sunset")

![](<Attachments/Budget sheet.xlsx>)

![[Notes about the plan]] and ![](Other%20note.md) are notes, so they stay text, as does ![[Minutes 2026.10.06]].

| Picture | Size |
| --- | --- |
| ![[Photo.png\\|200]] | small |

EDIT HERE beside ![[Recording 1.m4a]] and ![[Photo.png|400]], with [[A link]] and ![[A note]].
`

test('wiki embeds keep their bytes, and an edit elsewhere leaves image paragraphs alone', () =>
  run(
    embeds,
    ({ text, view }) => {
      expect(text()).toBe(embeds)
      expect(
        blocks(view()).filter((name) => name === 'image_block'),
      ).toHaveLength(5)
      const heading = view().state.doc.firstChild!
      view().dispatch(view().state.tr.insertText('!', heading.nodeSize - 1))
      expect(text()).toBe(
        embeds.replace('# Embedded files', '# Embedded files!'),
      )
    },
    { files, wikiLinks: { open() {} } },
  ))

test('untidy image paragraphs survive an edit to another block', () =>
  run(
    'Intro\n\n![Photo](photo.png)   \n\n![One](1.png)![Two](2.png)\n',
    ({ editor, text }) => {
      const { snapshotId } = editor.textSnapshot()
      editor.selectTextRange({ snapshotId, from: 5, to: 5 })
      editor.insertText(' more', 1)
      expect(text()).toBe(
        'Intro more\n\n![Photo](photo.png)   \n\n![One](1.png)![Two](2.png)\n',
      )
    },
  ))

test('a paragraph holding only an image is a block with no text position inside', () =>
  run(roundTrips['standalone image'], ({ view }) => {
    expect(blocks(view())).toEqual(['paragraph', 'image_block', 'paragraph'])
    const block = view().state.doc.child(1)
    expect(block.isAtom && block.isLeaf).toBe(true)
    expect(block.attrs.src).toBe('photo.png')
  }))

test('mixed paragraphs, cells, list leads and two images stay inline images', () =>
  run(
    'Text ![a](a.png)\n\n| A |\n| - |\n| ![b](b.png) |\n\n- ![c](c.png)\n\n![d](d.png)![e](e.png)\n',
    ({ view }) => {
      const inline: string[] = []
      view().state.doc.descendants((node: ProseNode) => {
        if (node.type.name === 'image') inline.push(String(node.attrs.src))
      })
      expect(inline).toEqual(['a.png', 'b.png', 'c.png', 'd.png', 'e.png'])
      expect(blocks(view())).not.toContain('image_block')
    },
  ))

test('typing after a standalone image writes a new paragraph below it, with undo and redo', () =>
  run(roundTrips['standalone image'], ({ editor, view, text }) => {
    select(view(), gapAfter(view()))
    editor.insertText('Typed', 1)
    expect(text()).toBe('Before\n\n![Photo](photo.png)\n\nTyped\n\nAfter\n')
    expect(view().state.selection).toBeInstanceOf(TextSelection)
    expect(view().state.selection.$head.parent.textContent).toBe('Typed')
    editor.undo()
    expect(text()).toBe(roundTrips['standalone image'])
    editor.redo()
    expect(text()).toBe('Before\n\n![Photo](photo.png)\n\nTyped\n\nAfter\n')
  }))

test('typing before an image at the start of a document writes a paragraph above it', () =>
  run('![Photo](photo.png)\n', ({ editor, view, text }) => {
    select(view(), gapBefore(view()))
    editor.insertText('Title', 1)
    expect(text()).toBe('Title\n\n![Photo](photo.png)\n')
  }))

test('typing while an image is selected keeps the image and writes below it', () =>
  run(roundTrips['standalone image'], ({ editor, view, text }) => {
    select(view(), imageSelected(view()))
    editor.insertText('x', 1)
    expect(text()).toBe('Before\n\n![Photo](photo.png)\n\nx\n\nAfter\n')
  }))

test('a document ending in an image opens with the caret after it', () =>
  run('Intro\n\n![Photo](photo.png)\n', ({ editor, view, text }) => {
    expect(view().state.selection).toBeInstanceOf(GapCursor)
    editor.insertText('Next', 1)
    expect(text()).toBe('Intro\n\n![Photo](photo.png)\n\nNext\n')
  }))

test('Enter beside or on an image opens an empty paragraph there', () =>
  run(roundTrips['standalone image'], ({ editor, view }) => {
    select(view(), gapAfter(view()))
    expect(key(editor, 'Enter')).toBe(true)
    expect(blocks(view())).toEqual([
      'paragraph',
      'image_block',
      'paragraph',
      'paragraph',
    ])
    expect(view().state.selection.$head.parent.content.size).toBe(0)
    editor.undo()
    select(view(), gapBefore(view()))
    expect(key(editor, 'Enter')).toBe(true)
    expect(blocks(view())).toEqual([
      'paragraph',
      'paragraph',
      'image_block',
      'paragraph',
    ])
    editor.undo()
    select(view(), imageSelected(view()))
    expect(key(editor, 'Enter')).toBe(true)
    expect(view().state.doc.child(1).type.name).toBe('image_block')
    expect(view().state.doc.child(2).content.size).toBe(0)
  }))

test('Backspace at the start of the next paragraph selects the image, then deletes it', () =>
  run(roundTrips['standalone image'], ({ editor, view, text }) => {
    const after = imageBlock(view()) + 2
    select(view(), TextSelection.create(view().state.doc, after))
    expect(key(editor, 'Backspace')).toBe(true)
    expect(text()).toBe(roundTrips['standalone image'])
    expect(view().state.selection).toBeInstanceOf(NodeSelection)
    expect(key(editor, 'Backspace')).toBe(true)
    expect(text()).toBe('Before\n\nAfter\n')
    editor.undo()
    expect(text()).toBe(roundTrips['standalone image'])
  }))

test('Backspace in an empty paragraph after an image removes the paragraph only', () =>
  run('![Photo](photo.png)\n\n<br />\n\nAfter\n', ({ editor, view, text }) => {
    const empty = imageBlock(view()) + 2
    select(view(), TextSelection.create(view().state.doc, empty))
    expect(key(editor, 'Backspace')).toBe(true)
    expect(text()).toBe('![Photo](photo.png)\n\nAfter\n')
    expect(view().state.selection).toBeInstanceOf(GapCursor)
  }))

test('Delete at the end of the previous paragraph selects the image, then deletes it', () =>
  run(roundTrips['standalone image'], ({ editor, view, text }) => {
    select(
      view(),
      TextSelection.create(view().state.doc, imageBlock(view()) - 1),
    )
    expect(key(editor, 'Delete')).toBe(true)
    expect(text()).toBe(roundTrips['standalone image'])
    expect(view().state.selection).toBeInstanceOf(NodeSelection)
    expect(key(editor, 'Delete')).toBe(true)
    expect(text()).toBe('Before\n\nAfter\n')
  }))

test('Backspace and Delete at a gap select the image or move into the text', () =>
  run(roundTrips['standalone image'], ({ editor, view, text }) => {
    select(view(), gapAfter(view()))
    expect(key(editor, 'Backspace')).toBe(true)
    expect(view().state.selection).toBeInstanceOf(NodeSelection)
    select(view(), gapAfter(view()))
    expect(key(editor, 'Delete')).toBe(true)
    expect(view().state.selection.$head.parent.textContent).toBe('After')
    select(view(), gapBefore(view()))
    expect(key(editor, 'Backspace')).toBe(true)
    expect(view().state.selection.$head.parent.textContent).toBe('Before')
    select(view(), gapBefore(view()))
    expect(key(editor, 'Delete')).toBe(true)
    expect(view().state.selection).toBeInstanceOf(NodeSelection)
    expect(text()).toBe(roundTrips['standalone image'])
  }))

test('deleting a range that ends at an image never joins the image to the text', () =>
  run(
    'Before text\n\n![Photo](photo.png)\n\nAfter\n',
    ({ editor, view, text }) => {
      const start = imageBlock(view())
      select(view(), TextSelection.create(view().state.doc, 7, start - 1))
      expect(key(editor, 'Backspace')).toBe(true)
      expect(text()).toBe('Before\n\n![Photo](photo.png)\n\nAfter\n')
    },
  ))

test('inserting images leaves the caret after the last one, and typing lands below', () =>
  run('Start\n', ({ editor, view, text }) => {
    const end = view().state.doc.child(0).nodeSize - 1
    select(view(), TextSelection.create(view().state.doc, end))
    editor.insertImages([
      { path: 'one.png', alt: 'One' },
      { path: 'two.png', alt: 'Two' },
    ])
    expect(text()).toBe('Start\n\n![One](one.png)\n\n![Two](two.png)\n')
    expect(view().state.selection).toBeInstanceOf(GapCursor)
    editor.insertText('After', 1)
    expect(text()).toBe(
      'Start\n\n![One](one.png)\n\n![Two](two.png)\n\nAfter\n',
    )
    editor.undo()
    editor.undo()
    expect(text()).toBe('Start\n')
  }))

test('inserting an image inside a paragraph splits it, leaving the caret after the image', () =>
  run('AlphaBeta\n', ({ editor, view, text }) => {
    select(view(), TextSelection.create(view().state.doc, 6))
    editor.insertImages([{ path: 'mid.png', alt: 'Mid' }])
    expect(text()).toBe('Alpha\n\n![Mid](mid.png)\n\nBeta\n')
    expect(view().state.selection).toBeInstanceOf(GapCursor)
    editor.insertText('Typed', 1)
    expect(text()).toBe('Alpha\n\n![Mid](mid.png)\n\nTyped\n\nBeta\n')
  }))

test('pasting text beside a standalone image writes a separate paragraph', () =>
  run(roundTrips['standalone image'], async ({ editor, view, text }) => {
    select(view(), gapAfter(view()))
    await editor.paste({ text: 'Pasted' })
    expect(text()).toBe('Before\n\n![Photo](photo.png)\n\nPasted\n\nAfter\n')
    select(view(), gapBefore(view()))
    editor.pasteAsPlainText('Plain')
    expect(text()).toBe(
      'Before\n\nPlain\n\n![Photo](photo.png)\n\nPasted\n\nAfter\n',
    )
  }))

test('composition that starts on a selected image keeps it and composes below (synthetic events)', () =>
  run(roundTrips['standalone image'], async ({ view, text }) => {
    select(view(), imageSelected(view()))
    const before = view().state.doc
    view().dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(view().state.selection).toBeInstanceOf(GapCursor)
    expect(view().state.doc.eq(before)).toBe(true)
    view().dom.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: 'か',
      }),
    )
    expect(blocks(view())).toEqual([
      'paragraph',
      'image_block',
      'paragraph',
      'paragraph',
    ])
    expect(view().state.selection.$head.parent.content.size).toBe(0)
    view().dom.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    await vi.waitFor(() => expect(view().composing).toBe(false))
    expect(text()).toBe('Before\n\n![Photo](photo.png)\n\n<br />\n\nAfter\n')
  }))

test('removing the text beside an image turns its paragraph into a block, caret on the same side', () =>
  run(
    'Caption ![Photo](photo.png)\n\nTail ![Photo](photo.png) caption\n',
    ({ view, text }) => {
      select(view(), TextSelection.create(view().state.doc, 9))
      view().dispatch(view().state.tr.delete(1, 9))
      expect(blocks(view())).toEqual(['image_block', 'paragraph'])
      expect(view().state.selection).toBeInstanceOf(GapCursor)
      expect(view().state.selection.head).toBe(0)
      const tail = view().state.doc.child(0).nodeSize
      const image = tail + 6
      select(view(), TextSelection.create(view().state.doc, image + 1))
      view().dispatch(
        view()
          .state.tr.delete(image + 1, image + 9)
          .delete(tail + 1, image),
      )
      expect(blocks(view())).toEqual(['image_block', 'image_block'])
      expect(view().state.selection).toBeInstanceOf(GapCursor)
      expect(view().state.selection.head).toBe(tail + 1)
      expect(text()).toBe('![Photo](photo.png)\n\n![Photo](photo.png)\n')
    },
  ))

test('text typed beside an image in a mixed paragraph stays in that paragraph', () =>
  run(roundTrips['mixed paragraph'], ({ editor, view, text }) => {
    select(view(), TextSelection.create(view().state.doc, 1))
    editor.insertText('New ', 1)
    expect(text()).toBe('New Text beside ![Photo|400](photo.png) the image.\n')
  }))

test('an image in a table cell stays inline and keeps its source when the row is edited', () =>
  run(roundTrips['table cell'], ({ editor, view, text }) => {
    let image = 0,
      size = 0
    view().state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') image = pos
      if (node.type.name === 'table_cell' && node.textContent === 'small')
        size = pos + 2
    })
    expect(view().state.doc.resolve(image).parent.type.name).toBe('paragraph')
    select(view(), TextSelection.create(view().state.doc, size + 5))
    editor.insertText('er', 1)
    expect(text()).toBe(
      '| Picture | Size |\n| --- | --- |\n| ![Small\\|200](s.png) | smaller |\n',
    )
  }))

test('resizing re-emits only that image, in the width-in-alt form, keeping wiki embeds raw', async () => {
  const source =
    'Intro\n\n![Photo](photo.png "Title")   \n\n![[Diagram.png|400]]\n\nEnd\n'
  await run(
    source,
    async ({ root, text }) => {
      await vi.waitFor(() =>
        expect(root.querySelectorAll('.image img')).toHaveLength(2),
      )
      const resize = (index: number, to: number) => {
        const card = root.querySelectorAll<HTMLElement>('.image')[index]!
        const image = card.querySelector('img')!
        image.getBoundingClientRect = () => new DOMRect(0, 0, 100, 50)
        Object.defineProperty(
          root.querySelector('.ProseMirror')!,
          'clientWidth',
          {
            value: 800,
            configurable: true,
          },
        )
        const handle = card.querySelector('.image-handle')!
        handle.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }),
        )
        handle.dispatchEvent(new MouseEvent('pointermove', { clientX: to }))
        handle.dispatchEvent(new MouseEvent('pointerup', { clientX: to }))
      }
      resize(0, 180)
      expect(text()).toBe(
        'Intro\n\n![Photo|180](photo.png "Title")   \n\n![[Diagram.png|400]]\n\nEnd\n',
      )
      resize(1, 150)
      expect(text()).toBe(
        'Intro\n\n![Photo|180](photo.png "Title")   \n\n![[Diagram.png|150]]\n\nEnd\n',
      )
    },
    {
      images,
      files: {
        resolve: async () => ({ kind: 'image', url: 'blob:file-image' }),
      },
      wikiLinks: { open() {} },
    },
  )
})

test('copying a selected image block exports its paragraph Markdown and picture', () =>
  run(roundTrips['standalone image'], async ({ editor, view }) => {
    select(view(), imageSelected(view()))
    const copied = await editor.clipboardSnapshot(false)
    expect(copied.markdown.trim()).toBe('![Photo](photo.png)')
    expect(copied.text).toBe('Photo')
    expect(copied.html).toMatch(/<p><img[^>]*alt="Photo"/)
    expect(copied.images).toHaveLength(1)
  }))

test('readable text gives a standalone image its label as its own line', () =>
  run(roundTrips['standalone image'], ({ editor, view }) => {
    const { text, snapshotId } = editor.textSnapshot()
    expect(text).toBe('Before\nPhoto\nAfter')
    editor.selectTextRange({ snapshotId, from: 7, to: 12 })
    expect(view().state.selection).toBeInstanceOf(NodeSelection)
    expect((view().state.selection as NodeSelection).node.type.name).toBe(
      'image_block',
    )
  }))

const markedImages = {
  linked: '[![Badge](b.png)](https://example.com)',
  'reference-linked': '[![Badge](b.png)][site]',
  emphasised: '*![Badge](b.png)*',
  strong: '**![Badge](b.png)**',
  struck: '~~![Badge](b.png)~~',
  highlighted: '==![Badge](b.png)==',
}
const markedSource = (image: string) =>
  `Intro\n\n${image}\n\nEnd\n${image.endsWith('[site]') ? '\n[site]: https://example.com\n' : ''}`

test.each(Object.entries(markedImages))(
  'a %s sole image stays an inline image and keeps its bytes through edits elsewhere',
  (_name, image) =>
    run(markedSource(image), ({ editor, view, text }) => {
      const source = markedSource(image)
      expect(text()).toBe(source)
      expect(blocks(view())).not.toContain('image_block')
      view().dispatch(view().state.tr.insertText(' edited', 6))
      expect(text()).toBe(source.replace('Intro', 'Intro edited'))
      editor.replaceSource(source.replace('Intro', 'Intro again'), 1)
      expect(text()).toBe(source.replace('Intro', 'Intro again'))
      expect(blocks(view())).not.toContain('image_block')
    }),
)

test('resizing a linked sole image or deleting text beside it keeps the link', () =>
  run(
    'Caption [![Badge](b.png)](https://example.com)\n\n[![Logo](l.png)](https://example.org)\n',
    ({ root, view, text }) => {
      view().dispatch(view().state.tr.delete(1, 9))
      expect(text()).toBe(
        '[![Badge](b.png)](https://example.com)\n\n[![Logo](l.png)](https://example.org)\n',
      )
      const card = root.querySelectorAll<HTMLElement>('.image')[1]!
      card.querySelector('img')!.getBoundingClientRect = () =>
        new DOMRect(0, 0, 100, 50)
      Object.defineProperty(
        root.querySelector('.ProseMirror')!,
        'clientWidth',
        {
          value: 800,
          configurable: true,
        },
      )
      const handle = card.querySelector('.image-handle')!
      handle.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }),
      )
      handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 180 }))
      handle.dispatchEvent(new MouseEvent('pointerup', { clientX: 180 }))
      expect(text()).toBe(
        '[![Badge](b.png)](https://example.com)\n\n[![Logo|180](l.png)](https://example.org)\n',
      )
      expect(blocks(view())).not.toContain('image_block')
    },
  ))

test.each([
  ['link', markedImages.linked],
  ['emphasis', markedImages.emphasised],
])(
  'removing the %s mark from a sole image makes it a block, with undo and redo',
  (mark, image) =>
    run(markedSource(image), ({ editor, view, text }) => {
      const source = markedSource(image)
      const paragraph = view().state.doc.child(1)
      const from = view().state.doc.child(0).nodeSize + 1
      view().dispatch(
        view().state.tr.removeMark(
          from,
          from + paragraph.content.size,
          view().state.schema.marks[mark]!,
        ),
      )
      expect(text()).toBe('Intro\n\n![Badge](b.png)\n\nEnd\n')
      expect(blocks(view())).toEqual(['paragraph', 'image_block', 'paragraph'])
      editor.undo()
      expect(text()).toBe(source)
      expect(blocks(view())).not.toContain('image_block')
      editor.redo()
      expect(text()).toBe('Intro\n\n![Badge](b.png)\n\nEnd\n')
    }),
)

test('Delete in an empty first list line before an image selects the image instead of leaving a stray gap', () =>
  run('- x\n\n  ![a](a.png)\n', ({ editor, view, text }) => {
    view().dispatch(view().state.tr.delete(3, 4))
    const before = text()
    select(view(), TextSelection.create(view().state.doc, 3))
    expect(key(editor, 'Delete')).toBe(true)
    const selection = view().state.selection
    expect(selection).toBeInstanceOf(NodeSelection)
    expect((selection as NodeSelection).node.type.name).toBe('image_block')
    expect(text()).toBe(before)
    expect(key(editor, 'Delete')).toBe(true)
    expect(text()).toBe('- <br />\n')
    editor.undo()
    expect(text()).toBe(before)
  }))
