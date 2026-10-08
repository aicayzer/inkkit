import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  DOMParser as ProseParser,
  Fragment,
  Slice,
} from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import {
  InkKitError,
  type ClipboardInput,
  type CapturedImage,
  type DocumentContext,
  type ImageAdapter,
} from './types'

export interface PasteControllerOptions {
  ctx: () => Ctx
  context: () => DocumentContext
  adapter?: ImageAdapter
  onError?: (error: unknown) => void
  editable?: () => boolean
  literalText?: () => boolean
}
interface Anchor {
  from: number
  to: number
}

export class PasteController {
  private active?: Anchor
  private dead = false
  get pending(): boolean {
    return this.active != null
  }
  readonly plugin
  constructor(private readonly options: PasteControllerOptions) {
    this.plugin = $prose(
      () =>
        new Plugin({
          key: new PluginKey('inkkitPaste'),
          state: {
            init: () => null,
            apply: (transaction) => {
              if (this.active) {
                const empty = this.active.from === this.active.to
                this.active.from = transaction.mapping.map(this.active.from, 1)
                this.active.to = transaction.mapping.map(
                  this.active.to,
                  empty ? 1 : -1,
                )
              }
              return null
            },
          },
          props: {
            handlePaste: (view, event) => {
              const data = event.clipboardData
              if (!data || !view.editable) return false
              if (view.state.selection.$from.parent.type.spec.code) return false
              const text = data.getData('text/plain')
              const html = data.getData('text/html')
              const metadata = data.getData('vscode-editor-data')
              if (metadata) {
                try {
                  const value: unknown = JSON.parse(metadata)
                  if (
                    !value ||
                    typeof value !== 'object' ||
                    !('mode' in value) ||
                    typeof value.mode !== 'string'
                  )
                    throw new Error('Invalid VS Code clipboard metadata')
                  // Retain the provider's code-language behaviour for valid metadata.
                  return false
                } catch {
                  void this.paste({ text, plainText: true }).catch((error) =>
                    options.onError?.(error),
                  )
                  return true
                }
              }
              const files = [...data.files].filter((file) =>
                file.type.startsWith('image/'),
              )
              void this.run(
                {
                  text,
                  html,
                  plainText: this.options.literalText?.() ?? false,
                },
                files,
              ).catch((error) => options.onError?.(error))
              return true
            },
          },
        }),
    )
  }
  paste(input: ClipboardInput): Promise<void> {
    return this.run(input)
  }
  cancelPending(): void {
    this.active = undefined
  }
  destroy(): void {
    this.dead = true
    this.cancelPending()
  }
  private assertContext(context: DocumentContext, operation: Anchor): void {
    if (this.dead)
      throw new InkKitError('destroyed', 'The editor was destroyed.')
    const current = this.options.context()
    if (
      this.active !== operation ||
      current.documentId !== context.documentId ||
      current.generation !== context.generation
    )
      throw new InkKitError(
        'stale-document',
        'The document changed while images were importing.',
      )
  }
  private async run(input: ClipboardInput, files: File[] = []): Promise<void> {
    if (this.dead)
      throw new InkKitError('destroyed', 'The editor was destroyed.')
    if (this.pending)
      throw new InkKitError(
        'operation-pending',
        'An image paste is still pending.',
      )
    const context = { ...this.options.context() }
    const ctx = this.options.ctx()
    const view = ctx.get(editorViewCtx)
    if (!view.editable || this.options.editable?.() === false) return
    if (view.composing)
      throw new InkKitError(
        'composition',
        'Finish composing text before pasting.',
      )
    const operation: Anchor = {
      from: view.state.selection.from,
      to: view.state.selection.to,
    }
    this.active = operation
    try {
      const images = [...(input.images ?? [])]
      for (const file of files)
        images.push({
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type,
          filename: file.name,
        })
      this.assertContext(context, operation)
      const schema = view.state.schema
      let slice: Slice
      const plainText =
        input.plainText ||
        this.options.literalText?.() ||
        view.state.selection.$from.parent.type.spec.code
      if (plainText) {
        if (view.state.selection.$from.parent.type.spec.code) {
          const anchor = operation
          view.dispatch(
            view.state.tr.insertText(input.text, anchor.from, anchor.to),
          )
          return
        }
        const paragraphs = input.text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) =>
            schema.nodes.paragraph!.create(
              null,
              line ? schema.text(line) : undefined,
            ),
          )
        slice = new Slice(Fragment.fromArray(paragraphs), 1, 1)
      } else if (input.html) {
        // Template contents remain inert while unsupported source is replaced
        // and managed image references are imported.
        const template = document.createElement('template')
        template.innerHTML = input.html
        const container = template.content
        // Native HTML clipboards add encoding metadata. Obsidian's reading
        // view also copies its title and collapse controls with document HTML.
        for (const metadata of container.querySelectorAll('meta[charset]'))
          metadata.remove()
        for (const control of container.querySelectorAll(
          'div.mod-header.mod-ui,div.mod-footer.mod-ui',
        )) {
          if (
            control.querySelector(
              '.inline-title[contenteditable],.embedded-backlinks',
            )
          )
            control.remove()
        }
        for (const heading of container.querySelectorAll(
          'h1[data-heading],h2[data-heading],h3[data-heading],h4[data-heading],h5[data-heading],h6[data-heading]',
        )) {
          for (const control of heading.querySelectorAll(
            ':scope > span.heading-collapse-indicator.collapse-indicator.collapse-icon',
          )) {
            if (
              control.querySelector(':scope > svg.svg-icon.right-triangle') &&
              !control.textContent?.trim()
            )
              control.remove()
          }
        }
        for (const control of container.querySelectorAll(
          'pre > button.copy-code-button',
        )) {
          if (control.querySelector('svg.svg-icon')) control.remove()
        }
        const supported = new Set([
          'P',
          'H1',
          'H2',
          'H3',
          'H4',
          'H5',
          'H6',
          'STRONG',
          'B',
          'EM',
          'I',
          'S',
          'DEL',
          'STRIKE',
          'CODE',
          'PRE',
          'BLOCKQUOTE',
          'A',
          'BR',
          'HR',
          'UL',
          'OL',
          'LI',
          'TABLE',
          'THEAD',
          'TBODY',
          'TFOOT',
          'TR',
          'TH',
          'TD',
          'IMG',
          'SPAN',
          'DIV',
          'FONT',
          'SECTION',
          'ARTICLE',
          'MAIN',
          'HEADER',
          'FOOTER',
        ])
        for (const element of [...container.querySelectorAll('*')]) {
          if (!container.contains(element) || supported.has(element.tagName))
            continue
          const literal = document.createElement('pre')
          literal.className = 'literal-markdown'
          literal.textContent = element.outerHTML
          element.replaceWith(literal)
        }
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_COMMENT,
        )
        const comments: Comment[] = []
        while (walker.nextNode()) comments.push(walker.currentNode as Comment)
        for (const comment of comments) {
          const literal = document.createElement('pre')
          literal.className = 'literal-markdown'
          literal.textContent = `<!--${comment.data}-->`
          comment.replaceWith(literal)
        }
        for (const table of [...container.querySelectorAll('table')]) {
          if (table.parentElement?.closest('table')) continue
          const rows = [...table.querySelectorAll('tr')]
          const widths = rows.map(
            (row) => row.querySelectorAll(':scope > th,:scope > td').length,
          )
          const unsupported =
            !schema.nodes.table ||
            widths.length === 0 ||
            widths.some((width) => !width || width !== widths[0]) ||
            table.querySelector(
              'table,[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"]),td > p ~ p,th > p ~ p,td > div,th > div,td > ul,td > ol,td > pre,td > blockquote,th > ul,th > ol,th > pre,th > blockquote',
            )
          if (!unsupported && !table.querySelector('th')) {
            for (const cell of rows[0]?.querySelectorAll(':scope > td') ?? []) {
              const heading = document.createElement('th')
              for (const attribute of [...cell.attributes])
                heading.setAttribute(attribute.name, attribute.value)
              heading.append(...cell.childNodes)
              cell.replaceWith(heading)
            }
          }
          if (unsupported) {
            const literal = document.createElement('pre')
            literal.className = 'literal-markdown'
            literal.textContent = table.outerHTML
            table.replaceWith(literal)
          }
        }
        const imported = new Map<string, string>()
        const elements = [...container.querySelectorAll('img')]
        const uniqueSources = new Set(
          elements.map((element) => element.getAttribute('src') ?? ''),
        )
        // A host-supplied array explicitly associates unnamed bytes by unique
        // preview order. A browser FileList has no such association, except the
        // unambiguous single-file/single-source case.
        const positional = (
          files.length === 0 || (files.length === 1 && uniqueSources.size === 1)
            ? images
            : (input.images ?? [])
        ).filter((image) => !image.source)
        let index = 0
        for (const element of elements) {
          const source = element.getAttribute('src') ?? ''
          const alt = element.getAttribute('alt') ?? 'Image'
          try {
            let reference = imported.get(source)
            if (!reference) {
              const matched = images.find(
                (image) =>
                  (image as CapturedImage & { source?: string }).source ===
                  source,
              )
              const captured =
                matched ?? dataImage(source) ?? positional[index++]
              if (!captured || !this.options.adapter)
                throw new Error('The pasted image is unavailable.')
              reference = (
                await this.options.adapter.importImage(captured, { ...context })
              ).reference
              this.assertContext(context, operation)
              imported.set(source, reference)
            }
            element.setAttribute('src', reference)
            element.removeAttribute('srcset')
          } catch (error) {
            if (error instanceof InkKitError) throw error
            element.replaceWith(
              document.createTextNode(`[${alt}: image unavailable]`),
            )
            this.options.onError?.(
              new InkKitError(
                'image-unavailable',
                error instanceof Error
                  ? error.message
                  : 'The pasted image is unavailable.',
              ),
            )
          }
        }
        slice = ProseParser.fromSchema(schema).parseSlice(container, {
          preserveWhitespace: true,
        })
      } else if (images.length) {
        const nodes = []
        if (input.text)
          nodes.push(
            schema.nodes.paragraph!.create(null, schema.text(input.text)),
          )
        for (const image of images) {
          try {
            if (!this.options.adapter)
              throw new InkKitError(
                'image-unavailable',
                'No image adapter is configured.',
              )
            const imported = await this.options.adapter.importImage(image, {
              ...context,
            })
            this.assertContext(context, operation)
            const imageNode = schema.nodes.image?.create({
              src: imported.reference,
              alt: image.filename ?? 'Image',
            })
            if (!imageNode)
              throw new InkKitError(
                'image-unavailable',
                'Images are disabled for this document.',
              )
            nodes.push(schema.nodes.paragraph!.create(null, imageNode))
          } catch (error) {
            if (
              error instanceof InkKitError &&
              error.code !== 'image-unavailable'
            )
              throw error
            nodes.push(
              schema.nodes.paragraph!.create(
                null,
                schema.text(
                  `[${image.filename ?? 'Image'}: image unavailable]`,
                ),
              ),
            )
            this.options.onError?.(
              new InkKitError(
                'image-unavailable',
                error instanceof Error
                  ? error.message
                  : 'The pasted image is unavailable.',
              ),
            )
          }
        }
        slice = new Slice(Fragment.fromArray(nodes), 1, 1)
      } else {
        const selection = view.state.selection
        const text = input.text.trim()
        if (
          !selection.empty &&
          /^https?:\/\/\S+$/.test(text) &&
          schema.marks.link
        ) {
          const anchor = operation
          const mark = schema.marks.link.create({ href: text, title: '' })
          view.dispatch(
            view.state.tr
              .addMark(anchor.from, anchor.to, mark)
              .removeStoredMark(mark),
          )
          return
        }
        const doc = ctx.get(parserCtx)(input.text)
        slice = new Slice(doc.content, 0, 0)
      }
      this.assertContext(context, operation)
      if (!view.editable || this.options.editable?.() === false) return
      const anchor = operation
      const insertion = view.state.doc.resolve(anchor.from)
      // An isolated block such as a table cannot fit inside an empty paragraph.
      // Replace that empty block rather than retaining a spurious spacer.
      if (
        anchor.from === anchor.to &&
        insertion.parent.type.name === 'paragraph' &&
        insertion.parent.content.size === 0 &&
        slice.content.firstChild?.isBlock &&
        slice.content.firstChild.type.spec.isolating
      ) {
        view.dispatch(
          view.state.tr
            .replaceRange(
              insertion.before(),
              insertion.after(),
              new Slice(slice.content, 0, 0),
            )
            .scrollIntoView(),
        )
      } else
        view.dispatch(
          view.state.tr
            .replaceRange(anchor.from, anchor.to, slice)
            .scrollIntoView(),
        )
    } finally {
      if (this.active === operation) this.active = undefined
    }
  }
}
function dataImage(source: string): CapturedImage | undefined {
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp|avif|bmp|tiff));base64,([A-Za-z0-9+/=\s]+)$/.exec(
      source,
    )
  if (!match) return undefined
  const binary = atob(match[2]!)
  return {
    mimeType: match[1]!,
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  }
}
