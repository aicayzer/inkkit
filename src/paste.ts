import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  DOMParser as ProseParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Node as ProseNode,
  type ResolvedPos,
  type Schema,
} from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { pasteSpreadsheet } from './spreadsheet'
import { clipboardContent } from './clipboard'
import { semanticSignature } from './preserve'
import { importableSlice, topLevel } from './html-import'
import {
  blockDropRange,
  caretAfter,
  caretAfterInsertion,
} from './drop-placement'
import { isImage } from './image-blocks'
import { hiddenCommentExit } from './hidden-comments'
import {
  collapseClipboardWhitespace,
  isRewrittenElement,
  displaysNone,
  isRichElement,
  normalizeClipboardHTML,
} from './paste-html'
import {
  avoidReferenceCollisions,
  markdownFromHTML,
} from './reference-clipboard'
import { normaliseLabel } from './references'
import { commentProvenance, isComment, literalCommentSpans } from './comments'
import { showsWikiTarget } from './linked-syntax'
import { showsFenceInfo } from './code-fences'
import { coded } from './errors'
import {
  InkKitError,
  type ClipboardInput,
  type CapturedImage,
  type DocumentContext,
  type ImageAdapter,
} from './types'

/** A paste the controller runs. `plainText` inserts the text literally, as a paste into code or
 *  the source editor does; hosts reach that through `pasteAsPlainText`, not through this field. */
export interface PasteInput extends ClipboardInput {
  plainText?: boolean
}
export interface PasteControllerOptions {
  ctx: () => Ctx
  context: () => DocumentContext
  adapter?: ImageAdapter
  onError?: (error: unknown) => void
  /** Runs the import's edit as one call, which throws if the edit is refused. */
  commit?: <T>(apply: () => T) => T
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
              // A drop of HTML from outside the editor imports as a paste of
              // whole blocks, placed as dropped images are. ProseMirror keeps
              // moves within the editor and drops of plain text.
              drop: (view, event) => {
                const data = event.dataTransfer
                if (
                  !data?.getData('text/html') ||
                  !view.editable ||
                  view.dragging
                )
                  return false
                event.preventDefault()
                const target = blockDropRange(
                  view,
                  event.clientX,
                  event.clientY,
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
                  target,
                ).catch((error) => options.onError?.(error))
                return true
              },
            },
            // Pastes and drops that ProseMirror inserts itself.
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
  paste(input: PasteInput): Promise<void> {
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
  private commit<T>(apply: () => T): T {
    return this.options.commit ? this.options.commit(apply) : apply()
  }
  private dispatch(view: EditorView, tr: Transaction): void {
    this.commit(() => view.dispatch(tr))
  }
  /**
   * Inserts dropped content as whole blocks, so none joins the block beside
   * it, and puts the caret after them.
   */
  private insertBlocks(view: EditorView, slice: Slice, range: Anchor): void {
    const blocks = Fragment.fromArray(
      topLevel(view.state.schema, slice.content),
    )
    const tr = view.state.tr.replaceWith(range.from, range.to, blocks)
    const end = tr.mapping.map(range.to)
    this.dispatch(
      view,
      tr.setSelection(caretAfter(tr.doc, end)).scrollIntoView(),
    )
  }
  /** Imports the input at the selection, or in place of `target`. */
  private async run(
    input: PasteInput,
    files: File[] = [],
    target?: Anchor,
  ): Promise<void> {
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
    // Nothing goes inside a hidden comment; it goes after the comment, as a drop would.
    const exit = target ? undefined : hiddenCommentExit(view.state)
    if (
      exit !== undefined &&
      !view.state.doc.resolve(exit).parent.inlineContent
    )
      target = { from: exit, to: exit }
    const operation: Anchor = target
      ? { ...target }
      : { from: view.state.selection.from, to: view.state.selection.to }
    const inCode = () =>
      view.state.doc.resolve(this.anchor(operation).from).parent.type.spec.code
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
      // Markdown parsed into the slice, whose edge spaces the parser drops.
      let source: string | undefined
      const plainText =
        input.plainText || this.options.literalText?.() || inCode()
      if (
        !plainText &&
        input.markdown == null &&
        this.commit(() =>
          pasteSpreadsheet(
            ctx,
            { ...input, images },
            target && dropRange(view.state.doc, this.anchor(operation)),
          ),
        )
      )
        return
      const markdown = plainText ? undefined : input.markdown
      if (plainText) {
        if (inCode()) {
          const anchor = this.anchor(operation)
          this.dispatch(
            view,
            caretAfterInsertion(
              view.state.tr.insertText(input.text, anchor.from, anchor.to),
            ).scrollIntoView(),
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
        const container = visibleContent(ctx, input.html)
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
              coded(
                error,
                'image-unavailable',
                error instanceof Error
                  ? error.message
                  : 'The pasted image is unavailable.',
              ),
            )
          }
        }
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
                      element.getAttribute('data-inkkit-authored-image-slot') ??
                        element.getAttribute('data-inkkit-image-slot'),
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
        if (markdown != null) {
          slice = joinable(hydrate(ctx.get(parserCtx)(markdown)).content)
          source = markdown
        } else {
          const parsed = ProseParser.fromSchema(schema).parseSlice(container, {
            preserveWhitespace: true,
          })
          // InkKit's own copies carry the Markdown they were copied from,
          // which keeps reference links, definitions and footnotes. It is
          // used only where it holds what the HTML shows.
          const copied = markdownFromHTML(input.html)
          const described =
            copied == null
              ? undefined
              : copiedContent(ctx, hydrate(ctx.get(parserCtx)(copied)), parsed)
          if (described) {
            slice = joinable(described)
            source = copied
          } else {
            slice = importableSlice(ctx, parsed)
            // HTML that shows nothing importable, such as a copied reference
            // definition, pastes the text that came with it.
            if (!slice.content.size && input.text.trim())
              slice = plainSlice(schema, input.text)
          }
        }
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
              coded(
                error,
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
          // The caret goes after the link, so typing never replaces it.
          const tr = view.state.tr.addMark(anchor.from, anchor.to, mark)
          this.dispatch(
            view,
            tr
              .setSelection(TextSelection.create(tr.doc, anchor.to))
              .removeStoredMark(mark)
              .scrollIntoView(),
          )
          return
        }
        source = markdown ?? input.text
        slice = joinable(ctx.get(parserCtx)(source).content)
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
      if (target) {
        this.insertBlocks(view, slice, dropRange(view.state.doc, anchor))
        return
      }
      const insertion = view.state.doc.resolve(anchor.from)
      // Blocks pasted into an empty top-level paragraph take its place whole,
      // as a drop does; joining the first of them into it could lose a
      // wrapper whose only content was empty.
      if (
        anchor.from === anchor.to &&
        insertion.depth === 1 &&
        insertion.parent.type.name === 'paragraph' &&
        insertion.parent.content.size === 0 &&
        slice.content.firstChild?.isBlock
      ) {
        this.insertBlocks(view, slice, {
          from: insertion.before(),
          to: insertion.after(),
        })
        return
      }
      // An isolated block such as a table cannot fit inside an empty paragraph.
      // Replace that empty block rather than retaining a spurious spacer.
      if (
        anchor.from === anchor.to &&
        insertion.parent.type.name === 'paragraph' &&
        insertion.parent.content.size === 0 &&
        slice.content.firstChild?.isBlock &&
        slice.content.firstChild.type.spec.isolating
      ) {
        this.dispatch(
          view,
          caretAfterInsertion(
            view.state.tr.replaceRange(
              insertion.before(),
              insertion.after(),
              new Slice(slice.content, 0, 0),
            ),
          ).scrollIntoView(),
        )
      } else
        this.dispatch(
          view,
          caretAfterInsertion(
            view.state.tr.replaceRange(
              anchor.from,
              anchor.to,
              source == null
                ? slice
                : withEdgeSpaces(
                    slice,
                    source,
                    view.state.doc.resolve(anchor.from),
                    view.state.doc.resolve(anchor.to),
                  ),
            ),
          ).scrollIntoView(),
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
 * The content of Markdown copied with its HTML, as the HTML importer accepts
 * it, when InkKit's clipboard HTML for it reads as the HTML that was pasted:
 * the same text, formatting, addresses, images and structure. Copied HTML
 * does not show comments, reference labels, definitions or the target of a
 * wiki link written with other text, so the content is refused where it
 * holds comments, and keeps only definitions and wiki links that the HTML
 * shows through their links.
 */
function copiedContent(
  ctx: Ctx,
  copied: ProseNode,
  visible: Slice,
): Fragment | undefined {
  const schema = copied.type.schema
  const imported = importableSlice(
    ctx,
    new Slice(withShownLinks(copied).content, 0, 0),
  ).content
  if (holdsHidden(imported)) return undefined
  const accepted = withShownDefinitions(imported)
  if (!accepted.childCount) return undefined
  const shown = visibleContent(ctx, clipboardContent(accepted, schema).html)
  // Copied HTML holds images without their sources, in document order.
  const sources: string[] = []
  accepted.descendants((node) => {
    if (isImage(node)) sources.push(String(node.attrs.src))
  })
  for (const [index, image] of shown.querySelectorAll('img').entries())
    image.setAttribute('src', sources[index] ?? '')
  const reread = ProseParser.fromSchema(schema).parseSlice(shown, {
    preserveWhitespace: true,
  })
  return shownAs(schema, reread.content) === shownAs(schema, visible.content)
    ? accepted
    : undefined
}
/**
 * The document as the HTML can show it: a wiki link whose text is not its
 * target becomes that text, a named file embed becomes the image it shows,
 * and a folded callout starts expanded.
 */
function withShownLinks(node: ProseNode): ProseNode {
  if (node.type.name === 'inkkit_wiki_link')
    return showsWikiTarget(node.attrs)
      ? node
      : node.type.schema.text(String(node.attrs.label || 'Link'))
  if (isImage(node))
    return node.attrs.inkkitFileRaw == null
      ? node
      : node.type.create(
          {
            ...node.attrs,
            inkkitFileRaw: null,
            inkkitFileTarget: null,
            inkkitFileFragment: null,
            inkkitFileWidth: null,
            inkkitFileInTable: false,
          },
          null,
          node.marks,
        )
  if (node.isText || node.isLeaf) return node
  const children: ProseNode[] = []
  node.forEach((child) => children.push(withShownLinks(child)))
  const content = Fragment.fromArray(children)
  return node.type.name === 'inkkit_callout' && node.attrs.fold === '-'
    ? node.type.create({ ...node.attrs, fold: '+' }, content, node.marks)
    : node.copy(content)
}
/**
 * Whether content holds something its HTML cannot show: a comment, comment
 * syntax in a label, or a code fence whose info string says more than its
 * language.
 */
function holdsHidden(content: Fragment): boolean {
  let found = false
  const labelled = (label: unknown) =>
    typeof label === 'string' && literalCommentSpans(label).length > 0
  content.descendants((node) => {
    if (
      isComment(node) ||
      (node.type.name === 'code_block' &&
        !showsFenceInfo(node.attrs.authoredFence, node.attrs.language)) ||
      (/^(?:reference|footnote)_/.test(node.type.name) &&
        labelled(node.attrs.label)) ||
      node.marks.some(
        (mark) =>
          mark.type.name === 'link' &&
          (labelled(mark.attrs.label) ||
            commentProvenance(mark.attrs.referenceContent)),
      )
    )
      found = true
    return !found
  })
  return found
}
/**
 * The content with only the first definition of each label that a link in it
 * uses with the same address and title, so every definition kept is one the
 * pasted HTML shows through that link.
 */
function withShownDefinitions(content: Fragment): Fragment {
  const shown = new Set<string>()
  const key = (identifier: unknown, url: unknown, title: unknown) =>
    JSON.stringify([
      normaliseLabel(String(identifier)),
      String(url),
      title || null,
    ])
  content.descendants((node) => {
    for (const mark of node.marks)
      if (mark.type.name === 'link' && mark.attrs.identifier)
        shown.add(key(mark.attrs.identifier, mark.attrs.href, mark.attrs.title))
  })
  const kept = new Set<string>()
  const filter = (fragment: Fragment): Fragment => {
    const children: ProseNode[] = []
    fragment.forEach((child) => {
      if (child.type.name === 'reference_definition') {
        const identifier = normaliseLabel(String(child.attrs.identifier))
        if (
          kept.has(identifier) ||
          !shown.has(key(identifier, child.attrs.url, child.attrs.title))
        )
          return
        kept.add(identifier)
        children.push(child)
      } else
        children.push(
          child.isText || child.isLeaf
            ? child
            : child.copy(filter(child.content)),
        )
    })
    return Fragment.fromArray(children)
  }
  return filter(content)
}
/** What imported content shows, whether it is inline or blocks. */
function shownAs(schema: Schema, content: Fragment): string {
  return semanticSignature(
    schema.topNodeType.create(null, topLevel(schema, content)),
  )
}
/**
 * Pasted HTML as the importer reads it: inert, with unsupported tables and
 * elements kept as literal source, clipboard and app wrappers removed,
 * whitespace collapsed and comments made InkKit comments. Images keep their
 * sources for the caller to import.
 */
function visibleContent(ctx: Ctx, html: string): DocumentFragment {
  const schema = ctx.get(editorViewCtx).state.schema
  // Template contents remain inert while unsupported source is replaced.
  const template = document.createElement('template')
  template.innerHTML = html
  const container = template.content
  // A page shows neither its HTML comments, nor `template`, `noscript` and
  // `noembed` contents, nor elements hidden by attribute or inline style, so
  // none of them reaches the note, even inside source that stays literal.
  for (const hidden of container.querySelectorAll(
    'template,noscript,noembed,[hidden],[style]',
  ))
    if (
      hidden.matches('template,noscript,noembed,[hidden]') ||
      displaysNone(hidden)
    )
      hidden.remove()
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const comment of comments) comment.parentNode?.removeChild(comment)
  // Preserve whole unsupported tables before rewriting their descendants.
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
      DOMSerializer.fromSchema(schema).serializeFragment(preserved.content),
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
    // The source is taken only from a figure holding just the diagram image
    // that shows it as its text alternative; otherwise the figure imports as
    // what it shows.
    const image = diagram.querySelector(':scope > img')
    if (
      source.length > 30000 ||
      diagram.childElementCount !== 1 ||
      diagram.textContent?.trim() ||
      image?.getAttribute('alt') !== `Mermaid diagram: ${source}`
    )
      continue
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
  // Reference and footnote metadata on elements needs definitions that HTML
  // does not carry, and native destinations keep it after dropping them.
  // The visible HTML imports without it.
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
    const unsupported = !schema.nodes.table || unsupportedClipboardTable(table)
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
  return container
}
/** Literal text as one paragraph per line, open to join the caret's text. */
function plainSlice(schema: Schema, text: string): Slice {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      schema.nodes.paragraph!.create(
        null,
        line ? schema.text(line) : undefined,
      ),
    )
  return new Slice(Fragment.fromArray(paragraphs), 1, 1)
}
/**
 * Parsed Markdown as a slice whose paragraphs at either end join the text at
 * the caret, as typed text does. Any other block at an end stays whole, so a
 * heading, list or code block still splits the paragraph it lands in.
 */
function joinable(content: Fragment): Slice {
  const open = (node: ProseNode | null) =>
    node?.type.name === 'paragraph' ? 1 : 0
  return new Slice(content, open(content.firstChild), open(content.lastChild))
}
/**
 * Markdown drops the spaces at the edges of a paragraph. Where a pasted
 * paragraph joins text beside the caret, the spaces written next to it stay.
 * Spaces beside a line break, or on a pasted line with no text, would not
 * read back, so they are dropped.
 */
function withEdgeSpaces(
  slice: Slice,
  source: string,
  $from: ResolvedPos,
  $to: ResolvedPos,
): Slice {
  const beside = (node: ProseNode | null | undefined) =>
    node != null && node.type.name !== 'hardbreak'
  const lead =
    slice.openStart && $from.parent.isTextblock && beside($from.nodeBefore)
      ? (/^[ \t]+(?=\S)/.exec(source)?.[0] ?? '')
      : ''
  const trail =
    slice.openEnd && $to.parent.isTextblock && beside($to.nodeAfter)
      ? (/(?<=\S)[ \t]+$/.exec(source.slice(lead.length))?.[0] ?? '')
      : ''
  if (!lead && !trail) return slice
  const schema = $from.doc.type.schema
  let content = slice.content
  if (lead) {
    const first = content.firstChild!
    content = content.replaceChild(
      0,
      first.copy(Fragment.from(schema.text(lead)).append(first.content)),
    )
  }
  if (trail) {
    const last = content.lastChild!
    content = content.replaceChild(
      content.childCount - 1,
      last.copy(last.content.append(Fragment.from(schema.text(trail)))),
    )
  }
  return new Slice(content, slice.openStart, slice.openEnd)
}
/**
 * The range a drop replaces, mapped to the current document. It replaces an
 * empty paragraph only while that is still empty, so text typed there while
 * images import is kept, and the drop then follows it.
 */
function dropRange(doc: ProseNode, range: Anchor): Anchor {
  const node = doc.nodeAt(range.from)
  return range.from < range.to &&
    node?.type.name === 'paragraph' &&
    node.content.size === 0 &&
    range.from + node.nodeSize === range.to
    ? range
    : { from: range.to, to: range.to }
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
  if (hiddenCommentExit(view.state) !== undefined) return 'import'
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
