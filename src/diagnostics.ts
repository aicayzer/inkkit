import { PreservationRefusal, MarkdownParseRefusal } from './preserve-error'
import {
  editorErrorCodes,
  type DocumentFormat,
  type EditorErrorCode,
} from './types'

/** Content-free editor counters and input guards. */
export type DiagnosticState = {
  ready: boolean
  revision: number
  generation?: number
  format: DocumentFormat
  mode: 'formatted' | 'source'
  editable: boolean
  composing: boolean
  pending: boolean
  selection?: { from: number; to: number }
}

/** Closed categories, never raw browser input, method arguments or error messages. */
export type DiagnosticEvent = {
  sequence: number
  elapsedMs: number
  kind:
    | 'input'
    | 'composition'
    | 'focus'
    | 'selection'
    | 'operation'
    | 'preservation'
    | 'error'
    | 'enabled'
  state: DiagnosticState
  phase?:
    | 'before'
    | 'after'
    | 'start'
    | 'end'
    | 'in'
    | 'out'
    | 'begin'
    | 'success'
    | 'refused'
  input?:
    | 'text'
    | 'composition'
    | 'delete'
    | 'paste'
    | 'drop'
    | 'history'
    | 'format'
    | 'other'
  operation?:
    | 'snapshot'
    | 'edit'
    | 'history'
    | 'load'
    | 'configuration'
    | 'output'
    | 'selection'
    | 'lifecycle'
    | 'other'
  code?: EditorErrorCode
  path?: 'unchanged' | 'local' | 'regions' | 'whole'
  reason?:
    | 'matching-budget'
    | 'source-location'
    | 'reopen-mismatch'
    | 'parse-refusal'
    | 'unexpected'
}

/** Declared CSS configuration and geometry, measured only when a report is requested. */
export type DiagnosticPresentation = {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic' | 'oblique' | 'other'
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  lineHeight?: number
  block: 'paragraph' | 'heading' | 'code' | 'other' | 'literal'
  marks: (
    | 'strong'
    | 'emphasis'
    | 'inlineCode'
    | 'strike_through'
    | 'link'
    | 'highlight'
    | 'other'
  )[]
  caretColor: string
  caret?: { left: number; top: number; right: number; bottom: number }
  viewport: { width: number; height: number }
  scroll: { left: number; top: number }
}

/** An opt-in local report. Disabling diagnostics clears all retained events and the incident. */
export type DiagnosticReport = {
  schemaVersion: 1
  enabled: boolean
  sessionId: string
  state: DiagnosticState
  events: DiagnosticEvent[]
  incident?: {
    triggerSequence: number
    events: DiagnosticEvent[]
    tail: DiagnosticEvent[]
  }
  presentation?: DiagnosticPresentation
}

type Detail = Omit<DiagnosticEvent, 'sequence' | 'elapsedMs' | 'state'>
const observers = new WeakMap<object, (detail: Detail) => void>()
export function observePreservation(
  ctx: object,
  observer?: (detail: Detail) => void,
): void {
  if (observer) observers.set(ctx, observer)
  else observers.delete(ctx)
}
export function tracePreservation(ctx: object, detail: Detail): void {
  observers.get(ctx)?.(detail)
}

export class Diagnostics {
  enabled = false
  private sessionId = randomSession()
  private started = performance.now()
  private sequence = 0
  private events: DiagnosticEvent[] = []
  private incident?: DiagnosticReport['incident']
  private dispose?: () => void
  private latestState: DiagnosticState = {
    ready: false,
    revision: 0,
    format: 'md',
    mode: 'formatted',
    editable: false,
    composing: false,
    pending: false,
  }

  private currentState(): DiagnosticState {
    try {
      return (this.latestState = this.state())
    } catch {
      return this.latestState
    }
  }

  capture(detail: Detail): void {
    try {
      this.record(detail)
    } catch {
      // Diagnostics must never interrupt editing or delivery of the original error.
    }
  }

  constructor(private readonly state: () => DiagnosticState) {}

  setEnabled(enabled: boolean, root: HTMLElement, ctx: object): void {
    if (enabled === this.enabled) return
    this.dispose?.()
    this.dispose = undefined
    observePreservation(ctx)
    this.enabled = enabled
    this.events = []
    this.incident = undefined
    this.sequence = 0
    if (!enabled) return
    this.sessionId = randomSession()
    this.started = performance.now()
    const listeners: (() => void)[] = []
    const listen = (
      target: EventTarget,
      name: string,
      run: (event: Event) => void,
    ) => {
      target.addEventListener(name, run, true)
      listeners.push(() => target.removeEventListener(name, run, true))
    }
    for (const name of ['beforeinput', 'input'] as const)
      listen(root, name, (event) => {
        const inputType = (event as InputEvent).inputType ?? ''
        const input: DiagnosticEvent['input'] = inputType.includes(
          'Composition',
        )
          ? 'composition'
          : inputType.startsWith('delete')
            ? 'delete'
            : inputType.includes('Paste')
              ? 'paste'
              : inputType.includes('Drop')
                ? 'drop'
                : inputType.startsWith('history')
                  ? 'history'
                  : inputType.startsWith('format')
                    ? 'format'
                    : inputType === 'insertText'
                      ? 'text'
                      : 'other'
        this.capture({
          kind: 'input',
          phase: name === 'beforeinput' ? 'before' : 'after',
          input,
        })
      })
    for (const name of ['compositionstart', 'compositionend'] as const)
      listen(root, name, () =>
        this.capture({
          kind: 'composition',
          phase: name === 'compositionstart' ? 'start' : 'end',
        }),
      )
    for (const name of ['focusin', 'focusout'] as const)
      listen(root, name, () =>
        this.capture({
          kind: 'focus',
          phase: name === 'focusin' ? 'in' : 'out',
        }),
      )
    listen(root.ownerDocument, 'selectionchange', () => {
      const document = root.ownerDocument
      if (
        root.contains(document.activeElement) ||
        root.contains(document.getSelection()?.anchorNode ?? null)
      )
        this.capture({ kind: 'selection' })
    })
    this.dispose = () => listeners.forEach((remove) => remove())
    observePreservation(ctx, (detail) => this.capture(detail))
    this.capture({ kind: 'enabled' })
  }

  private record(detail: Detail): void {
    if (!this.enabled) return
    const safe = { ...detail }
    if (safe.code && !editorErrorCodes.includes(safe.code))
      safe.code = 'internal'
    if (
      safe.reason &&
      ![
        'matching-budget',
        'source-location',
        'reopen-mismatch',
        'parse-refusal',
        'unexpected',
      ].includes(safe.reason)
    )
      safe.reason = 'unexpected'
    const event: DiagnosticEvent = {
      ...safe,
      sequence: ++this.sequence,
      elapsedMs: Math.round(performance.now() - this.started),
      state: this.currentState(),
    }
    this.events.push(event)
    if (this.events.length > 200) this.events.shift()
    if (this.incident) {
      if (this.incident.tail.length < 40) this.incident.tail.push(event)
    } else if (
      safe.code === 'preservation' ||
      safe.code === 'internal' ||
      (safe.kind === 'preservation' && safe.phase === 'refused')
    ) {
      this.incident = {
        triggerSequence: event.sequence,
        events: this.events.slice(),
        tail: [],
      }
    }
  }

  report(presentation?: DiagnosticPresentation): DiagnosticReport {
    return structuredClone({
      schemaVersion: 1,
      enabled: this.enabled,
      sessionId: this.sessionId,
      state: this.currentState(),
      events: this.events,
      ...(this.incident ? { incident: this.incident } : {}),
      ...(presentation ? { presentation } : {}),
    })
  }

  destroy(ctx: object): void {
    this.dispose?.()
    observePreservation(ctx)
    this.dispose = undefined
    this.enabled = false
    this.events = []
    this.incident = undefined
  }
}

export function diagnosticOperation(
  name: string,
): DiagnosticEvent['operation'] {
  if (name === 'snapshot') return 'snapshot'
  if (name === 'undo' || name === 'redo') return 'history'
  if (name === 'loadDocument' || name === 'reloadDocument') return 'load'
  if (name.startsWith('set')) return 'configuration'
  if (name.includes('Snapshot') || name === 'convertDocument') return 'output'
  if (name.includes('TextRange') || name === 'focus' || name === 'blur')
    return 'selection'
  if (name === 'destroy') return 'lifecycle'
  if (
    [
      'insertText',
      'replaceSource',
      'paste',
      'pasteAsPlainText',
      'format',
      'table',
      'moveBlock',
      'replace',
      'replaceAll',
      'insertImages',
      'appendImages',
      'insertFootnote',
      'insertPaths',
      'editReferenceDefinition',
    ].includes(name)
  )
    return 'edit'
  return 'other'
}

export const diagnosticNumber = (value: number): number =>
  Number.isFinite(value)
    ? Math.round(Math.max(-1e7, Math.min(1e7, value)) * 100) / 100
    : 0

export function diagnosticReason(error: unknown): DiagnosticEvent['reason'] {
  try {
    for (let depth = 0; depth < 8 && error instanceof Error; depth++) {
      if (error instanceof MarkdownParseRefusal) return 'parse-refusal'
      if (error instanceof PreservationRefusal) {
        const reason = error.reason
        return reason === 'matching-budget' ||
          reason === 'source-location' ||
          reason === 'reopen-mismatch'
          ? reason
          : 'unexpected'
      }
      error = Object.getOwnPropertyDescriptor(error, 'cause')?.value
    }
  } catch {
    // A foreign cause can expose accessors or proxies; only known values are useful.
  }
  return 'unexpected'
}

function randomSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
