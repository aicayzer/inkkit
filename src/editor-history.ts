import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorState, Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  closeHistory,
  redoDepth,
  undoDepth,
  undo as undoHistory,
  redo as redoHistory,
} from '@milkdown/kit/prose/history'
import { sourceAttribute, type SourceProvenance } from './source'
import { sourceReplacement } from './comments'
import { terminalSelection } from './editor-selection'
import { undoSmartPunctuation } from './smart-punctuation'
import { InkKitError, type DocumentFormat } from './types'

interface HistoryRuntime {
  ctx(): Ctx
  format(): DocumentFormat
  literal(): boolean
  writable(): boolean
  currentText(doc?: ProseNode): string
  parseSource(text: string, provenance: SourceProvenance): ProseNode
  remember(doc: ProseNode, text: string): void
  selection(): { from: number; to: number }
  beforeInput(): { from: number; to: number } | undefined
  showSource(text: string, from: number, to: number): void
  changed(): void
  publish(text: string): void
  loading(operation: () => void): void
}

// A pause in source typing longer than this ends an undo step, as in the
// formatted editor's history.
const sourceGroupDelay = 500
// Earlier undo steps of typed source that the formatted document has not taken
// in; the oldest merge into the next beyond this many.
const sourceStepLimit = 100

interface HistoryBranch {
  constructor: { empty: unknown }
}
interface HistoryPluginState {
  done: unknown
  undone: HistoryBranch
}
const isHistoryState = (value: unknown): value is HistoryPluginState =>
  typeof value === 'object' &&
  value !== null &&
  'done' in value &&
  'undone' in value &&
  typeof (value as HistoryPluginState).undone?.constructor?.empty === 'object'

/**
 * Empties the formatted document's redo stack and keeps every undo step. ProseMirror's history
 * clears the stack only when an edit lands, and offers no call for it, so this replaces the
 * plugin's state through the plugin's own transaction meta. It checks the result against
 * `undoDepth` and `redoDepth` before it changes anything, so a ProseMirror update that changes
 * the state's shape fails here, in `test/discard-undone.test.ts`, and not silently.
 */
export function discardFormattedRedo(view: EditorView): void {
  const { state } = view
  if (redoDepth(state) === 0) return
  const plugin = state.plugins.find(
    (candidate: Plugin) =>
      /^history\$/.test((candidate.spec.key as { key?: string })?.key ?? '') &&
      isHistoryState(candidate.getState(state)),
  )
  const previous = plugin?.getState(state) as HistoryPluginState | undefined
  if (!plugin || !previous)
    throw new InkKitError('internal', 'The undo history could not be found')
  const historyState = Object.assign(
    Object.create(Object.getPrototypeOf(previous) as object) as object,
    previous,
    { undone: previous.undone.constructor.empty },
  )
  const tr = state.tr.setMeta(plugin.spec.key!, { redo: false, historyState })
  const next = state.apply(tr)
  if (redoDepth(next) !== 0 || undoDepth(next) !== undoDepth(state))
    throw new InkKitError('internal', 'The redo steps could not be discarded')
  view.dispatch(tr)
}

interface TypedSource {
  text: string
  from: number
  to: number
  // Where the caret and selection were before this step began.
  before: { from: number; to: number }
  // An edit that is not typing, which later typing does not join.
  closed: boolean
}

export class SourceHistory {
  // Pending text is authoritative before the formatted document takes it in.
  // Typed undo steps operate on text alone until an operation settles it.
  private pendingSource?: TypedSource
  private typedSteps: TypedSource[] = []
  private undoneSteps: TypedSource[] = []
  // Replay formatted undos before reaching the source steps they preceded.
  private formattedUndone = 0
  // Source edits invalidate the formatted redo tail, but retain earlier undos.
  private formattedRedoLimit?: number
  private historyDirection?: 'undo' | 'redo'
  private lastSourceInput = 0
  private syncingSource = false

  constructor(private readonly runtime: HistoryRuntime) {}

  get pendingText(): string | undefined {
    return this.pendingSource?.text
  }

  get syncing(): boolean {
    return this.syncingSource
  }

  reset(): void {
    this.pendingSource = undefined
    this.typedSteps = []
    this.undoneSteps = []
    this.formattedUndone = 0
    this.formattedRedoLimit = undefined
  }

  modeChanged(): void {
    this.undoneSteps = []
    this.formattedUndone = 0
  }

  /** Drops the redo steps of typed source, and the count of formatted ones that wait behind them. */
  discardUndone(): void {
    this.undoneSteps = []
    this.formattedUndone = 0
  }

  canUndo(state: EditorState): boolean {
    return !!this.pendingSource || undoHistory(state)
  }

  canRedo(state: EditorState): boolean {
    return (
      this.undoneSteps.length > 0 ||
      (!this.pendingSource &&
        this.formattedRedoLimit !== 0 &&
        redoHistory(state))
    )
  }

  capture() {
    return {
      formattedRedoLimit: this.formattedRedoLimit,
      formattedUndone: this.formattedUndone,
    }
  }

  restore(point: ReturnType<SourceHistory['capture']>): void {
    this.formattedRedoLimit = point.formattedRedoLimit
    this.formattedUndone = point.formattedUndone
  }

  didApply(previous: EditorState, next: EditorState): void {
    if (this.formattedRedoLimit !== undefined) {
      const depth = redoDepth(next)
      if (depth === 0) this.formattedRedoLimit = undefined
      else if (next !== previous) {
        if (this.historyDirection === 'undo')
          this.formattedRedoLimit = Math.min(depth, this.formattedRedoLimit + 1)
        else if (this.historyDirection === 'redo')
          this.formattedRedoLimit = Math.max(0, this.formattedRedoLimit - 1)
      }
    }
  }

  applySource(
    text: string,
    isolated: boolean,
    from?: number,
    to?: number,
    native = false,
  ): boolean {
    if (!this.runtime.writable())
      throw new InkKitError('read-only', 'The editor is read-only')
    // Source edits take the same steps whether typed or not; an edit that is
    // not typing ends the typing step before it and is closed to the next.
    if (this.runtime.literal())
      return this.deferSource(text, from, to, native, isolated)
    return this.commitSource(
      text,
      isolated,
      from,
      to,
      this.runtime.beforeInput(),
    )
  }

  /**
   * Takes typed source without parsing it. Parsing, preservation and replacing
   * the formatted document cost as much as a document load, so they wait for
   * the next thing that needs them.
   */
  private deferSource(
    text: string,
    from: number | undefined,
    to: number | undefined,
    native: boolean,
    closed: boolean,
  ): boolean {
    if (text === this.runtime.currentText()) return false
    const length =
      from === undefined ? text.replace(/\r\n?/g, '\n').length : from
    const now = Date.now()
    const previous = this.pendingSource
    const continuing =
      previous &&
      !previous.closed &&
      !closed &&
      now - this.lastSourceInput <= sourceGroupDelay
    if (previous && !continuing) this.rememberTypedStep(previous)
    this.formattedRedoLimit = 0
    this.lastSourceInput = now
    this.undoneSteps = []
    this.formattedUndone = 0
    const pending: TypedSource = {
      text,
      from: length,
      to: to ?? length,
      before: (continuing ? previous.before : undefined) ??
        this.runtime.beforeInput() ?? {
          from: this.runtime.selection().from,
          to: this.runtime.selection().to,
        },
      closed,
    }
    this.pendingSource = pending
    this.runtime.changed()
    // Text that did not come from the textarea is shown there.
    if (!native) this.runtime.showSource(pending.text, pending.from, pending.to)
    this.runtime.publish(text)
    return true
  }

  private rememberTypedStep(step: TypedSource): void {
    this.typedSteps.push(step)
    if (this.typedSteps.length > sourceStepLimit) this.typedSteps.shift()
  }

  /**
   * Undoes or redoes typed source that the formatted document has not taken
   * in, on the text alone. Returns whether there was a step to take.
   */
  private stepTypedSource(direction: 'undo' | 'redo'): boolean {
    const current = this.pendingSource
    let text: string, from: number, to: number
    if (direction === 'undo') {
      if (!current) return false
      this.undoneSteps.push(current)
      this.pendingSource = this.typedSteps.pop()
      text = this.pendingSource?.text ?? this.runtime.currentText()
      ;({ from, to } = current.before)
    } else {
      const next = this.undoneSteps.pop()
      if (!next) return false
      if (current) this.rememberTypedStep(current)
      this.pendingSource = next
      text = next.text
      ;({ from, to } = next)
    }
    this.lastSourceInput = 0
    this.runtime.changed()
    this.runtime.showSource(text, from, to)
    this.runtime.publish(text)
    return true
  }

  /** Brings the formatted document up to the source that was typed. */
  settleSource(): void {
    const pending = this.pendingSource
    if (!pending) return
    const steps = this.typedSteps,
      undone = this.undoneSteps
    this.pendingSource = undefined
    this.typedSteps = []
    this.undoneSteps = []
    this.syncingSource = true
    try {
      if (
        this.commitSource(
          pending.text,
          // A step of its own, whatever edit follows within the group delay.
          true,
          pending.from,
          pending.to,
          steps[0]?.before ?? pending.before,
        )
      ) {
        const { doc } = this.runtime.ctx().get(editorViewCtx).state
        const applied = doc.attrs[sourceAttribute] as SourceProvenance | null
        // A plugin that refuses the change must not lose what was typed.
        if (applied?.text !== pending.text)
          throw new InkKitError(
            'preservation',
            'The typed source could not be applied',
          )
        this.runtime.remember(doc, pending.text)
      }
    } catch (error) {
      this.pendingSource = pending
      this.typedSteps = steps
      this.undoneSteps = undone
      throw error
    } finally {
      this.syncingSource = false
    }
  }

  commitSource(
    text: string,
    isolated: boolean,
    from: number | undefined,
    to: number | undefined,
    before: { from: number; to: number } | undefined,
  ): boolean {
    if (text === this.runtime.currentText()) return false
    const view = this.runtime.ctx().get(editorViewCtx)
    const normalizedLength = text.replace(/\r\n?/g, '\n').length
    const provenance: SourceProvenance = Object.freeze({
      text,
      format: this.runtime.format(),
      from: from ?? normalizedLength,
      to: to ?? from ?? normalizedLength,
    })
    const parsed = this.runtime.parseSource(text, provenance)
    if (this.runtime.literal()) {
      const previous: SourceProvenance = Object.freeze({
        text: this.runtime.currentText(),
        format: this.runtime.format(),
        from: before?.from ?? this.runtime.selection().from,
        to: before?.to ?? this.runtime.selection().to,
      })
      // History must retain the source caret even when the formatted document has no corresponding position.
      this.runtime.loading(() => {
        view.dispatch(
          view.state.tr
            .setDocAttribute(sourceAttribute, previous)
            .setMeta('addToHistory', false),
        )
      })
    }
    let tr = view.state.tr
      .replaceWith(0, view.state.doc.content.size, parsed.content)
      .setDocAttribute(sourceAttribute, provenance)
      .setMeta(sourceReplacement, true)
    tr.setSelection(terminalSelection(tr.doc))
    if (isolated) tr = closeHistory(tr)
    view.dispatch(tr)
    if (isolated)
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
    return true
  }

  private stepFormattedHistory(direction: 'undo' | 'redo'): boolean {
    if (direction === 'redo' && this.formattedRedoLimit === 0) return false
    const view = this.runtime.ctx().get(editorViewCtx)
    const before = view.state
    const previous = this.historyDirection
    this.historyDirection = direction
    try {
      const command = direction === 'undo' ? undoHistory : redoHistory
      command(before, view.dispatch)
      // A history command can return true even if dispatch refused its edit.
      return view.state !== before
    } finally {
      this.historyDirection = previous
    }
  }

  undo(): boolean {
    if (this.runtime.literal() && this.stepTypedSource('undo')) return true
    const view = this.runtime.ctx().get(editorViewCtx)
    const undone =
      (!this.runtime.literal() &&
        undoSmartPunctuation(view.state, view.dispatch)) ||
      this.stepFormattedHistory('undo')
    if (undone) {
      // Source steps that were undone come back after the formatted ones.
      if (this.runtime.literal() && this.undoneSteps.length)
        this.formattedUndone++
      else this.undoneSteps = []
    }
    return undone
  }

  redo(): boolean {
    const view = this.runtime.ctx().get(editorViewCtx)
    if (this.runtime.literal()) {
      if (this.formattedUndone > 0) {
        if (this.formattedRedoLimit !== 0 && redoHistory(view.state)) {
          const redone = this.stepFormattedHistory('redo')
          if (redone) this.formattedUndone--
          return redone
        }
        this.formattedUndone = 0
      }
      if (this.stepTypedSource('redo')) return true
      // Typing after an undo ended the formatted history's redo steps.
      if (this.pendingSource) return false
    }
    return this.stepFormattedHistory('redo')
  }
}
