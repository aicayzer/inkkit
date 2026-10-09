import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { clipboardContent, portableClipboard } from '../src/clipboard'
import { printableMarkdown } from '../src/print'
import { readableProjection, projectionPosition } from '../src/text-ranges'
import type { FileAdapter, FilePresentation } from '../src/types'
import { InkKitEditor, type EditorOptions } from '../src/index'

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const context = { documentId: 'linked', generation: 1, operationId: 'export' }
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    inkkit_wiki_link: {
      inline: true,
      atom: true,
      group: 'inline',
      attrs: { raw: {}, target: {}, label: { default: '' } },
      toDOM: (node) => ['a', { href: node.attrs.target }, node.attrs.label],
    },
    image: {
      inline: true,
      atom: true,
      group: 'inline',
      attrs: {
        src: {},
        alt: { default: '' },
        title: { default: '' },
        inkkitFileRaw: { default: null },
        inkkitFileTarget: { default: null },
        inkkitFileFragment: { default: null },
        inkkitFileWidth: { default: null },
      },
      toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt }],
    },
  },
})

const attachment = () =>
  schema.node('image', {
    src: 'opaque-name',
    alt: 'Authored name|240',
    inkkitFileRaw: '![[opaque-name|240]]',
    inkkitFileTarget: 'opaque-name',
    inkkitFileWidth: 240,
  })
const mixedFiles = () =>
  schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Before '),
      attachment(),
      schema.text(' after.'),
    ]),
  ])

test('escaped numeric pipe in a named reference is part of its label and not image sizing', async () => {
  const image = schema.node('image', {
    src: 'a|400',
    alt: 'a|400',
    inkkitFileRaw: '![[a\\|400]]',
    inkkitFileTarget: 'a|400',
    inkkitFileWidth: null,
  })
  const doc = schema.node('doc', null, schema.node('paragraph', null, image))
  const copied = await portableClipboard(
    doc.content,
    schema,
    '![[a\\|400]]',
    {
      presentation: () => undefined,
      importImage: async () => ({ reference: 'unused' }),
      exportImage: async () => ({
        bytes: new Uint8Array([1]),
        mimeType: 'image/png',
      }),
    },
    context,
  )
  expect(copied.text).toBe('a|400')
  expect(copied.html).not.toContain('width=')
  expect(readableProjection(doc).text).toBe('a|400')
})

test.each(['audio', 'video', 'pdf', 'file', 'missing', 'error'] as const)(
  '%s files export useful descriptions without private resources or asset export',
  async (kind) => {
    const label = 'Useful <name> & title'
    const presentation: FilePresentation =
      kind === 'error'
        ? { kind, label, message: 'private://error-detail' }
        : kind === 'file' || kind === 'missing'
          ? { kind, label }
          : { kind, label, url: 'private://display-resource' }
    const exportImage = vi.fn(async () => {
      throw new Error('Non-image file bytes must not be exported')
    })
    const files: FileAdapter = {
      resolve: async () => presentation,
      exportImage,
    }
    const source = 'Before ![[opaque-name|240]] after.'
    const doc = mixedFiles()
    const copied = await portableClipboard(
      doc.content,
      schema,
      source,
      undefined,
      context,
      undefined,
      files,
    )
    const status =
      kind === 'missing' ? ' (unavailable)' : kind === 'error' ? ' (error)' : ''
    const title =
      kind === 'pdf'
        ? 'PDF'
        : kind === 'missing' || kind === 'error'
          ? 'File'
          : kind[0]!.toUpperCase() + kind.slice(1)
    const expected = `Before [${title}: ${label}${status}] after.`
    expect(copied.text).toBe(expected)
    expect(copied.markdown).toBe(source)
    expect(copied.html).toContain('&lt;name&gt; &amp; title')
    expect(copied.html).not.toContain('private://')
    expect(copied.html).not.toMatch(/<(img|audio|video|iframe|object|embed)\b/)
    expect(copied.images).toEqual([])
    const printed = await printableMarkdown(
      doc.content,
      schema,
      undefined,
      context,
      files,
    )
    expect(
      new DOMParser().parseFromString(printed.html, 'text/html').body
        .textContent,
    ).toBe(expected)
    expect(printed.html).not.toContain('private://')
    expect(printed.assets).toEqual([])
    expect(printed.warnings).toEqual([
      expect.objectContaining({
        code:
          kind === 'missing' || kind === 'error'
            ? 'attachment-unavailable'
            : 'attachment-fallback',
      }),
    ])
    expect(exportImage).not.toHaveBeenCalled()
  },
)

test('image export failure retains its useful description in copy and rejects complete print output', async () => {
  const files: FileAdapter = {
    resolve: async () => ({
      kind: 'image',
      url: 'private://display',
      label: 'Useful photo',
    }),
    exportImage: async () => {
      throw new Error('Storage is unavailable')
    },
  }
  const doc = mixedFiles()
  const copied = await portableClipboard(
    doc.content,
    schema,
    'Before ![[opaque-name|240]] after.',
    undefined,
    context,
    undefined,
    files,
  )
  expect(copied.text).toBe('Before [Useful photo: image unavailable] after.')
  expect(copied.html).not.toContain('private://')
  expect(copied.images).toEqual([
    expect.objectContaining({
      alt: 'Useful photo',
      error: 'Storage is unavailable',
    }),
  ])
  await expect(
    printableMarkdown(doc.content, schema, undefined, context, files),
  ).rejects.toMatchObject({ code: 'image-unavailable' })
})

test.each(['copy', 'print'] as const)(
  'cancelled %s rejects a resolver completion that ignores cancellation',
  async (operation) => {
    let finish!: (presentation: FilePresentation) => void
    const files: FileAdapter = {
      resolve: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    }
    const controller = new AbortController()
    const doc = mixedFiles()
    const pending =
      operation === 'copy'
        ? portableClipboard(
            doc.content,
            schema,
            '![[opaque-name|240]]',
            undefined,
            context,
            undefined,
            files,
            controller.signal,
          )
        : printableMarkdown(
            doc.content,
            schema,
            undefined,
            context,
            files,
            controller.signal,
          )
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    })
    controller.abort()
    await rejected
    finish({ kind: 'video', url: 'private://late', label: 'Late name' })
  },
)

test.each(['copy', 'print'] as const)(
  'cancelled %s rejects held image bytes promptly and handles a later adapter failure',
  async (operation) => {
    let fail!: (error: Error) => void
    const files: FileAdapter = {
      resolve: async () => ({ kind: 'image', url: 'private://preview' }),
      exportImage: () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    }
    const controller = new AbortController()
    const doc = mixedFiles()
    const pending =
      operation === 'copy'
        ? portableClipboard(
            doc.content,
            schema,
            '![[opaque-name|240]]',
            undefined,
            context,
            undefined,
            files,
            controller.signal,
          )
        : printableMarkdown(
            doc.content,
            schema,
            undefined,
            context,
            files,
            controller.signal,
          )
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    controller.abort()
    await rejected
    fail(new Error('Late storage failure'))
    await Promise.resolve()
  },
)

test('wiki links retain useful labels and mixed text without portable host URLs or source syntax', async () => {
  const label = 'Useful <label> & name'
  const source = `Before [[private://target|${label}]] after.`
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Before '),
      schema.node('inkkit_wiki_link', {
        raw: `[[private://target|${label}]]`,
        target: 'private://target',
        label,
      }),
      schema.text(' after.'),
    ]),
  ])
  const copied = await portableClipboard(
    doc.content,
    schema,
    source,
    undefined,
    context,
  )
  expect(copied.text).toBe(`Before ${label} after.`)
  expect(copied.html).toContain('Useful &lt;label&gt; &amp; name')
  expect(copied.html).not.toContain('href=')
  expect(copied.html).not.toContain('private://')
  expect(copied.markdown).toBe(source)
  const printed = await printableMarkdown(
    doc.content,
    schema,
    undefined,
    context,
  )
  expect(
    new DOMParser().parseFromString(printed.html, 'text/html').body.textContent,
  ).toBe(`Before ${label} after.`)
  expect(printed.html).not.toContain('private://')
  expect(printed.assets).toEqual([])
  expect(printed.warnings).toEqual([])
  const readable = readableProjection(doc)
  expect(readable.text).toBe(copied.text)
  const span = readable.spans.find((span) => span.kind === 'embed')!
  expect(readable.text.slice(span.from, span.to)).toBe(label)
  expect(projectionPosition(readable, span.from, 1)).toBe(8)
  expect(projectionPosition(readable, span.to, -1)).toBe(9)
})

test('an unaliased wiki link uses its opaque authored target as descriptive text only', () => {
  const content = schema.node('paragraph', null, [
    schema.node('inkkit_wiki_link', { raw: '[[Notes/A]]', target: 'Notes/A' }),
  ]).content
  expect(clipboardContent(content, schema)).toEqual({
    text: 'Notes/A',
    html: '<span>Notes/A</span>',
  })
})

async function withLinkedEditor(
  options: EditorOptions,
  run: (editor: InkKitEditor) => Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
    },
    options,
  )
  try {
    await run(editor)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('mixed selection preserves wiki/media Markdown and pastes descriptive rich text without private resources', async () => {
  await withLinkedEditor(
    {
      wikiLinks: { open() {} },
      files: {
        resolve: async () => ({
          kind: 'audio',
          url: 'private://song',
          label: 'Song name',
        }),
      },
    },
    async (editor) => {
      const source =
        'Before [[Notes/A|Wiki alias]] and ![[song]] after. excluded.\n'
      editor.loadDocument({
        documentId: 'mixed',
        generation: 1,
        format: 'md',
        text: source,
      })
      const text = editor.textSnapshot()
      editor.selectTextRange({
        snapshotId: text.snapshotId,
        from: 0,
        to: text.text.indexOf(' excluded'),
      })
      const copied = await editor.clipboardSnapshot(false)
      expect(copied.text).toBe(
        'Before Wiki alias and [Audio: Song name] after.',
      )
      expect(copied.markdown).toContain('[[Notes/A|Wiki alias]]')
      expect(copied.markdown).toContain('![[song]]')
      expect(copied.markdown).not.toContain('excluded')
      expect(copied.html).not.toContain('private://')
      await withLinkedEditor({}, async (recipient) => {
        recipient.loadDocument({
          documentId: 'recipient',
          generation: 1,
          format: 'md',
          text: '',
        })
        await recipient.paste({ text: copied.text, html: copied.html })
        expect(recipient.textSnapshot().text).toBe(copied.text)
      })
      expect(editor.snapshot().text).toBe(source)
    },
  )
})

for (const operation of ['copy', 'print'] as const) {
  test.each(['reload', 'source', 'mode', 'destroy'] as const)(
    `${operation} aborts a held file resolver promptly after %s and rejects its stale completion`,
    async (mutation) => {
      let hold = false
      let finish!: (presentation: FilePresentation) => void
      let signal!: AbortSignal
      await withLinkedEditor(
        {
          files: {
            resolve: async (_reference, context) => {
              if (!hold) return { kind: 'file', label: 'Current name' }
              signal = context.signal
              return await new Promise<FilePresentation>((resolve) => {
                finish = resolve
              })
            },
          },
        },
        async (editor) => {
          const input = {
            documentId: 'held',
            generation: 1,
            format: 'md' as const,
            text: 'Before ![[opaque]] after.\n',
          }
          editor.loadDocument(input)
          hold = true
          const pending =
            operation === 'copy'
              ? editor.clipboardSnapshot()
              : editor.printableSnapshot()
          const rejected = expect(pending).rejects.toMatchObject({
            code: mutation === 'destroy' ? 'destroyed' : 'stale-document',
          })
          await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
          const exportSignal = signal
          const completeExport = finish
          if (mutation === 'reload') editor.reloadDocument(input)
          else if (mutation === 'source') editor.replaceSource('Replacement\n')
          else if (mutation === 'mode') editor.setEditingMode('source')
          else await editor.destroy()
          expect(exportSignal.aborted).toBe(true)
          await rejected
          completeExport({
            kind: 'video',
            url: 'private://late',
            label: 'Late name',
          })
          if (mutation !== 'destroy')
            expect(editor.snapshot().text).not.toContain('Late name')
        },
      )
    },
  )
}
