import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { imagesRefused } from './paste'
import { modeSelectionMap } from './mode-selection'
import type { EditingMode } from './editor'
import type { ClipboardInput } from './types'
import {
  editedPlainSource,
  rawOffset,
  normalizedOffset,
  type SourceProvenance,
} from './source'
import { matchingTextEdges } from './text-edges'
import {
  closerOf,
  continueListEdit,
  indentEdit,
  outdentEdit,
  pairEdit,
  type IndentStyle,
  type SourceEdit,
} from './source-typing'

function hasImageFile(files: FileList): boolean {
  return [...files].some((file) => file.type.startsWith('image/'))
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The typing preferences that the source and TXT surfaces follow. */
export interface SourceTyping {
  pairBrackets: boolean
  continueLists: boolean
  indent: IndentStyle
  /** Whether the host chose an indent, so that a browser's Tab key indents rather than moving focus. */
  tabIndents: boolean
  /** Whether the text is Markdown, which has list items to continue and nest. */
  markdown: boolean
}

interface SourceRuntime {
  ready(): boolean
  literal(): boolean
  writable(): boolean
  typing(): SourceTyping
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
  /** Whether image input has nowhere to go; a dropped file may be left to a `files` adapter. */
  refusesImages(drop: boolean): boolean
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
  /** The text the surface last showed, and the pairs that bracket pairing inserted into it. */
  private known = ''
  private pairs: Array<{ open: number; close: number }> = []

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
      if (
        this.runtime.ready() &&
        this.runtime.literal() &&
        event instanceof InputEvent &&
        event.inputType === 'insertText' &&
        event.data &&
        !event.isComposing &&
        !this.composing &&
        this.pairTyped(event.data)
      ) {
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
      this.remapPairs(this.element.value)
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
      if (this.runtime.keyDown(event) || this.browserKey(event))
        event.preventDefault()
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
      if (
        !(
          event.clipboardData.getData('text/markdown') ||
          event.clipboardData.getData('text/plain')
        ) &&
        hasImageFile(event.clipboardData.files) &&
        this.runtime.refusesImages(false)
      ) {
        this.runtime.report(imagesRefused())
        return
      }
      void this.runtime
        .paste({
          text: event.clipboardData.getData('text/plain'),
          html: event.clipboardData.getData('text/html'),
          markdown: event.clipboardData.getData('text/markdown') || undefined,
        })
        .catch((error) => this.runtime.report(error))
    })
    this.element.addEventListener('drop', (event) => {
      const data = event.dataTransfer
      if (
        !data ||
        data.getData('text/plain') ||
        !hasImageFile(data.files) ||
        !this.runtime.refusesImages(true)
      )
        return
      event.preventDefault()
      if (this.runtime.writable()) this.runtime.report(imagesRefused())
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
    this.remapPairs(text.replace(/\r\n?/g, '\n'))
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

  /** Text that was typed, which brackets and quotes may pair or step over. */
  typeText(text: string): void {
    if (!this.pairTyped(text)) this.replaceLiteralSelection(text, false)
  }

  /** Applies `edit` to the text, with the document's own line endings. Returns whether the text changed. */
  private applyEdit(edit: SourceEdit, isolated: boolean): boolean {
    const value = this.element.value
    const next = value.slice(0, edit.from) + edit.text + value.slice(edit.to)
    const previous = this.runtime.currentText()
    return this.runtime.applySource(
      editedPlainSource(previous, next),
      isolated,
      edit.selection.from,
      edit.selection.to,
    )
  }

  /** Keeps the pairs that bracket pairing inserted at the characters they were inserted at. */
  private remapPairs(next: string): void {
    const before = this.known
    this.known = next
    if (!this.pairs.length || before === next) return
    const { prefix, suffix } = matchingTextEdges(before, next)
    const delta = next.length - before.length
    const map = (position: number) =>
      position < prefix
        ? position
        : position >= before.length - suffix
          ? position + delta
          : -1
    this.pairs = this.pairs.flatMap(({ open, close }) => {
      const mapped = { open: map(open), close: map(close) }
      return mapped.open < 0 || mapped.close < 0 ? [] : [mapped]
    })
  }

  private pairAt(close: number): { open: number; close: number } | undefined {
    const value = this.element.value
    return this.pairs.find(
      (pair) =>
        pair.close === close &&
        closerOf(value[pair.open] ?? '') === value[pair.close],
    )
  }

  /**
   * Bracket pairing for a typed character. A closer typed before the closer that pairing inserted
   * steps over it, an opener inserts its closer, and a selection on one line is wrapped.
   * Returns whether it took the character.
   */
  private pairTyped(text: string): boolean {
    if (
      !this.runtime.typing().pairBrackets ||
      !this.runtime.writable() ||
      this.composing
    )
      return false
    const { value, selectionStart: start, selectionEnd: end } = this.element
    if (start === end && value[start] === text && this.pairAt(start)) {
      this.pairs = this.pairs.filter((pair) => pair.close !== start)
      this.element.setSelectionRange(start + 1, start + 1)
      this.runtime.publish()
      return true
    }
    const edit = pairEdit(value, start, end, text)
    if (!edit) return false
    if (
      this.applyEdit(edit, false) &&
      start === end &&
      this.element.value !== value
    )
      this.pairs.push({ open: start, close: start + 1 })
    return true
  }

  /** Backspace between an empty pair that pairing inserted removes both characters. */
  private removePair(): boolean {
    const { selectionStart: start, selectionEnd: end } = this.element
    if (
      start !== end ||
      !this.pairAt(start) ||
      this.pairAt(start)!.open !== start - 1
    )
      return false
    this.applyEdit(
      {
        from: start - 1,
        to: start + 1,
        text: '',
        selection: { from: start - 1, to: start - 1 },
      },
      false,
    )
    return true
  }

  private continueList(): boolean {
    const typing = this.runtime.typing()
    if (!typing.markdown || !typing.continueLists) return false
    const edit = continueListEdit(
      this.element.value,
      this.element.selectionStart,
      this.element.selectionEnd,
    )
    if (!edit) return false
    this.applyEdit(edit, false)
    return true
  }

  private indent(outdent: boolean): void {
    const typing = this.runtime.typing()
    const { value, selectionStart: start, selectionEnd: end } = this.element
    const edit = outdent
      ? outdentEdit(value, start, end, typing.indent, typing.markdown)
      : indentEdit(value, start, end, typing.indent, typing.markdown)
    if (edit) this.applyEdit(edit, true)
  }

  /**
   * The keys that a browser's textarea would handle differently from InkKit: Return in a list item,
   * Backspace in an empty pair, and Tab when the host chose how to indent. The others are left to
   * the browser, so Tab keeps moving focus unless the host set an indent.
   */
  private browserKey(event: KeyboardEvent): boolean {
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event
    if (
      metaKey ||
      ctrlKey ||
      altKey ||
      !this.runtime.ready() ||
      !this.runtime.literal() ||
      !this.runtime.writable()
    )
      return false
    if (key === 'Enter') return this.continueList()
    if (key === 'Backspace') return this.removePair()
    if (key === 'Tab' && this.runtime.typing().tabIndents) {
      this.indent(shiftKey)
      return true
    }
    return false
  }

  keyDown({ key, metaKey, ctrlKey, altKey, shiftKey }: KeyboardEvent): boolean {
    if (metaKey || ctrlKey || altKey) return false
    if (key === 'Enter') {
      if (!this.continueList()) this.replaceLiteralSelection('\n', false)
      return true
    }
    if (key === 'Tab') {
      this.indent(shiftKey)
      return true
    }
    if (key === 'Backspace' && this.removePair()) return true
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
