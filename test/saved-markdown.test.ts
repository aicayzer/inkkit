import { expect, test } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { createDialect, serialize, stringifyOptions } from '../src/dialect'
import { InkKitEditor } from '../src/editor'
import { PasteController } from '../src/paste'
import type { ImageAdapter } from '../src/types'

// Values that arrive in HTML attributes or through the API must save as the
// same structure they were inserted as: parsing the saved Markdown back gives
// the same sequence of nodes and marks.

const adapter: ImageAdapter = {
  presentation: (reference) => ({ url: `private://image/${reference}` }),
  importImage: async () => ({ reference: 'images/photo.png' }),
  exportImage: async () => ({ bytes: new Uint8Array(), mimeType: 'image/png' }),
}

const shape = (doc: ProseNode) => {
  const found: string[] = []
  doc.descendants((node) => {
    found.push(
      node.type.name + node.marks.map((mark) => `[${mark.type.name}]`).join(''),
    )
  })
  return found
}

async function saved(html: string, via: 'paste' | 'drop') {
  const root = document.createElement('div')
  document.body.append(root)
  let editor!: Editor
  const paste = new PasteController({
    ctx: () => editor.ctx,
    context: () => ({ documentId: 'note', generation: 1, operationId: 'p' }),
    adapter,
  })
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, '')
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(true))
    .use(paste.plugin)
    .create()
  try {
    const view = editor.ctx.get(editorViewCtx)
    if (via === 'paste') await paste.paste({ text: 'text', html })
    else view.pasteHTML(html, new Event('paste') as ClipboardEvent)
    const markdown = serialize(editor.ctx)
    const reread = shape(editor.ctx.get(parserCtx)(markdown))
    return {
      markdown,
      inserted: shape(view.state.doc),
      reread,
      count: (name: string) =>
        reread.filter((found) => found.startsWith(name)).length,
    }
  } finally {
    paste.destroy()
    await editor.destroy()
    root.remove()
  }
}

const hostile = '&#10;&#10;[l](https://example.test/q) &lt;b&gt;h&lt;/b&gt;'
const definition = (attributes: string, text = 'd') =>
  `<div data-inkkit-reference-definition="x" data-inkkit-label="x" data-inkkit-url="https://example.test/" ${attributes}>${text}</div>`

for (const via of ['paste', 'drop'] as const) {
  test(`a definition title with line breaks saves as one definition (${via})`, async () => {
    const result = await saved(
      definition(
        `data-inkkit-title="a${hostile}"`,
        `[x]: https://example.test/ "a${hostile}"`,
      ),
      via,
    )
    expect(result.reread).toEqual(result.inserted)
    expect(result.count('reference_definition')).toBe(1)
    expect(result.count('literal_markdown')).toBe(0)
    expect(result.markdown.split('\n\n')).toHaveLength(1)
  })

  test(`labels with line breaks or brackets save as the structure they were inserted as (${via})`, async () => {
    const label = 'x]&#10;&#10;# H'
    for (const html of [
      `<div data-inkkit-reference-definition="x" data-inkkit-label="${label}" data-inkkit-url="https://example.test/">d</div>`,
      `<p>a<sup data-inkkit-footnote-reference="x" data-inkkit-label="${label}">1</sup></p>`,
      `<p>a</p><div data-inkkit-footnote-definition="x" data-inkkit-label="${label}"><p>body</p></div>`,
      `<p><a href="https://example.test/" data-inkkit-reference="x" data-inkkit-label="${label}" data-inkkit-reference-type="full">t</a></p>`,
      `<p><a href="https://example.test/" data-inkkit-reference="x${label}" data-inkkit-reference-type="full">t</a></p>`,
    ]) {
      const result = await saved(html, via)
      expect(result.count('heading'), html).toBe(0)
    }
  })
}

test('a code fence from HTML cannot carry an info string or an open end that the fence rules refuse', async () => {
  const fence = (value: object) =>
    `<pre data-language="js" data-inkkit-fence='${JSON.stringify(value)}'><code>a</code></pre><p>after</p>`
  const base = {
    marker: '```',
    info: 'js',
    close: '```',
    trailing: '',
    ending: '\n',
  }
  const kept = await saved(fence(base), 'drop')
  expect(kept.markdown).toBe('```js\na\n```\n\nafter\n')
  for (const value of [
    { ...base, info: 'js `x' },
    { ...base, close: '' },
  ]) {
    const result = await saved(fence(value), 'drop')
    expect(result.reread, JSON.stringify(value)).toEqual(result.inserted)
    expect(result.markdown, JSON.stringify(value)).toMatch(/\n```\n/)
  }
})

test('comment elements in HTML save as text that cannot become structure', async () => {
  for (const html of [
    '<p>a<span data-inkkit-comment="html">x --&gt; # H &lt;b&gt;h</span>b</p>',
    '<p>a<span data-inkkit-comment="obsidian">x %% # H *e*</span>b</p>',
    '<div data-inkkit-comment="html">x --&gt;&#10;&#10;# H</div>',
    '<div data-inkkit-comment="obsidian">x %%&#10;&#10;# H</div>',
  ])
    for (const via of ['paste', 'drop'] as const) {
      const result = await saved(html, via)
      expect(result.count('heading'), html).toBe(0)
      expect(result.markdown, html).not.toMatch(/(?<!\\)<b>|(?<!\\)\*e\*/)
      expect(result.reread, html).toEqual(result.inserted)
    }
  const kept = await saved(
    '<p>a<span data-inkkit-comment="html">note</span>b</p>',
    'drop',
  )
  expect(kept.markdown).toBe('anoteb\n')
})

test('editing a reference definition through the API saves one definition', async () => {
  const errors: string[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error.message),
    },
    {},
  )
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: '[a][ref]\n\n[ref]: https://example.test/ "Title"\n',
    })
    expect(
      editor.editReferenceDefinition(
        'ref',
        'https://example.test/next',
        `Title${'\n\n'}[l](https://example.test/q) <b>h</b>\n  \n`,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
    const text = editor.snapshot().text
    expect(text.trim().split('\n\n')).toHaveLength(2)
    expect(text).toContain(
      '[ref]: https://example.test/next "Title [l](https://example.test/q) <b>h</b> "',
    )
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const reread = shape(ctx.get(parserCtx)(text))
    expect(
      reread.filter((name) => name === 'reference_definition'),
    ).toHaveLength(1)
    expect(reread).not.toContain('literal_markdown')

    editor.editReferenceDefinition('ref', 'https://example.test/\n\n# H', 'T')
    const next = editor.snapshot().text
    expect(shape(ctx.get(parserCtx)(next))).not.toContain('heading')
  } finally {
    await editor.destroy()
    root.remove()
  }
})
