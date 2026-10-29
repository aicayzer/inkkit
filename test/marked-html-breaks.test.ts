import { ctxOf, withFacade } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { FormatCommand, InkKitEditor } from '../src/core'

// A `<br>` inside formatting or a link that is a paragraph's only child is a
// line break, as it is beside other text; only a paragraph holding nothing
// but the break is a spacer.
const marks = [
  ['bold', '**', '**'],
  ['italic', '*', '*'],
  ['strikethrough', '~~', '~~'],
  ['highlight', '==', '=='],
  ['underline', '<u>', '</u>'],
  ['superscript', '<sup>', '</sup>'],
  ['subscript', '<sub>', '</sub>'],
  ['link', '[', '](https://example.com)'],
] as const

function literals(doc: ProseNode): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === 'literal_markdown') count++
  })
  return count
}

function htmlBreaks(doc: ProseNode): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === 'hardbreak' && node.attrs.isHTML) count++
  })
  return count
}

function session(editor: InkKitEditor) {
  const view = ctxOf(editor).get(editorViewCtx)
  let generation = editor.snapshot().generation
  const load = (text: string) =>
    editor.loadDocument({
      documentId: 'marked-breaks',
      generation: ++generation,
      format: 'md',
      text,
    })
  const reopens = () => {
    const saved = editor.snapshot().text
    const shown = view.state.doc.toJSON()
    load(saved)
    expect(editor.snapshot().text).toBe(saved)
    expect(view.state.doc.toJSON()).toEqual(shown)
  }
  return { view, load, reopens }
}

for (const [name, open, close] of marks) {
  const wrapped = `${open}a<br>b${close}`

  test(`a break in ${name} that fills its paragraph loads formatted and saves unchanged`, () =>
    withFacade('', (editor) => {
      const { view, load, reopens } = session(editor)
      for (const source of [
        `${wrapped}\n`,
        `${wrapped}\r\n\r\nNext\r\n`,
        `- ${wrapped}\n`,
        `> ${wrapped}\n`,
      ]) {
        load(source)
        expect(literals(view.state.doc), source).toBe(0)
        expect(htmlBreaks(view.state.doc), source).toBe(1)
        expect(editor.snapshot().text).toBe(source)
        reopens()
      }
    }))

  test(`deleting the text before a break in ${name} leaves the rest as written`, () =>
    withFacade('', (editor) => {
      const { view, load, reopens } = session(editor)
      const source = `X ${wrapped}\n\nOther &amp; text\n`
      load(source)
      view.dispatch(view.state.tr.delete(1, 3))
      expect(editor.snapshot().text).toBe(`${wrapped}\n\nOther &amp; text\n`)
      editor.undo()
      expect(editor.snapshot().text).toBe(source)
      editor.redo()
      expect(editor.snapshot().text).toBe(`${wrapped}\n\nOther &amp; text\n`)
      reopens()
    }))

  test(`${name} applied over a break saves and reopens`, () =>
    withFacade('', (editor) => {
      const { view, load, reopens } = session(editor)
      const source = 'a<br>b\n\nOther &amp; text\n'
      load(source)
      const end = view.state.doc.firstChild!.nodeSize - 1
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 1, end),
        ),
      )
      expect(
        editor.format(
          name as FormatCommand,
          name === 'link' ? { destination: 'https://example.com' } : undefined,
        ),
      ).toBe(true)
      // The newly formatted break takes the writer's spelling.
      const applied = `${open}a<br />b${close}\n\nOther &amp; text\n`
      expect(editor.snapshot().text).toBe(applied)
      editor.undo()
      expect(editor.snapshot().text).toBe(source)
      editor.redo()
      expect(editor.snapshot().text).toBe(applied)
      reopens()
    }))

  test(`typing beside a break in ${name} keeps its spelling`, () =>
    withFacade('', (editor) => {
      const { view, load, reopens } = session(editor)
      load(`${wrapped}\n`)
      view.dispatch(view.state.tr.insertText('Z', 2))
      expect(editor.snapshot().text).toBe(`${open}aZ<br>b${close}\n`)
      reopens()
    }))
}

test('a paragraph holding only a break is still a spacer', () =>
  withFacade('', (editor) => {
    const { view, load } = session(editor)
    load('One\n\n<br>\n\nTwo\n')
    expect(view.state.doc.child(1).content.size).toBe(0)
    expect(editor.snapshot().text).toBe('One\n\n<br>\n\nTwo\n')
  }))
