import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, type ClipboardInput } from '../src/index'

/**
 * Loads `source`, puts the caret at `‸` (or selects between two `‸`), pastes
 * `input`, and returns the saved Markdown before and after typing `X`.
 */
async function pasteAt(
  source: string,
  input: ClipboardInput | string,
): Promise<{ text: string; typed: string }> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
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
    // An empty note has no text to find; its caret is already in place.
    if (positions.length) {
      const from = positions[0]!
      const to = tail == null ? from : positions[positions.length - 1]!
      view().dispatch(
        view().state.tr.setSelection(
          TextSelection.create(view().state.doc, from, to),
        ),
      )
    }
    if (typeof input === 'string') editor.pasteAsPlainText(input)
    else await editor.paste(input)
    const text = editor.snapshot().text
    editor.insertText('X', 1)
    return { text, typed: editor.snapshot().text }
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('plain text pasted inside a sentence joins the paragraph at the caret', async () => {
  expect(await pasteAt('Before ‸after.\n', { text: 'word ' })).toEqual({
    text: 'Before word after.\n',
    typed: 'Before word Xafter.\n',
  })
})

test('spaces pasted at the start or end of a block are dropped, not encoded', async () => {
  expect(await pasteAt('Before‸\n', { text: ' word ' })).toEqual({
    text: 'Before word\n',
    typed: 'Before wordX\n',
  })
  expect(await pasteAt('‸after\n', { text: ' word ' })).toEqual({
    text: 'word after\n',
    typed: 'word Xafter\n',
  })
})

test('spaces pasted beside a line break are dropped, not encoded', async () => {
  expect(await pasteAt('a\\\n‸bc\n', { text: ' word' })).toEqual({
    text: 'a\\\nwordbc\n',
    typed: 'a\\\nwordXbc\n',
  })
  expect(await pasteAt('ab‸  \nc\n', { text: 'word ' })).toEqual({
    text: 'abword  \nc\n',
    typed: 'abwordX  \nc\n',
  })
  expect(await pasteAt('a\n‸bc\n', { text: ' word ' })).toEqual({
    text: 'a\nword bc\n',
    typed: 'a\nword Xbc\n',
  })
})

test('spaces on pasted lines without text are not kept', async () => {
  expect(await pasteAt('Before‸after\n', { text: '  \n\nword\n\n  ' })).toEqual(
    { text: 'Beforewordafter\n', typed: 'BeforewordXafter\n' },
  )
  expect(
    await pasteAt('Before ‸ after\n', { text: '  \r\nword\r\n  ' }),
  ).toEqual({ text: 'Before word after\n', typed: 'Before wordX after\n' })
})

test('Markdown pasted inside a sentence joins the paragraph with its formatting', async () => {
  expect(
    await pasteAt('Before ‸after.\n', {
      text: 'bold word ',
      markdown: '**bold** word ',
    }),
  ).toEqual({
    text: 'Before **bold** word after.\n',
    typed: 'Before **bold** word Xafter.\n',
  })
})

test('Markdown that comes with its HTML joins the paragraph too', async () => {
  expect(
    await pasteAt('Before ‸after.\n', {
      text: 'bold',
      markdown: '*bold*',
      html: '<em>bold</em>',
    }),
  ).toEqual({
    text: 'Before *bold*after.\n',
    typed: 'Before *boldX*after.\n',
  })
})

test('a pasted line joins headings, list items and quotes at the caret', async () => {
  expect(await pasteAt('# Head‸ing\n', { text: 'ed' })).toEqual({
    text: '# Headeding\n',
    typed: '# HeadedXing\n',
  })
  expect(await pasteAt('- one‸\n- two\n', { text: ' and a half' })).toEqual({
    text: '- one and a half\n- two\n',
    typed: '- one and a halfX\n- two\n',
  })
  expect(await pasteAt('> Quo‸ted\n', { text: 'te, quo' })).toEqual({
    text: '> Quote, quoted\n',
    typed: '> Quote, quoXted\n',
  })
})

test('typing after a paste over a selection keeps the pasted text', async () => {
  expect(await pasteAt('Keep ‸this‸ text.\n', { text: 'that' })).toEqual({
    text: 'Keep that text.\n',
    typed: 'Keep thatX text.\n',
  })
  expect(
    await pasteAt('Keep ‸this‸ text.\n', {
      text: 'that',
      markdown: '**that**',
    }),
  ).toEqual({
    text: 'Keep **that** text.\n',
    typed: 'Keep **thatX** text.\n',
  })
  expect(
    await pasteAt('Keep ‸this‸ text.\n', {
      text: 'that',
      html: '<em>that</em>',
    }),
  ).toEqual({
    text: 'Keep *that* text.\n',
    typed: 'Keep *thatX* text.\n',
  })
  expect(await pasteAt('Keep ‸this‸ text.\n', 'that')).toEqual({
    text: 'Keep that text.\n',
    typed: 'Keep thatX text.\n',
  })
  expect(
    await pasteAt('Keep ‸this‸ text.\n', { text: 'one\n\n- two' }),
  ).toEqual({
    text: 'Keep one\n\n- two\n\n&#x20;text.\n',
    typed: 'Keep one\n\n- two\n\nX text.\n',
  })
  expect(
    await pasteAt('```\nkeep ‸this‸ code\n```\n', { text: 'that' }),
  ).toEqual({
    text: '```\nkeep that code\n```\n',
    typed: '```\nkeep thatX code\n```\n',
  })
})

test('a link pasted over a selection leaves the caret after the link', async () => {
  expect(
    await pasteAt('Keep ‸this‸ text.\n', { text: 'https://example.com' }),
  ).toEqual({
    text: 'Keep [this](https://example.com) text.\n',
    typed: 'Keep [this](https://example.com)X text.\n',
  })
})

test('typing after pasted blocks never goes into a comment or a folded callout', async () => {
  for (const [text, typed] of [
    ['x\n\n<!-- note -->', 'Beforex\n\n<!-- note -->\n\nXnext\n'],
    ['<!-- note -->', 'Before\n\n<!-- note -->\n\nXnext\n'],
    ['x\n\n---\n\n<!-- note -->', 'Beforex\n\n---\n\n<!-- note -->\n\nXnext\n'],
    ['x\n\n> [!NOTE]-\n> hi', 'Beforex\n\n> [!NOTE]-\n> hi\n\nXnext\n'],
  ] as const) {
    const pasted = await pasteAt('Before‸\n\nnext\n', { text })
    expect(pasted.typed, text).toBe(typed)
    expect(pasted.text, text).toBe(typed.replace('X', ''))
  }
  // With no text after the paste, typing goes before the comment.
  expect(await pasteAt('Before‸\n', { text: 'x\n\n<!-- note -->' })).toEqual({
    text: 'Beforex\n\n<!-- note -->\n',
    typed: 'BeforexX\n\n<!-- note -->\n',
  })
  // Blocks pasted into an empty note take the place of its empty paragraph.
  expect(await pasteAt('‸', { text: 'x\n\n<!-- note -->' })).toEqual({
    text: 'x\n\n<!-- note -->\n',
    typed: 'xX\n\n<!-- note -->\n',
  })
})

test('typing after a pasted rule continues after it', async () => {
  expect(await pasteAt('Before‸\n\nnext\n', { text: 'x\n\n---' })).toEqual({
    text: 'Beforex\n\n---\n\nnext\n',
    typed: 'Beforex\n\n---\n\nXnext\n',
  })
})

test('pasted Unicode joins the paragraph without being rewritten', async () => {
  expect(await pasteAt('Le ‸soir.\n', { text: 'café ☕ 東京 ' })).toEqual({
    text: 'Le café ☕ 東京 soir.\n',
    typed: 'Le café ☕ 東京 Xsoir.\n',
  })
})

test('pasted paragraphs join the text on either side of the caret', async () => {
  expect(await pasteAt('Before ‸after.\n', { text: 'one\n\ntwo ' })).toEqual({
    text: 'Before one\n\ntwo after.\n',
    typed: 'Before one\n\ntwo Xafter.\n',
  })
  expect(
    await pasteAt('Before ‸after.\n', { text: 'one\r\n\r\ntwo ' }),
  ).toEqual({
    text: 'Before one\n\ntwo after.\n',
    typed: 'Before one\n\ntwo Xafter.\n',
  })
})

test('pasted blocks other than paragraphs still split the paragraph', async () => {
  expect(await pasteAt('Before ‸after.\n', { text: '- one\n- two' })).toEqual({
    text: 'Before&#x20;\n\n- one\n- two\n\nafter.\n',
    typed: 'Before&#x20;\n\n- one\n- two\n\nXafter.\n',
  })
  expect(
    await pasteAt('Before ‸after.\n', { text: '# Title\n\nbody ' }),
  ).toEqual({
    text: 'Before&#x20;\n\n# Title\n\nbody after.\n',
    typed: 'Before&#x20;\n\n# Title\n\nbody Xafter.\n',
  })
  expect(
    await pasteAt('Before ‸after.\n', { text: 'lead\n\n```\ncode\n```' }),
  ).toEqual({
    text: 'Before lead\n\n```\ncode\n```\n\nafter.\n',
    typed: 'Before lead\n\n```\ncode\n```\n\nXafter.\n',
  })
})

test('a pasted line joins the text of a table cell', async () => {
  expect(
    await pasteAt('| A | B |\n| - | - |\n| x‸y | z |\n', { text: 'word' }),
  ).toEqual({
    text: '| A | B |\n| - | - |\n| xwordy | z |\n',
    typed: '| A | B |\n| - | - |\n| xwordXy | z |\n',
  })
})
