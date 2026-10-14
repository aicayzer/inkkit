import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  DOMParser as ProseParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { pasteSpreadsheet } from './spreadsheet'
import { importableSlice } from './html-import'
import { isImage } from './image-blocks'
import {
  collapseClipboardWhitespace,
  isBlockElement,
  isRewrittenElement,
  isRichElement,
  normalizeClipboardHTML,
} from './paste-html'
import {
  avoidReferenceCollisions,
  markdownFromHTML,
} from './reference-clipboard'
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
  onPendingChanged?: () => void
  editable?: () => boolean
  literalText?: () => boolean
}
interface Anchor {
  from: number
  to: number
}
interface MappedAnchor extends Anchor {
  operation: Anchor
}

export class PasteController {
  private active?: Anchor
  private readonly key = new PluginKey<MappedAnchor | null>('inkkitPaste')
  private dead = false
  private claimed = false
  get pending(): boolean {
    return this.active != null
  }
  readonly plugin
  constructor(private readonly options: PasteControllerOptions) {
    this.plugin = $prose(
      () =>
        new Plugin<MappedAnchor | null>({
          key: this.key,
          state: {
            init: () => null,
            apply: (transaction, previous) => {
              if (!this.active) return null
              const anchor =
                previous?.operation === this.active ? previous : this.active
              return {
                operation: this.active,
                from: transaction.mapping.map(anchor.from, 1),
                to: transaction.mapping.map(
                  anchor.to,
                  anchor.from === anchor.to ? 1 : -1,
                ),
              }
            },
          },
          props: {
            handleDOMEvents: {
              paste: (view, event) => {
                // ProseMirror parses the clipboard before asking handlePaste,
                // and this controller then imports it again itself.
                this.claimed = claimsPaste(view, event) !== false
                queueMicrotask(() => {
                  this.claimed = false
                })
                return false
              },
              drop: (view, event) => {
                this.claimed = dropPoint(view, event) != null
                queueMicrotask(() => {
                  this.claimed = false
                })
                return false
              },
            },
            // A drop from outside the editor imports as a paste at the drop
            // point. Moving content within the editor stays ProseMirror's.
            handleDrop: (view, event) => {
              this.claimed = false
              const at = dropPoint(view, event)
              if (at == null) return false
              const data = event.dataTransfer!
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.near(view.state.doc.resolve(at)),
                ),
              )
              view.focus()
              void this.run(
                {
                  text: data.getData('text/plain'),
                  html: data.getData('text/html'),
                  plainText: this.options.literalText?.() ?? false,
                },
                [...data.files].filter((file) =>
                  file.type.startsWith('image/'),
                ),
              ).catch((error) => options.onError?.(error))
              return true
            },
            // Drops and pastes that ProseMirror inserts itself.
            transformPasted: (slice, view, plain) =>
              this.claimed || plain || view.dragging
                ? slice
                : importableSlice(this.options.ctx(), slice),
            handlePaste: (view, event) => {
              this.claimed = false
              const claim = claimsPaste(view, event)
              if (claim === false) return false
              const data = event.clipboardData!
              const text = data.getData('text/plain')
              const html = data.getData('text/html')
              if (claim === 'plain') {
                void this.paste({ text, plainText: true }).catch((error) =>
                  options.onError?.(error),
                )
                return true
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
  private anchor(operation: Anchor): Anchor {
    const mapped = this.key.getState(
      this.options.ctx().get(editorViewCtx).state,
    )
    return mapped?.operation === operation ? mapped : operation
  }
  cancelPending(): void {
    this.active = undefined
    this.options.onPendingChanged?.()
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
    this.options.onPendingChanged?.()
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
      if (
        !plainText &&
        input.markdown == null &&
        pasteSpreadsheet(ctx, { ...input, images })
      )
        return
      const markdown = plainText
        ? undefined
        : (input.markdown ??
          (input.html ? markdownFromHTML(input.html) : undefined))
      if (plainText) {
        if (view.state.selection.$from.parent.type.spec.code) {
          const anchor = this.anchor(operation)
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
        // Preserve whole unsupported tables before rewriting their descendants,
        // so comments retain their source and ordinary-copy privacy.
        for (const table of [...container.querySelectorAll('table')]) {
          if (table.parentElement?.closest('table')) continue
          // Inside an element that stays literal source, the whole element is
          // kept as written, so its tables are not rewritten or judged here.
          if (!insideRewrittenContent(table)) continue
          if (schema.nodes.table) {
            // Judge the table as it will import, so wrappers such as `u` or
            // `label` in a cell do not make it literal. A table that is still
            // unsupported keeps its original source. An input in a cell would
            // be dropped with its state, so that table stays source too.
            const trial = table.cloneNode(true) as HTMLTableElement
            const holder = table.ownerDocument.createDocumentFragment()
            holder.append(trial)
            normalizeClipboardHTML(holder)
            if (
              !table.querySelector('td input,th input') &&
              !unsupportedClipboardTable(trial)
            ) {
              table.replaceWith(trial)
              continue
            }
          }
          const preserved = ctx.get(parserCtx)(table.outerHTML)
          table.replaceWith(
            DOMSerializer.fromSchema(schema).serializeFragment(
              preserved.content,
            ),
          )
        }
        for (const warning of container.querySelectorAll(
          '[data-inkkit-diagram-error]',
        ))
          warning.remove()
        for (const diagram of container.querySelectorAll(
          'figure[data-inkkit-mermaid]',
        )) {
          const source = diagram.getAttribute('data-inkkit-mermaid') ?? ''
          if (source.length > 30000) continue
          const pre = document.createElement('pre')
          pre.dataset.language = 'mermaid'
          const fence = diagram.getAttribute('data-inkkit-fence')
          if (fence) pre.setAttribute('data-inkkit-fence', fence)
          const code = document.createElement('code')
          code.className = 'language-mermaid'
          code.textContent = source
          pre.append(code)
          diagram.replaceWith(pre)
        }
        if (markdown == null) {
          // Native destinations can keep node metadata after dropping the
          // Markdown wrapper and its definitions. Import their visible HTML.
          for (const element of container.querySelectorAll(
            '[data-inkkit-reference],[data-inkkit-footnote-reference],[data-inkkit-footnote-definition]',
          )) {
            for (const name of [
              'data-inkkit-reference',
              'data-inkkit-footnote-reference',
              'data-inkkit-footnote-definition',
              'data-inkkit-label',
              'data-inkkit-reference-type',
              'data-inkkit-reference-content',
            ])
              element.removeAttribute(name)
          }
        }
        // Native HTML clipboards add encoding metadata and fragment markers.
        normalizeClipboardHTML(container)
        // Obsidian's reading view also copies its title and collapse controls
        // with document HTML.
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
        for (const element of [...container.querySelectorAll('*')]) {
          if (!container.contains(element) || isRichElement(element)) continue
          const literal = document.createElement('pre')
          literal.className = 'literal-markdown'
          literal.textContent = element.outerHTML
          element.replaceWith(literal)
        }
        for (const table of [...container.querySelectorAll('table')]) {
          if (table.parentElement?.closest('table')) continue
          const rows = [...table.querySelectorAll('tr')]
          const unsupported =
            !schema.nodes.table || unsupportedClipboardTable(table)
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
        collapseClipboardWhitespace(container)
        // An authored comment is read in Markdown as an InkKit comment, so it
        // imports as one, after whitespace collapse has passed it by.
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_COMMENT,
        )
        const comments: Comment[] = []
        while (walker.nextNode()) comments.push(walker.currentNode as Comment)
        for (const comment of comments) {
          const element = document.createElement(
            inlineComment(comment) ? 'span' : 'div',
          )
          element.setAttribute('data-inkkit-comment', 'html')
          element.textContent = comment.data
          comment.replaceWith(element)
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
        if (markdown != null) {
          const parsed = ctx.get(parserCtx)(markdown)
          let imageIndex = 0
          const hydrate = (node: ProseNode): ProseNode => {
            if (isImage(node)) {
              const slot = /^inkkit-clipboard-image:(\d+)$/.exec(
                String(node.attrs.src),
              )
              const position = slot ? Number(slot[1]) : imageIndex++
              const element = elements.some((element) =>
                element.hasAttribute('data-inkkit-image-slot'),
              )
                ? elements.find(
                    (element) =>
                      Number(
                        element.getAttribute(
                          'data-inkkit-authored-image-slot',
                        ) ?? element.getAttribute('data-inkkit-image-slot'),
                      ) === position,
                  )
                : elements[position]
              if (!element || !container.contains(element)) {
                const text = schema.text(
                  `[${node.attrs.alt || 'Image'}: image unavailable]`,
                )
                return node.isBlock
                  ? schema.nodes.paragraph!.create(null, text)
                  : text
              }
              return node.type.create(
                { ...node.attrs, src: element.getAttribute('src') },
                null,
                node.marks,
              )
            }
            if (node.isText) return node
            const children: ProseNode[] = []
            node.forEach((child) => children.push(hydrate(child)))
            return node.copy(Fragment.fromArray(children))
          }
          slice = new Slice(hydrate(parsed).content, 0, 0)
        } else
          slice = importableSlice(
            ctx,
            ProseParser.fromSchema(schema).parseSlice(container, {
              preserveWhitespace: true,
            }),
          )
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
          markdown == null &&
          !selection.empty &&
          /^https?:\/\/\S+$/.test(text) &&
          schema.marks.link
        ) {
          const anchor = this.anchor(operation)
          const mark = schema.marks.link.create({ href: text })
          view.dispatch(
            view.state.tr
              .addMark(anchor.from, anchor.to, mark)
              .removeStoredMark(mark),
          )
          return
        }
        const doc = ctx.get(parserCtx)(markdown ?? input.text)
        slice = new Slice(doc.content, 0, 0)
      }
      this.assertContext(context, operation)
      if (!view.editable || this.options.editable?.() === false) return
      const anchor = this.anchor(operation)
      if (!plainText) {
        const valid = slice.content.firstChild?.isInline
          ? Fragment.from(schema.nodes.paragraph!.create(null, slice.content))
          : slice.content
        const remapped = avoidReferenceCollisions(
          schema.topNodeType.create(null, valid),
          view.state.doc,
        )
        slice = new Slice(
          slice.content.firstChild?.isInline
            ? remapped.firstChild!.content
            : remapped.content,
          slice.openStart,
          slice.openEnd,
        )
      }
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
      if (this.active === operation) {
        this.active = undefined
        this.options.onPendingChanged?.()
      }
    }
  }
}
/**
 * Whether `handlePaste` takes the paste, and as what. Valid VS Code metadata
 * keeps the provider's code-language behaviour; invalid metadata pastes plain
 * text.
 */
function claimsPaste(
  view: EditorView,
  event: ClipboardEvent,
): false | 'plain' | 'import' {
  const data = event.clipboardData
  if (!data || !view.editable) return false
  if (view.state.selection.$from.parent.type.spec.code) return false
  const metadata = data.getData('vscode-editor-data')
  if (!metadata) return 'import'
  try {
    const value: unknown = JSON.parse(metadata)
    return value &&
      typeof value === 'object' &&
      'mode' in value &&
      typeof value.mode === 'string'
      ? false
      : 'plain'
  } catch {
    return 'plain'
  }
}
/**
 * Where a drop of HTML from outside the editor lands, when this controller
 * imports it: not a move within the editor, and not into code, which takes
 * the dropped text as it is.
 */
function dropPoint(view: EditorView, event: DragEvent): number | undefined {
  const data = event.dataTransfer
  if (!data || !view.editable || view.dragging) return undefined
  if (!data.getData('text/html')) return undefined
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!found) return undefined
  return view.state.doc.resolve(found.pos).parent.type.spec.code
    ? undefined
    : found.pos
}
// Inside text or an element that holds text, a comment is part of a line.
function inlineComment(comment: Comment): boolean {
  const parent = comment.parentElement
  if (parent && /^(?:P|H[1-6]|TD|TH|LI|DT|DD)$/.test(parent.tagName))
    return true
  if (parent && isRichElement(parent) && !isBlockElement(parent)) return true
  for (const sibling of comment.parentNode?.childNodes ?? [])
    if (
      (sibling.nodeType === Node.TEXT_NODE && sibling.textContent?.trim()) ||
      (sibling.nodeType === Node.ELEMENT_NODE &&
        isRichElement(sibling as Element) &&
        !isBlockElement(sibling as Element))
    )
      return true
  return false
}
function insideRewrittenContent(element: Element): boolean {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  )
    if (!isRewrittenElement(parent)) return false
  return true
}
function unsupportedClipboardTable(table: HTMLTableElement): boolean {
  const rows = [...table.querySelectorAll('tr')]
  const widths = rows.map(
    (row) => row.querySelectorAll(':scope > th,:scope > td').length,
  )
  const supported = new Set([
    'THEAD',
    'TBODY',
    'TFOOT',
    'TR',
    'TH',
    'TD',
    'P',
    'STRONG',
    'B',
    'EM',
    'I',
    'S',
    'DEL',
    'STRIKE',
    'CODE',
    'A',
    'MARK',
    'SPAN',
    'SUP',
    'FONT',
    'IMG',
  ])
  return (
    widths.length === 0 ||
    widths.some((width) => !width || width !== widths[0]) ||
    !!document.createTreeWalker(table, NodeFilter.SHOW_COMMENT).nextNode() ||
    [...table.querySelectorAll('*')].some(
      (element) => !supported.has(element.tagName),
    ) ||
    [...table.querySelectorAll('p')].some((paragraph) => {
      const cell = paragraph.parentElement
      return (
        !cell ||
        !['TH', 'TD'].includes(cell.tagName) ||
        cell.children.length !== 1 ||
        [...cell.childNodes].some(
          (node) => node !== paragraph && !!node.textContent?.trim(),
        )
      )
    }) ||
    !!table.querySelector(
      '[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])',
    )
  )
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
