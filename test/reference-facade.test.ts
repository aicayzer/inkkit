import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  AllSelection,
  NodeSelection,
  TextSelection,
} from '@milkdown/kit/prose/state'
import { closeHistory, undo } from '@milkdown/kit/prose/history'
import { InkKitEditor, type ImageAdapter } from '../src/index'
import { footnoteDefinitions, referenceDefinitions } from '../src/references'

async function run(
  callback: (editor: InkKitEditor, ctx: Ctx) => void | Promise<void>,
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
  documentId: 'references',
  generation: 1,
  format: 'md' as const,
}

test('an adjacent inline edit keeps authored labels, delimiters, entities and CRLF', () =>
  run((editor, ctx) => {
    const source =
      "\uFEFF__bold__ &amp; [Full][MiXeD] and [Mixed][] and [Mixed] END\r\n\r\n[MiXeD]: <https://example.com> 'Title'\r\n\r\n[unused]: /keep\r\n"
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.firstChild!.nodeSize - 1),
    )
    expect(editor.snapshot().text).toBe(source.replace('END', 'END!'))
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
  }))

test('shared definition editing retains spelling and undo restores source and targets', () =>
  run((editor, ctx) => {
    const source =
      "[One][MiXeD] and [Mixed][] and [Mixed]\n\n[MiXeD]: </old> 'Kept title'\n\n[unused]: /keep\n"
    editor.loadDocument({ ...input, text: source })
    expect(editor.editReferenceDefinition(' MIXED ', '/new')).toBe(true)
    expect(editor.snapshot().text).toBe(source.replace('</old>', '</new>'))
    const view = ctx.get(editorViewCtx)
    const destinations = () => {
      const values: string[] = []
      view.state.doc.descendants((node) => {
        for (const mark of node.marks)
          if (mark.type.name === 'link') values.push(mark.attrs.href)
      })
      return values
    }
    expect(destinations()).toEqual(['/new', '/new', '/new'])
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    expect(destinations()).toEqual(['/old', '/old', '/old'])
  }))

test('editing collapsed link text promotes only that occurrence and preserves neighbours', () =>
  run((editor, ctx) => {
    const source =
      '__bold__ [Label][] and [Label] &amp; END\n\n[Label]: /target\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    let start = -1
    view.state.doc.descendants((node, pos) => {
      if (start < 0 && node.marks.some((mark) => mark.type.name === 'link'))
        start = pos
    })
    view.dispatch(
      view.state.tr.insertText('Changed', start, start + 'Label'.length),
    )
    expect(editor.snapshot().text).toBe(
      source.replace('[Label][]', '[Changed][Label]'),
    )
    const saved = editor.snapshot().text
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(editor.snapshot().text).toBe(saved)
    expect(
      referenceDefinitions(view.state.doc).get('label')!.node.attrs.url,
    ).toBe('/target')
  }))

test('footnote creation, repeated reference navigation, editing, undo and reopening', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: 'Start\n' })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)),
    )
    editor.insertFootnote('MiXeD')
    view.dispatch(closeHistory(view.state.tr))
    view.dispatch(view.state.tr.insertText('Authored **literal** body'))
    const saved = editor.snapshot().text
    expect(saved).toContain('Start[^MiXeD]')
    expect(saved).toContain('[^MiXeD]:')
    expect(saved).toContain('Authored \\*\\*literal\\*\\* body')
    expect(editor.navigateFootnote('reference')).toBe(true)
    expect(editor.navigateFootnote('definition')).toBe(true)
    undo(view.state, view.dispatch)
    expect(view.state.doc.textContent).not.toContain('Authored')
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe('Start\n')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(
      footnoteDefinitions(view.state.doc).get('mixed')!.node.textContent,
    ).toBe('Authored **literal** body')
    expect(editor.snapshot().text).toBe(saved)
  }))

test('selection copy includes recursively needed definitions but excludes unused definitions', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: 'Select[^outer] end\n\n[^outer]: See [Target][REF] and nested[^inner].\n\n[^inner]: Inner body.\n\n[REF]: /needed\n\n[unused]: /unused\n',
    })
    const view = ctx.get(editorViewCtx)
    let reference = -1
    view.state.doc.descendants((node, pos) => {
      if (reference < 0 && node.type.name === 'footnote_reference')
        reference = pos
    })
    view.dispatch(
      view.state.tr.setSelection(
        NodeSelection.create(view.state.doc, reference),
      ),
    )
    const output = await editor.clipboardSnapshot(false)
    expect(output.markdown).toContain('[^outer]:')
    expect(output.markdown).toContain('[^inner]:')
    expect(output.markdown).toContain('[REF]: /needed')
    expect(output.markdown).not.toContain('[unused]')
    expect(output.text).toContain('Inner body.')
    expect(output.html).toContain('href="/needed"')
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: output.text, markdown: output.markdown })
    expect(footnoteDefinitions(view.state.doc).size).toBe(2)
    expect(referenceDefinitions(view.state.doc).size).toBe(1)
  }))

test('explicit Markdown paste remaps case and whitespace label collisions in one undo step', () =>
  run(async (editor, ctx) => {
    const source = '[Existing][My Label]\n\n[My Label]: /existing\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(
          view.state.doc,
          view.state.doc.firstChild!.nodeSize - 1,
        ),
      ),
    )
    await editor.paste({
      text: 'ordinary text is ignored for explicit source',
      markdown: '[Incoming][MY   LABEL]\n\n[MY   LABEL]: /incoming\n',
    })
    const saved = editor.snapshot().text
    expect(saved).toContain('[Existing][My Label]')
    expect(saved).toContain('[Incoming][my label-2]')
    expect(
      referenceDefinitions(view.state.doc).get('my label')!.node.attrs.url,
    ).toBe('/existing')
    expect(
      referenceDefinitions(view.state.doc).get('my label-2')!.node.attrs.url,
    ).toBe('/incoming')
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
  }))

test('pasted unresolved references stay unresolved despite matching destination definitions', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: '[Label]: /existing\n\n[^note]: Existing body\n',
    })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
    )
    await editor.paste({ text: '[Text][LABEL] and unresolved[^NOTE]' })
    const saved = editor.snapshot().text
    expect(saved).toContain('[Text][label-2]')
    expect(saved).toContain('[^note-2]')
    expect(referenceDefinitions(view.state.doc).has('label-2')).toBe(false)
    expect(footnoteDefinitions(view.state.doc).has('note-2')).toBe(false)
  }))

test('ordinary rich copy metadata survives source-free native paste with shared references', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: '[One][Ref] and [Two][Ref] footnote[^Note]\n\n[Ref]: /shared\n\n[^Note]: Footnote body\n',
    })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    const output = await editor.clipboardSnapshot(false)
    expect(output.text).not.toContain('[Ref]:')
    expect(output.html).toContain('data-inkkit-markdown=')
    expect(output.html).not.toContain('class="inkkit-reference-definition"')
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: output.text, html: output.html })
    const saved = editor.snapshot().text
    expect(saved).toContain('[One][Ref] and [Two][Ref]')
    expect(referenceDefinitions(view.state.doc).size).toBe(1)
    expect(footnoteDefinitions(view.state.doc).size).toBe(1)
    expect(saved).toContain('[^Note]: Footnote body')
  }))

test('rich reference metadata imports portable images without retaining source paths', () =>
  run(
    async (editor, ctx) => {
      editor.loadDocument({
        ...input,
        text: '[Linked][Ref] ![Photo](images/original.png)\n\n[Ref]: /target\n',
      })
      const output = await editor.clipboardSnapshot()
      expect(output.html).toContain('data:image/png;base64,AQID')
      expect(output.html).not.toContain('images/original.png')
      editor.loadDocument({ ...input, generation: 2, text: '' })
      await editor.paste({ text: output.text, html: output.html })
      expect(editor.snapshot().text).toContain('images/imported.png')
      expect(editor.snapshot().text).toContain('[Linked][Ref]')
      expect(
        referenceDefinitions(ctx.get(editorViewCtx).state.doc).get('ref')!.node
          .attrs.url,
      ).toBe('/target')
    },
    {
      presentation: () => undefined,
      importImage: async () => ({ reference: 'images/imported.png' }),
      exportImage: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
      }),
    },
  ))

test('footnote labels that cannot reopen are rejected before changing source', () =>
  run((editor) => {
    editor.loadDocument({ ...input, text: 'Original\n' })
    expect(() => editor.insertFootnote('has space')).toThrow()
    expect(editor.snapshot().text).toBe('Original\n')
  }))

test('default footnote labels do not resolve existing unresolved references', () =>
  run((editor) => {
    editor.loadDocument({ ...input, text: 'Unresolved[^1]\n\nEditable\n' })
    editor.find('Editable')
    editor.insertFootnote()
    const saved = editor.snapshot().text
    expect(saved).toContain('Unresolved[^1]')
    expect(saved).toContain('[^2]:')
    expect(saved).not.toContain('[^1]:')
  }))

for (const unresolved of ['[Label][]', '[Label]']) {
  test(`pasting unresolved implicit reference ${unresolved} does not bind an existing label`, () =>
    run(async (editor, ctx) => {
      editor.loadDocument({
        ...input,
        text: 'Destination\n\n[Label]: /existing\n',
      })
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)),
      )
      await editor.paste({ text: `Unresolved ${unresolved}` })
      const saved = editor.snapshot().text
      editor.loadDocument({ ...input, generation: 2, text: saved })
      const linked: string[] = []
      view.state.doc.descendants((node) => {
        if (node.marks.some((mark) => mark.type.name === 'link'))
          linked.push(node.textContent)
      })
      expect(linked).toEqual([])
      expect(referenceDefinitions(view.state.doc).size).toBe(1)
    }))
}

test('footnote navigation works immediately after its marker beside following text', () =>
  run((editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: 'Before[^note] after\n\n[^note]: Body\n',
    })
    const view = ctx.get(editorViewCtx)
    let position = -1
    view.state.doc.descendants((node, pos) => {
      if (position < 0 && node.type.name === 'footnote_reference')
        position = pos
    })
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, position + 1),
      ),
    )
    expect(editor.navigateFootnote('definition')).toBe(true)
    expect(view.state.selection.$from.parent.textContent).toBe('Body')
  }))

test('paste respects an unused definition whose label contains a colon', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: 'Destination\n\n[a:b]: /existing\n' })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)),
    )
    await editor.paste({ text: '[Incoming][a:b]\n\n[a:b]: /incoming\n' })
    expect(
      referenceDefinitions(view.state.doc).get('a:b')!.node.attrs.url,
    ).toBe('/existing')
    const incoming: string[] = []
    view.state.doc.descendants((node) => {
      if (node.text === 'Incoming')
        for (const mark of node.marks)
          if (mark.type.name === 'link') incoming.push(mark.attrs.href)
    })
    expect(incoming).toEqual(['/incoming'])
  }))

test('link editing works for authored reference labels containing entity spelling', () =>
  run((editor, ctx) => {
    const source = '[Reference][a&amp;b]\n\n[a&amp;b]: /old\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    )
    editor.format('link', '/new')
    expect(editor.snapshot().text).toBe(source.replace('/old', '/new'))
  }))

test('adjacent editing retains reference labels with authored entity spelling', () =>
  run((editor, ctx) => {
    const source = '[Reference][a&amp;b] END\n\n[a&amp;b]: /old\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.firstChild!.nodeSize - 1),
    )
    expect(editor.snapshot().text).toBe(source.replace('END', 'END!'))
  }))

test('formatted implicit reference labels retain authored syntax until display formatting changes', () =>
  run((editor, ctx) => {
    const source = '[__Bold__][] END\n\n[__Bold__]: /target\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.firstChild!.nodeSize - 1),
    )
    expect(editor.snapshot().text).toBe(source.replace('END', 'END!'))
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)),
    )
    editor.format('bold')
    expect(editor.snapshot().text).toContain('[Bold][__Bold__]')
    const saved = editor.snapshot().text
    editor.loadDocument({ ...input, generation: 2, text: saved })
    const link = view.state.doc.firstChild!.firstChild!.marks.find(
      (mark) => mark.type.name === 'link',
    )
    expect(link?.attrs.href).toBe('/target')
  }))

test('escaped reference labels and footnote label entities survive source edits and reopening', () =>
  run((editor, ctx) => {
    const source =
      '[Link][a\\*b] footnote[^n&amp;m] END\n\n[a\\*b]: /target\n\n[^n&amp;m]: Body\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.firstChild!.nodeSize - 1),
    )
    expect(editor.snapshot().text).toBe(source.replace('END', 'END!'))
    const saved = editor.snapshot().text
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(referenceDefinitions(view.state.doc).has('a\\*b')).toBe(true)
    expect(footnoteDefinitions(view.state.doc).has('n&amp;m')).toBe(true)
    const copied = editor.clipboardSnapshot()
    return copied.then((output) => {
      expect(output.markdown).toContain('[a\\*b]: /target')
      expect(output.markdown).toContain('[^n&amp;m]: Body')
    })
  }))

test('changing implicit reference text casing keeps its collapsed form and shared target', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: '[Label][]\n\n[Label]: /target\n' })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('LABEL', 1, 6))
    const saved = editor.snapshot().text
    expect(saved).toContain('[LABEL][]')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(
      view.state.doc.firstChild!.firstChild!.marks.find(
        (mark) => mark.type.name === 'link',
      )?.attrs.href,
    ).toBe('/target')
  }))
