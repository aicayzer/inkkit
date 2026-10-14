import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, type ClipboardInput } from '../src/index'

/**
 * Loads `source`, puts the caret at `‸` (or selects between two `‸`), pastes
 * `input`, and returns the saved Markdown before and after typing `|`.
 */
async function pasteAt(
  source: string,
  input: ClipboardInput,
): Promise<{ text: string; typed: string }> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  const view = () => ctx.get(editorViewCtx) as EditorView
  try {
    const [head, middle, tail] = source.split('‸')
    const marked = tail == null ? head! + middle! : head! + middle! + tail
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: marked,
    })
    const positions: number[] = []
    const targets = [head!.length, head!.length + middle!.length]
    view().state.doc.descendants((node, pos) => {
      if (!node.isText) return
      // Text offsets in these fixtures map one to one onto document text.
      const start = marked.indexOf(node.text!)
      for (const target of targets)
        if (target >= start && target <= start + node.text!.length)
          positions.push(pos + target - start)
    })
    const from = positions[0]!
    const to = tail == null ? from : positions[positions.length - 1]!
    view().dispatch(
      view().state.tr.setSelection(
        TextSelection.create(view().state.doc, from, to),
      ),
    )
    await editor.paste(input)
    const text = editor.snapshot().text
    editor.insertText('|', 1)
    return { text, typed: editor.snapshot().text }
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('plain text pasted inside a sentence joins the paragraph at the caret', async () => {
  const pasted = await pasteAt('Before ‸after.\n', { text: 'word ' })
  expect(pasted.text).toBe('Before word after.\n')
  expect(pasted.typed).toBe('Before word |after.\n')
})

test('Markdown pasted inside a sentence joins the paragraph with its formatting', async () => {
  expect(
    (
      await pasteAt('Before ‸after.\n', {
        text: 'bold word ',
        markdown: '**bold** word ',
      })
    ).text,
  ).toBe('Before **bold** word after.\n')
})

test('Markdown that comes with its HTML joins the paragraph too', async () => {
  expect(
    (
      await pasteAt('Before ‸after.\n', {
        text: 'bold',
        markdown: '*bold*',
        html: '<em>bold</em>',
      })
    ).text,
  ).toBe('Before *bold*after.\n')
})

test('a pasted line joins headings, list items and quotes at the caret', async () => {
  expect((await pasteAt('# Head‸ing\n', { text: 'ed' })).text).toBe(
    '# Headeding\n',
  )
  expect((await pasteAt('- one‸\n- two\n', { text: ' and a half' })).text).toBe(
    '- one and a half\n- two\n',
  )
  expect((await pasteAt('> Quo‸ted\n', { text: 'te, quo' })).text).toBe(
    '> Quote, quoted\n',
  )
})

test('a pasted line replaces the selected text inside a paragraph', async () => {
  expect(
    (
      await pasteAt('Keep ‸this‸ text.\n', {
        text: 'that',
        markdown: '**that**',
      })
    ).text,
  ).toBe('Keep **that** text.\n')
})

test('pasted Unicode joins the paragraph without being rewritten', async () => {
  expect((await pasteAt('Le ‸soir.\n', { text: 'café ☕ 東京 ' })).text).toBe(
    'Le café ☕ 東京 soir.\n',
  )
})

test('pasted paragraphs join the text on either side of the caret', async () => {
  expect(
    (await pasteAt('Before ‸after.\n', { text: 'one\n\ntwo ' })).text,
  ).toBe('Before one\n\ntwo after.\n')
  expect(
    (await pasteAt('Before ‸after.\n', { text: 'one\r\n\r\ntwo ' })).text,
  ).toBe('Before one\n\ntwo after.\n')
})

test('pasted blocks other than paragraphs still split the paragraph', async () => {
  expect(
    (await pasteAt('Before ‸after.\n', { text: '- one\n- two' })).text,
  ).toBe('Before&#x20;\n\n- one\n- two\n\nafter.\n')
  expect(
    (await pasteAt('Before ‸after.\n', { text: '# Title\n\nbody ' })).text,
  ).toBe('Before&#x20;\n\n# Title\n\nbody after.\n')
  expect(
    (await pasteAt('Before ‸after.\n', { text: 'lead\n\n```\ncode\n```' }))
      .text,
  ).toBe('Before lead\n\n```\ncode\n```\n\nafter.\n')
})

test('a pasted line joins the text of a table cell', async () => {
  expect(
    (await pasteAt('| A | B |\n| - | - |\n| x‸y | z |\n', { text: 'word' }))
      .text,
  ).toBe('| A | B |\n| - | - |\n| xwordy | z |\n')
})
