import { expect, test } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { DOMParser, DOMSerializer } from '@milkdown/kit/prose/model'
import { createDialect, serialize, stringifyOptions } from '../src/dialect'
import { withEditor } from './harness'

for (const source of [
  '<section>&amp; **raw**</section>',
  '![Picture](images/local.png)',
]) {
  test(`HTML clipboard retains literal Markdown: ${source}`, async () => {
    await withEditor(source, (editor) => {
      const { doc, schema } = editor.ctx.get(editorViewCtx).state
      const container = document.createElement('div')
      container.append(
        DOMSerializer.fromSchema(schema).serializeFragment(doc.content),
      )
      const copied = DOMParser.fromSchema(schema).parse(container)
      expect(copied.firstChild?.type.name).toBe('literal_markdown')
      expect(serialize(editor.ctx, copied)).toBe(serialize(editor.ctx, doc))
    })
  })
}

test('GFM tables are editable and keep alignment and escaped cell pipes', async () => {
  await withEditor(
    '| A | B |\n| :--- | ---: |\n| **x** | one \\| two |\n',
    (editor) => {
      const { doc } = editor.ctx.get(editorViewCtx).state
      expect(doc.firstChild?.type.name).toBe('table')
      expect(doc.textContent).toContain('one | two')
      const markdown = serialize(editor.ctx)
      expect(markdown).toContain('one \\| two')
      expect(markdown).toContain(':')
    },
  )
})

test('footnote text inside fenced code stays code', async () => {
  await withEditor('```txt\n[^example]\n```\n', (editor) => {
    expect(editor.ctx.get(editorViewCtx).state.doc.firstChild?.type.name).toBe(
      'code_block',
    )
  })
})

test('header-only GFM tables do not acquire empty body rows', async () => {
  await withEditor('| Header |\n| --- |\n', (editor) => {
    expect(editor.ctx.get(editorViewCtx).state.doc.firstChild?.childCount).toBe(
      1,
    )
    expect(serialize(editor.ctx).trim().split('\n')).toHaveLength(2)
  })
})

test('safe inline HTML breaks reopen as visible breaks and other HTML stays literal', async () => {
  await withEditor('Line<br />\n', (editor) => {
    const doc = editor.ctx.get(editorViewCtx).state.doc
    expect(doc.firstChild?.lastChild?.type.name).toBe('hardbreak')
    expect(serialize(editor.ctx)).toBe('Line<br />\n')
  })
  await withEditor('Line<br class="custom" />\n', (editor) => {
    expect(editor.ctx.get(editorViewCtx).state.doc.firstChild?.type.name).toBe(
      'literal_markdown',
    )
  })
})

test('HTML images preserve absent titles', async () => {
  await withEditor('', (editor) => {
    const { schema } = editor.ctx.get(editorViewCtx).state
    const container = document.createElement('div')
    container.innerHTML = '<p><img src="images/test.png" alt="Photo"></p>'
    expect(
      DOMParser.fromSchema(schema).parse(container).firstChild?.firstChild
        ?.attrs.title,
    ).toBe('')
  })
})

test('managed images are optional and preserve original references', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const source = '![alt|400](sha256:' + 'a'.repeat(64) + ')\n'
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(true))
    .create()
  try {
    expect(
      editor.ctx.get(editorViewCtx).state.doc.firstChild?.firstChild?.type.name,
    ).toBe('image')
    expect(serialize(editor.ctx)).toBe(source)
  } finally {
    await editor.destroy()
    root.remove()
  }
})
