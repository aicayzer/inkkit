import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { imagesRefused } from './paste'
import { modeSelectionMap } from './mode-selection'
import type { EditingMode } from './editor'
import type { ClipboardInput } from './types'
import {
  changedSource,
  editedPlainSource,
  rawOffset,
  normalizedOffset,
  type SourceProvenance,
} from './source'
import { matchingTextEdges } from './text-edges'
import { ListItemIndex } from './source-items'
import { leadingBOMLength } from './bom'
import {
  closerOf,
  continueListEdit,
  indentEdit,
  outdentEdit,
  pairEdit,
  type IndentStyle,
  type ItemsReader,
  type SourceEdit,
} from './source-typing'

function hasImageFile(files: FileList): boolean {
  return [...files].some((file) => file.type.startsWith('image/'))
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const modifierKeys: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
])

/** The kinds of input that are typing, so that a pair stays valid through them. */
const typingInputs: ReadonlySet<string> = new Set([
  'insertText',
  'insertCompositionText',
  'insertLineBreak',
  'insertParagraph',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
  'deleteHardLineBackward',
  'deleteHardLineForward',
])

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
  /** The tree that the editor's parser reads Markdown text into. */
  parseMarkdown(text: string): unknown
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
  private readonly items = new ListItemIndex((text) =>
    this.runtime.parseMarkdown(text),
  )
  /** Whether the change being made is typing, which keeps the pairs that are tracked. */
  private typing = false
  /** Escape was pressed, so the next Tab or Shift-Tab moves focus instead of indenting. */
  private tabEscaped = false

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
        event instanceof InputEvent &&
        event.inputType === 'deleteContentBackward' &&
        this.runtime.ready() &&
        this.runtime.literal() &&
        !event.isComposing &&
        !this.composing &&
        this.removePair()
      ) {
        // Input that arrives without a key, as on iOS and with some input methods.
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
    this.element.addEventListener('input', (event) => {
      if (!this.runtime.ready() || !this.runtime.literal()) return
      if (!this.runtime.writable()) {
        this.setSourceValue(this.runtime.currentText())
        return
      }
      // Only typing keeps the pairs that were tracked. A paste, a drop, a replacement and an undo
      // or redo that the browser made on its own do not.
      this.typing = typingInputs.has((event as InputEvent).inputType ?? '')
      if (this.typing) this.remapPairs(this.element.value)
      else this.forgetPairs(this.element.value)
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
        this.typing = false
      }
    })
    this.element.addEventListener('keydown', (event) => {
      if (this.composing) return
      if (this.runtime.keyDown(event) || this.browserKey(event))
        event.preventDefault()
    })
    this.element.addEventListener('blur', () => (this.tabEscaped = false))
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
    const shown = text.replace(/\r\n?/g, '\n')
    if (this.typing) this.remapPairs(shown)
    else this.forgetPairs(shown)
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
    this.asTyping(() => {
      if (!this.pairTyped(text)) this.replaceLiteralSelection(text, false)
    })
  }

  private asTyping(operation: () => void): void {
    const before = this.typing
    this.typing = true
    try {
      operation()
    } finally {
      this.typing = before
    }
  }

  /** Forgets the pairs that bracket pairing tracks, so their brackets are ordinary characters. */
  forgetPairs(shown = this.known): void {
    this.pairs = []
    this.known = shown
  }

  /** Applies `edit` to the document's own source, where each change falls. Returns whether the text changed. */
  private applyEdit(edit: SourceEdit, isolated: boolean): boolean {
    return this.runtime.applySource(
      changedSource(this.runtime.currentText(), edit.changes),
      isolated,
      edit.selection.from,
      edit.selection.to,
    )
  }

  /**
   * Follows the pairs through typing. A pair stays valid only while the edit is inside it, between
   * its opener and its closer; an edit anywhere else, or one that removes a bracket, forgets it.
   */
  private remapPairs(next: string): void {
    const before = this.known
    this.known = next
    if (!this.pairs.length || before === next) return
    const { prefix, suffix } = matchingTextEdges(before, next)
    const stop = before.length - suffix
    const delta = next.length - before.length
    this.pairs = this.pairs.flatMap(({ open, close }) =>
      prefix >= open + 1 && stop <= close
        ? [{ open, close: close + delta }]
        : [],
    )
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
    this.typing = true
    try {
      if (
        this.applyEdit(edit, false) &&
        start === end &&
        this.element.value !== value
      )
        this.pairs.push({ open: start, close: start + 1 })
    } finally {
      this.typing = false
    }
    return true
  }

  /** Backspace between an empty pair that pairing inserted removes both characters. */
  private removePair(): boolean {
    const { selectionStart: start, selectionEnd: end } = this.element
    if (
      !this.runtime.typing().pairBrackets ||
      !this.runtime.writable() ||
      start !== end ||
      !this.pairAt(start) ||
      this.pairAt(start)!.open !== start - 1
    )
      return false
    this.applyEdit(
      {
        changes: [{ from: start - 1, to: start + 1, text: '' }],
        selection: { from: start - 1, to: start - 1 },
      },
      false,
    )
    return true
  }

  private continueList(): boolean {
    const typing = this.runtime.typing()
    if (!typing.markdown || !typing.continueLists) return false
    const value = this.element.value
    const edit = continueListEdit(
      value,
      this.element.selectionStart,
      this.element.selectionEnd,
      this.itemsOf(value, this.element.selectionStart),
    )
    if (!edit) return false
    this.asTyping(() => this.applyEdit(edit, false))
    return true
  }

  /** Reads the list items of `value` up to the line at `offset` from the parser, when asked. */
  private itemsOf(value: string, offset: number): ItemsReader | undefined {
    if (!this.runtime.typing().markdown) return undefined
    const next = value.indexOf('\n', offset)
    const lineEnd = next < 0 ? value.length : next
    return () => this.items.through(value, lineEnd, leadingBOMLength(value))
  }

  private indent(outdent: boolean): void {
    const typing = this.runtime.typing()
    const { value, selectionStart: start, selectionEnd: end } = this.element
    const edit = outdent
      ? outdentEdit(value, start, end, typing.indent, typing.markdown)
      : indentEdit(value, start, end, typing.indent, this.itemsOf(value, start))
    if (edit) this.applyEdit(edit, true)
  }

  /**
   * The keys that a browser's textarea would handle differently from InkKit: Return in a list item,
   * Backspace in an empty pair, and Tab when the host chose how to indent. The others are left to
   * the browser, so Tab keeps moving focus unless the host set an indent, and then only until Escape.
   */
  private browserKey(event: KeyboardEvent): boolean {
    const { key, metaKey, ctrlKey, altKey, shiftKey } = event
    // Escape is the way out of a Tab that indents: the next Tab moves focus on.
    if (key === 'Escape' && !(metaKey || ctrlKey || altKey || shiftKey)) {
      this.tabEscaped = true
      return false
    }
    if (key === 'Tab' && this.tabEscaped) {
      this.tabEscaped = false
      return false
    }
    if (!modifierKeys.has(key)) this.tabEscaped = false
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
      if (!this.continueList())
        this.asTyping(() => this.replaceLiteralSelection('\n', false))
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
      this.asTyping(() => this.replaceLiteralSelection('', false))
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
