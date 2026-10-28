import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { modeSelectionMap } from './mode-selection'
import type { EditingMode } from './editor'
import type { ClipboardInput } from './types'
import {
  editedPlainSource,
  rawOffset,
  normalizedOffset,
  type SourceProvenance,
} from './source'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface SourceRuntime {
  ready(): boolean
  literal(): boolean
  writable(): boolean
  currentText(): string
  applySource(
    text: string,
    isolated: boolean,
    from?: number,
    to?: number,
    native?: boolean,
  ): boolean
  keyDown(event: KeyboardEvent): boolean
  publish(): void
  paste(input: ClipboardInput): Promise<void>
  report(error: unknown): void
  reveal(): void
}

interface ModeTransition {
  ctx: Ctx
  wasSource: boolean
  container: HTMLElement
  settle(): void
  text(): string
  changed(): void
  update(): void
  reveal(): void
}

/** Owns the source/TXT textarea and the DOM state of its current input. */
export class SourceSurface {
  readonly element: HTMLTextAreaElement
  private composingValue = false
  private beforeSelection?: { from: number; to: number }

  reconcileFormattedChange(
    markdown: string,
    anchor: SourceProvenance | null,
  ): void {
    const from = anchor?.from ?? this.element.selectionStart
    const to = anchor?.to ?? this.element.selectionEnd
    if (!this.composing) this.setSourceValue(markdown)
    if (!this.composing) {
      this.element.setSelectionRange(
        Math.min(from, this.element.value.length),
        Math.min(to, this.element.value.length),
      )
      this.runtime.reveal()
    }
  }

  constructor(
    root: HTMLElement,
    private readonly runtime: SourceRuntime,
  ) {
    this.element = document.createElement('textarea')
    this.element.className = 'inkkit-plain'
    this.element.setAttribute('aria-label', 'Plain text editor')
    this.element.hidden = true
    root.append(this.element)
    this.element.addEventListener('beforeinput', (event) => {
      if (!this.runtime.writable()) {
        event.preventDefault()
        return
      }
      if (this.runtime.ready() && this.runtime.literal())
        this.beforeSelection = {
          from: this.element.selectionStart,
          to: this.element.selectionEnd,
        }
    })
    this.element.addEventListener('input', () => {
      if (!this.runtime.ready() || !this.runtime.literal()) return
      if (!this.runtime.writable()) {
        this.setSourceValue(this.runtime.currentText())
        return
      }
      try {
        this.runtime.applySource(
          editedPlainSource(this.runtime.currentText(), this.element.value),
          false,
          this.element.selectionStart,
          this.element.selectionEnd,
          true,
        )
      } catch (error) {
        this.runtime.report(error)
      } finally {
        this.beforeSelection = undefined
      }
    })
    this.element.addEventListener('keydown', (event) => {
      if (this.composing) return
      if (this.runtime.keyDown(event)) event.preventDefault()
    })
    for (const event of ['select', 'keyup', 'click'])
      this.element.addEventListener(event, () => this.runtime.publish())
    this.element.addEventListener('paste', (event) => {
      if (!this.runtime.writable()) {
        event.preventDefault()
        return
      }
      if (!event.clipboardData) return
      event.preventDefault()
      void this.runtime
        .paste({
          text: event.clipboardData.getData('text/plain'),
          html: event.clipboardData.getData('text/html'),
          markdown: event.clipboardData.getData('text/markdown') || undefined,
        })
        .catch((error) => this.runtime.report(error))
    })
    this.element.addEventListener('compositionstart', () => {
      this.composingValue = true
      this.runtime.publish()
    })
    this.element.addEventListener('compositionend', () => {
      this.composingValue = false
      this.runtime.publish()
    })
  }

  get composing(): boolean {
    return this.composingValue
  }

  get beforeInput(): { from: number; to: number } | undefined {
    return this.beforeSelection
  }

  reset(): void {
    this.composingValue = false
    this.beforeSelection = undefined
  }

  destroy(): void {
    this.element.remove()
  }

  showTypedSource(text: string, from: number, to: number): void {
    this.setSourceValue(text)
    this.element.setSelectionRange(
      Math.min(from, this.element.value.length),
      Math.min(to, this.element.value.length),
    )
    this.runtime.reveal()
  }

  // WebKit lays out a large textarea incrementally only when its initial
  // value was assigned off-tree. An attached whole-value replacement also
  // loses that state after undo or paste, so every replacement uses this path.
  setSourceValue(text: string): void {
    const plain = this.element
    if (text.length < 65_536 || !plain.isConnected || this.composing) {
      plain.value = text
      return
    }
    const focused = plain.ownerDocument.activeElement === plain
    const {
      selectionStart,
      selectionEnd,
      selectionDirection,
      scrollTop,
      scrollLeft,
    } = plain
    const marker = plain.ownerDocument.createComment('source')
    plain.replaceWith(marker)
    plain.value = text
    marker.replaceWith(plain)
    plain.setSelectionRange(selectionStart, selectionEnd, selectionDirection)
    if (focused) plain.focus({ preventScroll: true })
    plain.scrollTop = scrollTop
    plain.scrollLeft = scrollLeft
  }

  replaceLiteralSelection(
    text: string,
    isolated = true,
    retainEndings = false,
  ): void {
    const value = this.element.value
    const start = this.element.selectionStart,
      end = this.element.selectionEnd
    const next =
      value.slice(0, start) + text.replace(/\r\n?/g, '\n') + value.slice(end)
    const caret = start + text.replace(/\r\n?/g, '\n').length
    const previous = this.runtime.currentText()
    const source = retainEndings
      ? previous.slice(0, rawOffset(previous, start)) +
        text +
        previous.slice(rawOffset(previous, end))
      : editedPlainSource(previous, next)
    this.runtime.applySource(source, isolated, caret, caret)
  }

  keyDown({ key, metaKey, ctrlKey, altKey }: KeyboardEvent): boolean {
    if (metaKey || ctrlKey || altKey) return false
    if (key === 'Enter' || key === 'Tab') {
      this.replaceLiteralSelection(key === 'Enter' ? '\n' : '\t', false)
      return true
    }
    if (key === 'Backspace' || key === 'Delete') {
      const start = this.element.selectionStart,
        end = this.element.selectionEnd
      if (start === end) {
        // Segment the whole value: an interior caret and regional-indicator
        // pairing both need context beyond the direction of deletion.
        const segment = graphemes
          .segment(this.element.value)
          .containing(key === 'Backspace' ? start - 1 : start)
        if (!segment) return false
        this.element.setSelectionRange(
          segment.index,
          segment.index + segment.segment.length,
        )
      }
      this.replaceLiteralSelection('', false)
      return true
    }
    return false
  }

  setMode(mode: EditingMode, transition: ModeTransition): boolean {
    const wasSource = transition.wasSource
    const view = transition.ctx.get(editorViewCtx)
    const focused = wasSource
      ? this.element.ownerDocument.activeElement === this.element
      : view.hasFocus()
    const container = transition.container
    const previousSurface = wasSource ? this.element : container
    const fraction =
      previousSurface.scrollTop /
      Math.max(1, previousSurface.scrollHeight - previousSurface.clientHeight)
    const left = previousSurface.scrollLeft
    const sourceSelection = wasSource
      ? {
          anchor:
            this.element.selectionDirection === 'backward'
              ? this.element.selectionEnd
              : this.element.selectionStart,
          head:
            this.element.selectionDirection === 'backward'
              ? this.element.selectionStart
              : this.element.selectionEnd,
        }
      : undefined
    transition.settle()
    const text = transition.text()
    const mapping = modeSelectionMap(transition.ctx, text, view.state.doc)
    const anchor = sourceSelection
      ? mapping.formatted(rawOffset(text, sourceSelection.anchor))
      : normalizedOffset(
          text,
          mapping.source(
            view.state.selection.anchor,
            view.state.selection.anchor < view.state.selection.head ? 1 : -1,
          ),
        )
    const head = sourceSelection
      ? mapping.formatted(rawOffset(text, sourceSelection.head))
      : normalizedOffset(
          text,
          mapping.source(
            view.state.selection.head,
            view.state.selection.head < view.state.selection.anchor ? 1 : -1,
          ),
        )
    transition.changed()
    if (mode === 'source') {
      this.setSourceValue(text)
      this.element.setSelectionRange(
        Math.min(anchor, head),
        Math.max(anchor, head),
        anchor > head ? 'backward' : 'forward',
      )
    } else {
      view.dispatch(
        view.state.tr
          .setSelection(
            TextSelection.between(
              view.state.doc.resolve(
                Math.min(anchor, view.state.doc.content.size),
              ),
              view.state.doc.resolve(
                Math.min(head, view.state.doc.content.size),
              ),
            ),
          )
          .setMeta('addToHistory', false),
      )
    }
    transition.update()
    const surface = this.runtime.literal() ? this.element : container
    surface.scrollTop =
      fraction * Math.max(0, surface.scrollHeight - surface.clientHeight)
    surface.scrollLeft = left
    if (focused) {
      if (this.runtime.literal()) this.element.focus({ preventScroll: true })
      else view.dom.focus({ preventScroll: true })
      transition.reveal()
    }
    this.runtime.publish()
    return true
  }
}
