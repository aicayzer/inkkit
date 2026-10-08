import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  remarkStringifyOptionsCtx,
  editorViewCtx,
} from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createDialect, stringifyOptions, serialize } from '../src/dialect'
import { imageView, splitAlt, joinAlt } from '../src/images'
import { portableClipboard } from '../src/clipboard'
import { PasteController } from '../src/paste'
import type { DocumentContext, ImageAdapter } from '../src/types'

const bytes = new Uint8Array([1, 2, 3])
const adapter: ImageAdapter = {
  presentation: (reference) => ({ url: `private://image/${reference}` }),
  importImage: async () => ({ reference: 'images/photo.png' }),
  exportImage: async () => ({ bytes, mimeType: 'image/png' }),
}
async function run<T>(
  source: string,
  body: (
    editor: Editor,
    paste: PasteController,
    setContext: (value: DocumentContext) => void,
  ) => T,
  images: ImageAdapter = adapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  let editor!: Editor
  let context = { documentId: 'note', generation: 1, operationId: 'paste' }
  const paste = new PasteController({
    ctx: () => editor.ctx,
    context: () => context,
    adapter: images,
  })
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(true))
    .use(imageView(images))
    .use(paste.plugin)
    .create()
  try {
    return await body(editor, paste, (value) => {
      context = value
    })
  } finally {
    paste.destroy()
    await editor.destroy()
    root.remove()
  }
}
test('presentation URL remains separate from authored reference and portable copy embeds bytes', async () =>
  run('![Photo|320](images/a.png)\n', async (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    expect(view.dom.innerHTML).toContain('private://image/images/a.png')
    expect(serialize(editor.ctx)).toContain('(images/a.png)')
    const out = await portableClipboard(
      view.state.doc.content,
      view.state.schema,
      serialize(editor.ctx),
      adapter,
      { documentId: 'note', generation: 1, operationId: 'copy' },
    )
    expect(out.html).toContain('data:image/png;base64,AQID')
    expect(out.html).not.toContain('private:')
    expect(out.markdown).toContain('(images/a.png)')
    expect(out.images[0]?.reference).toBe('images/a.png')
  }))
test('unavailable image copies a visible warning and no private URL', async () =>
  run('![Missing](private://gone)\n', async (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const out = await portableClipboard(
      view.state.doc.content,
      view.state.schema,
      serialize(editor.ctx),
      undefined,
      { documentId: 'note', generation: 1, operationId: 'copy' },
    )
    expect(out.html).toContain('Missing: image unavailable')
    expect(out.text).toBe('[Missing: image unavailable]')
    expect(out.html).not.toContain('private://gone')
    expect(out.markdown).toContain('(private://gone)')
    expect(out.images[0]?.error).toBeDefined()
  }))
test('copy captures its original fragment while async export is pending', async () => {
  let resolve!: (value: { bytes: Uint8Array; mimeType: string }) => void
  const delayed = {
    ...adapter,
    exportImage: () =>
      new Promise<{ bytes: Uint8Array; mimeType: string }>((done) => {
        resolve = done
      }),
  }
  await run(
    'Old ![Photo](images/a.png)\n',
    async (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const copying = portableClipboard(
        view.state.doc.content,
        view.state.schema,
        serialize(editor.ctx),
        delayed,
        { documentId: 'note', generation: 1, operationId: 'copy' },
      )
      view.dispatch(view.state.tr.insertText('New ', 1))
      resolve({ bytes, mimeType: 'image/png' })
      expect((await copying).text).toBe('Old Photo')
    },
    delayed,
  )
})
test('mixed text and duplicate image previews import once and retain document order in one transaction', async () => {
  let imports = 0
  await run(
    '',
    async (editor, paste) => {
      await paste.paste({
        text: 'before after',
        html: '<p>Before<img src="blob:preview" alt="Photo">Between<img src="blob:preview" alt="Photo">After</p>',
        images: [{ bytes, mimeType: 'image/png' }],
      })
      expect(imports).toBe(1)
      expect(serialize(editor.ctx)).toBe(
        'Before![Photo](images/photo.png)Between![Photo](images/photo.png)After\n',
      )
    },
    {
      ...adapter,
      importImage: async () => {
        imports++
        return { reference: 'images/photo.png' }
      },
    },
  )
})
test('pending import maps its insertion point through intervening edits', async () => {
  let resolve!: (value: { reference: string }) => void
  await run(
    'Before\n',
    async (editor, paste) => {
      const view = editor.ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)),
      )
      const pending = paste.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png' }],
      })
      expect(paste.pending).toBe(true)
      view.dispatch(view.state.tr.insertText('New ', 1))
      resolve({ reference: 'images/photo.png' })
      await pending
      expect(serialize(editor.ctx)).toBe(
        'New Before![Image](images/photo.png)\n',
      )
      expect(paste.pending).toBe(false)
    },
    {
      ...adapter,
      importImage: () =>
        new Promise((done) => {
          resolve = done
        }),
    },
  )
})
test('document switch rejects stale imported images without modifying replacement', async () => {
  let resolve!: (value: { reference: string }) => void
  await run(
    'Original\n',
    async (editor, paste, setContext) => {
      const pending = paste.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png' }],
      })
      setContext({
        documentId: 'different',
        generation: 2,
        operationId: 'switch',
      })
      resolve({ reference: 'images/photo.png' })
      await expect(pending).rejects.toMatchObject({ code: 'stale-document' })
      expect(serialize(editor.ctx)).toBe('Original\n')
    },
    {
      ...adapter,
      importImage: () =>
        new Promise((done) => {
          resolve = done
        }),
    },
  )
})
test('plain paste preserves literal syntax and malformed VS Code metadata cannot throw', async () =>
  run('', async (editor, paste) => {
    await paste.paste({ text: '**literal** &#x20; ', plainText: true })
    expect(editor.ctx.get(editorViewCtx).state.doc.textContent).toBe(
      '**literal** &#x20; ',
    )
    const view = editor.ctx.get(editorViewCtx)
    const event = {
      clipboardData: {
        getData: (type: string) =>
          type === 'vscode-editor-data'
            ? '{'
            : type === 'text/plain'
              ? 'literal'
              : '',
        files: [],
      },
    } as unknown as ClipboardEvent
    expect(() =>
      view.someProp('handlePaste', (handler) =>
        handler(view, event, view.state.selection.content()),
      ),
    ).not.toThrow()
  }))
test('unsupported merged HTML table remains literal and ordinary HTML table becomes editable', async () =>
  run('', async (editor, paste) => {
    await paste.paste({
      text: 'table',
      html: '<table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>',
    })
    expect(serialize(editor.ctx)).toContain('colspan="2"')
    expect(editor.ctx.get(editorViewCtx).state.doc.firstChild?.type.name).toBe(
      'literal_markdown',
    )
  }))
test('resize width metadata remains portable authored alt text', () => {
  expect(splitAlt('Photo|320')).toEqual({ alt: 'Photo', width: 320 })
  expect(joinAlt('Photo', 320)).toBe('Photo|320')
})
test('failed image import preserves accompanying text and an alt warning', async () =>
  run(
    '',
    async (editor, paste) => {
      await paste.paste({
        text: 'Keep this',
        images: [{ bytes, mimeType: 'image/png', filename: 'Photo' }],
      })
      expect(editor.ctx.get(editorViewCtx).state.doc.textContent).toBe(
        'Keep this[Photo: image unavailable]',
      )
    },
    {
      ...adapter,
      importImage: async () => {
        throw new Error('disk full')
      },
    },
  ))
test('source metadata maps captured bytes to matching preview independently of DOM order', async () => {
  const seen: number[] = []
  await run(
    '',
    async (editor, paste) => {
      await paste.paste({
        text: '',
        html: '<p><img src="blob:b" alt="B"><img src="blob:a" alt="A"></p>',
        images: [
          {
            bytes: new Uint8Array([1]),
            mimeType: 'image/png',
            source: 'blob:a',
          },
          {
            bytes: new Uint8Array([2]),
            mimeType: 'image/png',
            source: 'blob:b',
          },
        ],
      })
      expect(seen).toEqual([2, 1])
      expect(serialize(editor.ctx)).toContain('(images/2.png)')
    },
    {
      ...adapter,
      importImage: async (input) => {
        seen.push(input.bytes[0]!)
        return { reference: `images/${input.bytes[0]}.png` }
      },
    },
  )
})
test('portable image results retain selection order when exports finish in reverse order', async () => {
  let first!: (value: { bytes: Uint8Array; mimeType: string }) => void
  await run('![A](images/a.png) ![B](images/b.png)\n', async (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const exporting = portableClipboard(
      view.state.doc.content,
      view.state.schema,
      serialize(editor.ctx),
      {
        ...adapter,
        exportImage: (reference) =>
          reference.endsWith('a.png')
            ? new Promise((done) => {
                first = done
              })
            : Promise.resolve({ bytes, mimeType: 'image/png' }),
      },
      { documentId: 'note', generation: 1, operationId: 'copy' },
    )
    first({ bytes, mimeType: 'image/png' })
    expect((await exporting).images.map((image) => image.reference)).toEqual([
      'images/a.png',
      'images/b.png',
    ])
  })
})
test('ordinary rectangular HTML table imports with editable header and rows', async () =>
  run('', async (editor, paste) => {
    await paste.paste({
      text: 'a b c d',
      html: '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
    })
    const doc = editor.ctx.get(editorViewCtx).state.doc
    let table = doc.firstChild!
    doc.descendants((node) => {
      if (node.type.name === 'table') table = node
    })
    expect(doc.toJSON()).toEqual(expect.objectContaining({ type: 'doc' }))
    expect(table.type.name).toBe('table')
    expect(table.firstChild?.firstChild?.type.name).toBe('table_header')
    expect(table.lastChild?.firstChild?.type.name).toBe('table_cell')
    expect(serialize(editor.ctx)).toMatch(/\| c +\| d +\|/)
    expect(serialize(editor.ctx)).not.toContain('<br />')
  }))
test('nested and multiple-paragraph tables preserve their original structure literally', async () =>
  run('', async (editor, paste) => {
    await paste.paste({
      text: 'a b',
      html: '<table><tr><td><p>a</p><p>b</p></td></tr></table>',
    })
    expect(serialize(editor.ctx)).toContain('<p>a</p><p>b</p>')
    expect(editor.ctx.get(editorViewCtx).state.doc.firstChild?.type.name).toBe(
      'literal_markdown',
    )
  }))
test('destroy during import rejects completion and releases pending state', async () => {
  let resolve!: (value: { reference: string }) => void
  await run(
    '',
    async (editor, paste) => {
      const pending = paste.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png' }],
      })
      paste.destroy()
      resolve({ reference: 'images/photo.png' })
      await expect(pending).rejects.toMatchObject({ code: 'destroyed' })
      expect(paste.pending).toBe(false)
    },
    {
      ...adapter,
      importImage: () =>
        new Promise((done) => {
          resolve = done
        }),
    },
  )
})
test('image resize writes width into alt metadata and read-only images refuse resize', async () =>
  run('![Photo|320](images/a.png)\n', async (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const image = view.dom.querySelector('.image img') as HTMLImageElement
    image.getBoundingClientRect = () => new DOMRect(0, 0, 320, 100)
    Object.defineProperty(view.dom, 'clientWidth', { value: 500 })
    const handle = view.dom.querySelector('.image-handle')!
    handle.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 100,
        bubbles: true,
        cancelable: true,
      }),
    )
    handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 160 }))
    handle.dispatchEvent(new MouseEvent('pointerup', { clientX: 160 }))
    expect(serialize(editor.ctx)).toContain('![Photo|380](images/a.png)')
    view.setProps({ editable: () => false })
    const readonlyHandle = view.dom.querySelector('.image-handle')!
    readonlyHandle.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 100,
        bubbles: true,
        cancelable: true,
      }),
    )
    readonlyHandle.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 200 }),
    )
    readonlyHandle.dispatchEvent(new MouseEvent('pointerup', { clientX: 200 }))
    expect(serialize(editor.ctx)).toContain('![Photo|380](images/a.png)')
  }))
test('unassociated native bitmap cannot replace two unrelated HTML remote images', async () => {
  let imports = 0
  await run(
    '',
    async (editor, paste) => {
      const view = editor.ctx.get(editorViewCtx)
      const file = new File([bytes], 'Preview.png', { type: 'image/png' })
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => bytes.buffer,
      })
      const data = {
        'text/plain': 'Before After',
        'text/html':
          '<p>Before<img src="https://one.example/image.png" alt="One">After<img src="https://two.example/image.png" alt="Two"></p>',
      }
      const event = {
        clipboardData: {
          getData: (type: string) => data[type as keyof typeof data] ?? '',
          files: [file],
        },
      } as unknown as ClipboardEvent
      expect(
        view.someProp('handlePaste', (handler) =>
          handler(view, event, view.state.selection.content()),
        ),
      ).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(paste.pending).toBe(false)
      expect(imports).toBe(0)
      expect(view.state.doc.textContent).toBe(
        'Before[One: image unavailable]After[Two: image unavailable]',
      )
    },
    {
      ...adapter,
      importImage: async () => {
        imports++
        return { reference: 'wrong-preview.png' }
      },
    },
  )
})
test('cancelled same-document import cannot commit or clear a newer pending operation', async () => {
  const completions: ((value: { reference: string }) => void)[] = []
  await run(
    'Original\n',
    async (editor, paste) => {
      const first = paste.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png' }],
      })
      paste.cancelPending()
      expect(paste.pending).toBe(false)
      const second = paste.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png' }],
      })
      completions[0]!({ reference: 'images/stale.png' })
      await expect(first).rejects.toMatchObject({ code: 'stale-document' })
      expect(paste.pending).toBe(true)
      completions[1]!({ reference: 'images/new.png' })
      await second
      expect(serialize(editor.ctx)).not.toContain('stale.png')
      expect(serialize(editor.ctx)).toContain('images/new.png')
      expect(paste.pending).toBe(false)
    },
    {
      ...adapter,
      importImage: () =>
        new Promise((done) => {
          completions.push(done)
        }),
    },
  )
})
test('unsupported HTML elements remain opaque source while surrounding formatting stays rich', async () =>
  run('', async (editor, paste) => {
    const before = (
      globalThis as typeof globalThis & { inkkitExecuted?: boolean }
    ).inkkitExecuted
    await paste.paste({
      text: 'Before After',
      html: '<p><strong>Before</strong></p><iframe src="https://example.test/private">Frame</iframe><p><em>After</em></p><script>globalThis.inkkitExecuted = true</script><custom-widget><b>Custom</b></custom-widget><div><span>Tail</span></div>',
    })
    const markdown = serialize(editor.ctx)
    expect(markdown).toContain('**Before**')
    expect(markdown).toContain('*After*')
    expect(markdown).toContain(
      '<iframe src="https://example.test/private">Frame</iframe>',
    )
    expect(markdown).toContain(
      '<script>globalThis.inkkitExecuted = true</script>',
    )
    expect(markdown).toContain('<custom-widget><b>Custom</b></custom-widget>')
    expect(markdown).toContain('Tail')
    expect(
      editor.ctx
        .get(editorViewCtx)
        .dom.querySelector('iframe,script,custom-widget'),
    ).toBe(null)
    expect(
      (globalThis as typeof globalThis & { inkkitExecuted?: boolean })
        .inkkitExecuted,
    ).toBe(before)
  }))
test('unsupported SVG/math/object and authored HTML comments survive clipboard import safely', async () =>
  run('', async (editor, paste) => {
    await paste.paste({
      text: 'content',
      html: '<p>Before</p><!--keep--><svg><circle cx="5"></circle></svg><math><mi>x</mi></math><object data="private.bin"><p>Fallback</p></object><p>After</p>',
    })
    const markdown = serialize(editor.ctx)
    expect(markdown).toContain('<!--keep-->')
    expect(markdown).toContain('<svg>')
    expect(markdown).toContain('<math>')
    expect(markdown).toContain('<object data="private.bin">')
    expect(
      editor.ctx.get(editorViewCtx).dom.querySelector('svg,math,object'),
    ).toBe(null)
  }))
test('native Obsidian clipboard preserves headings without importing reading-view controls', async () =>
  run('', async (editor, paste) => {
    const html = readFileSync(
      'test/fixtures/obsidian-native-clipboard.txt',
      'utf8',
    )
    await paste.paste({ text: 'Clipboard heading', html })
    const markdown = serialize(editor.ctx)
    expect(markdown).toMatch(/^# Clipboard heading\n/)
    expect(markdown).toContain('**bold**')
    expect(markdown).toContain('*italic*')
    expect(markdown).toContain('- first item')
    expect(markdown).toContain('1. ordered one')
    expect(markdown).toContain('let answer = 42')
    expect(markdown).toContain('| Alpha | 42')
    expect(markdown).not.toMatch(/meta charset|<svg|Disposable note title/)
    expect(
      editor.ctx.get(editorViewCtx).dom.querySelector('h1')?.textContent,
    ).toBe('Clipboard heading')
  }))
test('clipboard control filtering preserves authored SVG and similarly named content', async () =>
  run('', async (editor, paste) => {
    await paste.paste({
      text: 'Authored content',
      html: '<div class="mod-header mod-ui"><p>Authored content</p></div><svg class="svg-icon right-triangle"><path d="M1 1"></path></svg><h1>Plain heading</h1>',
    })
    const markdown = serialize(editor.ctx)
    expect(markdown).toContain('Authored content')
    expect(markdown).toContain('<svg class="svg-icon right-triangle">')
    expect(markdown).toContain('# Plain heading')
  }))
