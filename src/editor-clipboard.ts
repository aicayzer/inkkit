import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment } from '@milkdown/kit/prose/model'
import { clipboardContent, clipboardText } from './clipboard'
import {
  commentSelectionContent,
  commentProvenance,
  literalCommentSpans,
  isComment,
} from './comments'
import { sourceSelection } from './source'
import {
  selectionContent,
  selectionMarkdown,
  referenceMetadata,
  withReferenceMetadata,
} from './reference-clipboard'
import { isImage } from './image-blocks'
import { isMermaid } from './mermaid'
import { coded } from './errors'
import {
  InkKitError,
  type ClipboardOutput,
  type DocumentSnapshot,
} from './types'
import type { SessionCapture } from './session'
import type { FormatHandler } from './formats'

interface ClipboardRuntime {
  ctx(): Ctx
  handler(): FormatHandler
  sourceMode(): boolean
  element(): HTMLTextAreaElement
  replaceSelection(text: string): void
  writable(): boolean
  snapshot(): DocumentSnapshot
  prepareSelection(): Promise<ClipboardOutput>
  capture(): SessionCapture
  assertCut(captured: SessionCapture): void
  canWrite(): boolean
  write(content: ClipboardOutput): void | Promise<void>
  linkSchemes(): ReadonlySet<string>
  report(error: unknown): void
}

/** Refuses a cut whose copy lost an image or a diagram, so the person keeps what the clipboard
 *  could not hold. */
function refuseUnportableCut(content: ClipboardOutput): void {
  if (content.images.some((image) => image.error))
    throw new InkKitError(
      'image-unavailable',
      'The selected content could not be cut, because an image in it cannot be copied',
    )
  if (content.diagrams.some((diagram) => diagram.error))
    throw new InkKitError(
      'diagram-unavailable',
      'The selected content could not be cut, because a diagram in it cannot be copied',
    )
}

async function writeClipboard(
  write: (content: ClipboardOutput) => void | Promise<void>,
  content: ClipboardOutput,
): Promise<void> {
  try {
    await write(content)
  } catch (error) {
    throw coded(
      error,
      'clipboard-unavailable',
      'The host could not write the clipboard',
    )
  }
}

function noClipboardHandler(): InkKitError {
  return new InkKitError(
    'clipboard-unavailable',
    'Copying images or diagrams needs the clipboard event',
  )
}

/** DOM copy/cut ownership and private source provenance for this editor. */
export class EditorClipboard {
  private root?: HTMLElement
  constructor(private readonly runtime: ClipboardRuntime) {}

  install(root: HTMLElement): void {
    this.root = root
    root.addEventListener('copy', this.copyHandler, true)
    root.addEventListener('cut', this.copyHandler, true)
  }

  clear(): void {
    this.localCopies.clear()
  }

  destroy(): void {
    this.clear()
    this.root?.removeEventListener('copy', this.copyHandler, true)
    this.root?.removeEventListener('cut', this.copyHandler, true)
    this.root = undefined
  }

  private deferredCopy(
    captured: SessionCapture,
    cut: boolean,
    remove: () => void,
  ): void {
    void this.runtime
      .prepareSelection()
      .then(async (content) => {
        if (cut) refuseUnportableCut(content)
        await writeClipboard((output) => this.runtime.write(output), content)
        this.retainCopy(content.html)
        if (cut) {
          this.runtime.assertCut(captured)
          remove()
        }
      })
      .catch((error) => this.runtime.report(error))
  }

  private readonly localCopies = new Map<
    string,
    { text: string; html: string; markdown: string }
  >()

  remember<T extends { text: string; html: string }>(
    output: T,
    markdown: string,
    content: Fragment,
    privateSource = false,
    actualCopy = false,
  ): T {
    let comments = privateSource
    content.descendants((node) => {
      const labelled = (label: unknown) =>
        typeof label === 'string' && literalCommentSpans(label).length > 0
      if (
        isComment(node) ||
        (/^(?:reference|footnote)_/.test(node.type.name) &&
          labelled(node.attrs.label)) ||
        node.marks.some(
          (mark) =>
            mark.type.name === 'link' &&
            (labelled(mark.attrs.label) ||
              commentProvenance(mark.attrs.referenceContent)),
        )
      )
        comments = true
    })
    if (!comments) {
      if (actualCopy) this.localCopies.clear()
      return output
    }
    const key = JSON.stringify([output.text, output.html, markdown])
    const previous = this.localCopies.get(key)
    if (previous) {
      output.html = previous.html
      if (actualCopy) this.localCopies.clear()
      this.localCopies.set(key, previous)
      return output
    }
    const wrapper = document.createElement('div')
    const token = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    wrapper.setAttribute('data-inkkit-local-copy', token)
    wrapper.innerHTML = output.html
    output.html = wrapper.outerHTML
    if (actualCopy) this.localCopies.clear()
    this.localCopies.set(key, {
      text: output.text,
      html: output.html,
      markdown,
    })
    return output
  }

  private retainCopy(html: string): void {
    for (const [key, copy] of this.localCopies)
      if (copy.html !== html) this.localCopies.delete(key)
  }

  restore<
    T extends {
      text: string
      html?: string
      markdown?: string
      plainText?: boolean
    },
  >(input: T): T {
    const copy = [...this.localCopies.values()].find(
      (copy) => copy.text === input.text && copy.html === input.html,
    )
    return copy &&
      input.markdown == null &&
      !input.plainText &&
      copy.text === input.text &&
      copy.html === input.html
      ? { ...input, markdown: copy.markdown }
      : input
  }

  private copySourceSelection(event: ClipboardEvent): void {
    event.preventDefault()
    event.stopPropagation()
    try {
      const snapshot = this.runtime.snapshot()
      const from = this.runtime.element().selectionStart,
        to = this.runtime.element().selectionEnd
      const selected = sourceSelection(snapshot.text, from, to)
      const parsed = this.runtime.ctx().get(parserCtx)(selected.shareable)
      let portable = false
      parsed.descendants((node) => {
        if (isImage(node) || isMermaid(node)) portable = true
      })
      const cut = event.type === 'cut' && this.runtime.writable()
      const captured = this.runtime.capture()
      if (portable && this.runtime.canWrite()) {
        this.deferredCopy(captured, cut, () => {
          this.runtime.element().setSelectionRange(from, to)
          this.runtime.replaceSelection('')
        })
      } else {
        const output = clipboardContent(
          parsed.content,
          parsed.type.schema,
          this.runtime.linkSchemes(),
        )
        if (!event.clipboardData) return
        this.remember(
          output,
          selected.markdown,
          parsed.content,
          selected.markdown !== selected.shareable,
          true,
        )
        event.clipboardData.setData('text/plain', output.text)
        event.clipboardData.setData('text/html', output.html)
        if (portable) {
          this.runtime.report(noClipboardHandler())
          return
        }
        if (cut) this.runtime.replaceSelection('')
      }
    } catch (error) {
      this.runtime.report(error)
    }
  }

  private readonly copyHandler = (event: ClipboardEvent): void => {
    if (this.runtime.handler().nativeCopy) return
    if (this.runtime.sourceMode()) {
      this.copySourceSelection(event)
      return
    }
    const view = this.runtime.ctx().get(editorViewCtx)
    const fragment = commentSelectionContent(
      view.state.doc,
      view.state.selection.from,
      view.state.selection.to,
      view.state.selection.content().content,
    )
    const expanded = selectionContent(view.state.doc, fragment)
    let hasImages = false
    expanded.descendants((node) => {
      if (isImage(node) || isMermaid(node)) hasImages = true
    })
    if (!hasImages) {
      if (!event.clipboardData || fragment.size === 0) return
      event.preventDefault()
      event.stopPropagation()
      try {
        this.runtime.snapshot()
        const content = expanded
        const valid = fragment.firstChild?.isInline
          ? Fragment.from(
              view.state.schema.nodes.paragraph!.create(null, fragment),
            )
          : fragment
        const markdown = selectionMarkdown(
          this.runtime.ctx(),
          view.state.doc,
          valid,
        )
        const output = clipboardContent(
          content,
          view.state.schema,
          this.runtime.linkSchemes(),
        )
        const metadata = referenceMetadata(
          this.runtime.ctx(),
          view.state.doc,
          valid,
        )
        if (metadata != null)
          output.html = withReferenceMetadata(output.html, metadata)
        this.remember(output, markdown, fragment, false, true)
        event.clipboardData.setData('text/plain', output.text)
        event.clipboardData.setData('text/html', output.html)
        if (event.type === 'cut' && this.runtime.writable())
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
      } catch (error) {
        this.runtime.report(error)
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.runtime.canWrite()) {
      const captured = this.runtime.capture()
      const { from, to } = view.state.selection
      const cut = event.type === 'cut' && this.runtime.writable()
      this.deferredCopy(captured, cut, () => {
        view.dispatch(view.state.tr.deleteRange(from, to).scrollIntoView())
      })
    } else {
      const container = document.createElement('div')
      container.textContent = clipboardText(expanded)
      event.clipboardData?.setData('text/plain', container.textContent ?? '')
      event.clipboardData?.setData('text/html', container.outerHTML)
      this.runtime.report(noClipboardHandler())
    }
  }
}
