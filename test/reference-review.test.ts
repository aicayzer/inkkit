import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor, type ImageAdapter } from '../src/index'
import { referenceDefinitions, footnoteDefinitions } from '../src/references'

async function run(
  callback: (editor: InkKitEditor, ctx: Ctx) => Promise<void>,
  images?: ImageAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await callback(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const input = {
  documentId: 'reference-review',
  generation: 1,
  format: 'md' as const,
}

test('explicit Markdown takes precedence over a URL in plain text with a selection', () =>
  run(async (editor) => {
    editor.loadDocument({ ...input, text: 'Replace this\n' })
    editor.find('this')
    await editor.paste({
      text: 'https://example.com',
      markdown: '[Copied][Ref]\n\n[Ref]: /source\n',
    })
    const saved = editor.snapshot().text
    expect(saved).toContain('[Copied][Ref]')
    expect(saved).toContain('[Ref]: /source')
    expect(saved).not.toContain('https://example.com')
    expect(saved).not.toContain('this')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(editor.snapshot().text).toBe(saved)
  }))

test('selection ending inside a required footnote retains its complete definition', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: 'See[^note]\n\n[^note]: First paragraph.\n\n    Second paragraph.\n',
    })
    const view = ctx.get(editorViewCtx)
    const definition = footnoteDefinitions(view.state.doc).get('note')!
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(
          view.state.doc,
          1,
          definition.pos + 2 + 'First'.length,
        ),
      ),
    )
    const output = await editor.clipboardSnapshot(false)
    expect(output.markdown).toContain('First paragraph.')
    expect(output.markdown).toContain('Second paragraph.')
  }))

for (const source of [
  '[Text][ref]\nKeep END\n\n[ref]: /target\n',
  '[Text][ref]\r\nKeep END\r\n\r\n[ref]: /target\r\n',
  '[Text][ref]\r\nKeep END\n\n[ref]: /target\n',
]) {
  test(`an inline edit retains multiline source around a reference: ${JSON.stringify(source)}`, () =>
    run(async (editor) => {
      editor.loadDocument({ ...input, text: source })
      editor.find('END')
      editor.insertText('END!', 1)
      expect(editor.snapshot().text).toBe(source.replace('END', 'END!'))
    }))
}
function end(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
}

for (const source of ['[Label]', '[Label][]', '[Text][My\nLabel]']) {
  test(`unresolved implicit pasted reference remains unresolved: ${source}`, () =>
    run(async (editor, ctx) => {
      editor.loadDocument({
        ...input,
        text: '[Label]: /existing\n\n[My Label]: /existing-multiline\n\nEnd\n',
      })
      end(ctx)
      await editor.paste({ text: source })
      const saved = editor.snapshot().text
      editor.loadDocument({ ...input, generation: 2, text: saved })
      let links = 0
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        links += node.marks.filter((mark) => mark.type.name === 'link').length
      })
      expect(links).toBe(0)
    }))
}

test('standalone definitions with colon labels reserve the whole label during paste', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: '[a:b]: /existing\n\nEnd\n' })
    end(ctx)
    await editor.paste({ text: '[Incoming][a:b]\n\n[a:b]: /incoming\n' })
    const saved = editor.snapshot().text
    const definitions = referenceDefinitions(ctx.get(editorViewCtx).state.doc)
    expect(definitions.size).toBe(2)
    expect(definitions.get('a:b')!.node.attrs.url).toBe('/existing')
    const links: string[] = []
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      for (const mark of node.marks)
        if (mark.type.name === 'link') links.push(mark.attrs.href)
    })
    expect(links).toEqual(['/incoming'])
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(referenceDefinitions(ctx.get(editorViewCtx).state.doc).size).toBe(2)
  }))

test('label collision handling does not rewrite fenced or inline code', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: '[ref]: /existing\n\n[^note]: Existing\n\nEnd\n',
    })
    end(ctx)
    await editor.paste({
      text: '```text\n[Link][ref] [^note]\n```\n\n`[Link][ref] [^note]`\n',
    })
    const doc = ctx.get(editorViewCtx).state.doc
    const code: string[] = []
    doc.descendants((node) => {
      if (
        node.type.spec.code ||
        node.marks.some((mark) => mark.type.name === 'inlineCode')
      )
        code.push(node.textContent)
    })
    expect(code).toEqual(['[Link][ref] [^note]', '[Link][ref] [^note]'])
    expect(editor.snapshot().text).not.toContain('ref-2')
    expect(editor.snapshot().text).not.toContain('note-2')
  }))

test('reference-rich copying retains image positions when one export is unavailable', () =>
  run(
    async (editor, ctx) => {
      editor.loadDocument({
        ...input,
        text: '[Link][Ref]\n\n![Missing](images/missing.png) between ![Present](images/present.png)\n\n[Ref]: /target\n',
      })
      const copied = await editor.clipboardSnapshot()
      editor.loadDocument({ ...input, generation: 2, text: '' })
      await editor.paste({ text: copied.text, html: copied.html })
      const images: { alt: string; src: string }[] = []
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        if (node.type.name === 'image')
          images.push({ alt: node.attrs.alt, src: node.attrs.src })
      })
      expect(images).toEqual([{ alt: 'Present', src: 'images/imported.png' }])
      expect(editor.snapshot().text).toContain(
        '[Missing: image unavailable] between ![Present]',
      )
      const saved = editor.snapshot().text
      editor.loadDocument({ ...input, generation: 3, text: saved })
      const reopenedImages: string[] = []
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        if (node.type.name === 'image') reopenedImages.push(node.attrs.alt)
      })
      expect(reopenedImages).toEqual(['Present'])
    },
    {
      presentation: () => undefined,
      importImage: async () => ({ reference: 'images/imported.png' }),
      exportImage: async (reference) => {
        if (reference.endsWith('missing.png')) throw new Error('Unavailable')
        return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }
      },
    },
  ))
