import { afterEach, expect, test, vi } from 'vitest'
import { InkKitEditor, InkKitError } from '../src/core'
import { documentOf, importsOf, diagnosticsOf } from './editor-access'
import { Preservation, PreservationError } from '../src/preserve'
import { PreservationRefusal } from '../src/preserve-error'
import type { DiagnosticState } from '../src/core'

let editor: InkKitEditor
let root: HTMLElement
afterEach(async () => {
  vi.restoreAllMocks()
  await editor?.destroy()
  root?.remove()
})
const privateText = 'PRIVATE_SENTINEL 😀 https://secret.invalid/private-path'
async function mount() {
  root = document.createElement('div')
  document.body.append(root)
  editor = await InkKitEditor.mount(root, { changed() {} })
  editor.loadDocument({
    documentId: privateText,
    generation: 1,
    format: 'md',
    text: `* ${privateText}\r\n`,
  })
  return root.querySelector<HTMLElement>('.ProseMirror')!
}
// Alternating input categories, so consecutive events differ and none merge.
function distinctInputs(surface: HTMLElement, total: number, data?: string) {
  for (let index = 0; index < total; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: index % 2 ? 'deleteContentBackward' : 'insertText',
        data,
      }),
    )
}
const operations = () =>
  editor.diagnosticReport().events.filter((event) => event.kind === 'operation')

test('diagnostics stay off until enabled and disabling clears all tracing and listeners', async () => {
  const surface = await mount()
  const listen = vi.spyOn(root, 'addEventListener')
  const remove = vi.spyOn(root, 'removeEventListener')
  surface.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      inputType: 'insertText',
      data: privateText,
    }),
  )
  expect(editor.diagnosticReport()).toMatchObject({
    schemaVersion: 1,
    enabled: false,
    events: [],
  })
  expect(editor.diagnosticReport().presentation).toBeUndefined()
  editor.setDiagnosticsEnabled(true)
  expect(listen).toHaveBeenCalledTimes(7)
  surface.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      inputType: 'insertText',
      data: privateText,
    }),
  )
  expect(
    editor.diagnosticReport().events.some((event) => event.input === 'text'),
  ).toBe(true)
  editor.setDiagnosticsEnabled(false)
  expect(remove).toHaveBeenCalledTimes(7)
  surface.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: privateText,
      data: privateText,
    }),
  )
  expect(editor.diagnosticReport()).toMatchObject({
    enabled: false,
    events: [],
  })
  expect(editor.diagnosticReport().incident).toBeUndefined()
  expect(JSON.stringify(editor.diagnosticReport())).not.toContain(
    'PRIVATE_SENTINEL',
  )
  expect(() =>
    editor.setDiagnosticsEnabled('true' as unknown as boolean),
  ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
})

test('reports remain readable through composition, pending import and preservation failure', async () => {
  const surface = await mount()
  editor.setDiagnosticsEnabled(true)
  surface.dispatchEvent(
    new CompositionEvent('compositionstart', {
      bubbles: true,
      data: privateText,
    }),
  )
  expect(() => editor.snapshot()).toThrow(
    expect.objectContaining({ code: 'composition' }),
  )
  expect(editor.diagnosticReport().state.composing).toBe(true)
  surface.dispatchEvent(
    new CompositionEvent('compositionend', {
      bubbles: true,
      data: privateText,
    }),
  )
  const pending = vi
    .spyOn(importsOf(editor), 'pending', 'get')
    .mockReturnValue(true)
  expect(() => editor.snapshot()).toThrow(
    expect.objectContaining({ code: 'operation-pending' }),
  )
  expect(editor.diagnosticReport().state.pending).toBe(true)
  expect(editor.diagnosticReport().incident).toBeUndefined()
  pending.mockRestore()
  const failure = vi
    .spyOn(documentOf(editor), 'currentText')
    .mockImplementation(() => {
      throw new InkKitError('preservation', privateText, {
        cause: new PreservationError(privateText),
      })
    })
  expect(() => editor.snapshot()).toThrow(
    expect.objectContaining({ code: 'preservation' }),
  )
  expect(editor.diagnosticReport().enabled).toBe(true)
  expect(
    editor
      .diagnosticReport()
      .incident!.events.some((event) => event.code === 'preservation'),
  ).toBe(true)
  expect(JSON.stringify(editor.diagnosticReport())).not.toContain(
    'PRIVATE_SENTINEL',
  )
  failure.mockRestore()
})

test('freezes refusal context, bounds overflow and returns detached reports without changing source or history', async () => {
  const surface = await mount()
  const original = editor.snapshot()
  editor.setDiagnosticsEnabled(true)
  distinctInputs(surface, 220, privateText)
  const failure = vi
    .spyOn(Preservation.prototype, 'serialize')
    .mockImplementation(() => {
      throw new PreservationError(privateText)
    })
  expect(() => editor.insertText('refused', 1)).toThrow(
    expect.objectContaining({ code: 'preservation' }),
  )
  const incident = editor.diagnosticReport().incident!
  expect(incident.events).toHaveLength(200)
  expect(incident.events.some((event) => event.code === 'preservation')).toBe(
    true,
  )
  failure.mockRestore()
  expect(editor.snapshot()).toEqual(original)
  distinctInputs(surface, 260, privateText)
  const report = editor.diagnosticReport()
  expect(report.events).toHaveLength(200)
  expect(report.incident!.events).toEqual(incident.events)
  expect(report.incident!.tail).toHaveLength(40)
  expect(JSON.stringify(report).length).toBeLessThan(200_000)
  expect(JSON.stringify(report)).not.toContain('PRIVATE_SENTINEL')
  report.events.length = 0
  report.incident!.events.length = 0
  expect(editor.diagnosticReport().events).toHaveLength(200)
  expect(editor.diagnosticReport().incident!.events).toEqual(incident.events)
  editor.insertText('accepted', 1)
  const edited = editor.snapshot().text
  editor.undo()
  expect(editor.snapshot().text).toBe(original.text)
  editor.redo()
  expect(editor.snapshot().text).toBe(edited)
  editor.loadDocument({
    documentId: privateText,
    generation: 2,
    format: 'md',
    text: edited,
  })
  expect(editor.snapshot().text).toBe(edited)
  expect(
    editor
      .diagnosticReport()
      .events.some((event) => event.kind === 'preservation' && event.path),
  ).toBe(true)
})

test('destroy disposes diagnostic listeners', async () => {
  await mount()
  editor.setDiagnosticsEnabled(true)
  const remove = vi.spyOn(root, 'removeEventListener')
  await editor.destroy()
  expect(remove).toHaveBeenCalledWith('beforeinput', expect.any(Function), true)
  expect(() => editor.diagnosticReport()).toThrow(
    expect.objectContaining({ code: 'destroyed' }),
  )
})

test('records only known preservation refusal reasons and keeps the first recovery tail', async () => {
  const surface = await mount()
  editor.setDiagnosticsEnabled(true)
  const local = vi
    .spyOn(
      Preservation.prototype as unknown as { localEdits(): string | undefined },
      'localEdits',
    )
    .mockImplementation(() => {
      throw new PreservationRefusal('matching-budget', privateText)
    })
  expect(() => editor.insertText('refused', 1)).toThrow(
    expect.objectContaining({ code: 'preservation' }),
  )
  local.mockRestore()
  const before = editor.diagnosticReport()
  expect(
    before.incident!.events.some((event) => event.reason === 'matching-budget'),
  ).toBe(true)
  const inputTypes = ['insertText', 'deleteContentBackward']
  let inputs = 0
  while (editor.diagnosticReport().incident!.tail.length < 40)
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: inputTypes[inputs++ % 2],
      }),
    )
  const frozen = editor.diagnosticReport().incident!.tail
  expect(frozen.at(-1)).toEqual(editor.diagnosticReport().events.at(-1))
  // Repeats of the full tail's last entry merge in the live events only.
  for (let index = 0; index < 5; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: inputTypes[(inputs - 1) % 2],
      }),
    )
  expect(editor.diagnosticReport().events.at(-1)!.count).toBe(6)
  distinctInputs(surface, 50)
  expect(editor.diagnosticReport().incident!.tail).toEqual(frozen)
  expect(JSON.stringify(editor.diagnosticReport())).not.toContain(
    'PRIVATE_SENTINEL',
  )
})

test('disabling removes frozen incidents and report layout is measured only on request', async () => {
  const surface = await mount()
  editor.setDiagnosticsEnabled(true)
  const measure = vi.spyOn(window, 'getComputedStyle')
  const before = measure.mock.calls.length
  surface.dispatchEvent(
    new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }),
  )
  expect(measure.mock.calls.length).toBe(before)
  const failure = vi
    .spyOn(documentOf(editor), 'currentText')
    .mockImplementation(() => {
      throw new InkKitError('preservation', privateText)
    })
  expect(() => editor.snapshot()).toThrow()
  expect(editor.diagnosticReport().incident).toBeDefined()
  expect(measure.mock.calls.length).toBeGreaterThan(before)
  failure.mockRestore()
  const sessionId = editor.diagnosticReport().sessionId
  editor.setDiagnosticsEnabled(false)
  expect(editor.diagnosticReport()).toMatchObject({
    enabled: false,
    events: [],
  })
  expect(editor.diagnosticReport().incident).toBeUndefined()
  editor.setDiagnosticsEnabled(true)
  expect(editor.diagnosticReport().sessionId).not.toBe(sessionId)
})

test('diagnostic failures cannot interrupt edits, error delivery or report collection', async () => {
  await mount()
  const original = editor.snapshot()
  editor.setDiagnosticsEnabled(true)
  const state = vi
    .spyOn(editor as unknown as { diagnosticState(): never }, 'diagnosticState')
    .mockImplementation(() => {
      throw new Error('unavailable state')
    })
  expect(editor.insertText('state-safe', 1)).toBe(true)
  expect(editor.diagnosticReport().enabled).toBe(true)
  editor.undo()
  expect(editor.snapshot().text).toBe(original.text)
  state.mockRestore()
  const record = vi
    .spyOn(diagnosticsOf(editor) as unknown as { record(): void }, 'record')
    .mockImplementation(() => {
      throw new Error('unavailable recorder')
    })
  expect(editor.insertText('record-safe', 1)).toBe(true)
  editor.undo()
  expect(editor.snapshot().text).toBe(original.text)
  const failure = vi
    .spyOn(Preservation.prototype, 'serialize')
    .mockImplementation(() => {
      throw new PreservationError(privateText)
    })
  expect(() => editor.insertText('refused', 1)).toThrow(
    expect.objectContaining({ code: 'preservation' }),
  )
  failure.mockRestore()
  expect(editor.snapshot().text).toBe(original.text)
  record.mockRestore()
})

test('keys the editor handles itself are recorded as input without the key', async () => {
  await mount()
  editor.setDiagnosticsEnabled(true)
  const handled = () =>
    editor
      .diagnosticReport()
      .events.filter(
        (event) => event.kind === 'input' && event.phase === 'handled',
      )
  const press = (init: KeyboardEventInit, prevent: boolean) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    })
    if (prevent) event.preventDefault()
    // Dispatched at the root, so only the test decides what is prevented.
    root.dispatchEvent(event)
  }
  press({ key: 'Backspace' }, false)
  press({ key: 'P' }, false)
  expect(handled()).toEqual([])
  press({ key: 'Backspace' }, true)
  press({ key: 'Delete' }, true)
  press({ key: 'z', metaKey: true }, true)
  press({ key: 'P', ctrlKey: true }, true)
  press({ key: 'Backspace', isComposing: true }, true)
  // Backspace and Delete are the same category, so they merge into one event.
  expect(handled().map((event) => [event.input, event.count ?? 1])).toEqual([
    ['delete', 2],
    ['history', 1],
    ['other', 1],
  ])
  expect(JSON.stringify(editor.diagnosticReport())).not.toMatch(
    /"P"|Backspace|PRIVATE_SENTINEL/,
  )
})

test('a synchronous call that succeeds records one success event', async () => {
  await mount()
  editor.setDiagnosticsEnabled(true)
  editor.textSnapshot()
  expect(operations()).toEqual([
    expect.objectContaining({ phase: 'success', operation: 'output' }),
  ])
  expect(operations()[0]!.count).toBeUndefined()
  const [enabled, success] = editor.diagnosticReport().events
  expect(enabled!.kind).toBe('enabled')
  expect(success!.sequence).toBe(enabled!.sequence + 1)
})

test('an asynchronous call records its begin before it settles, then its outcome', async () => {
  await mount()
  editor.setDiagnosticsEnabled(true)
  const pending = editor.clipboardSnapshot()
  expect(operations().map((event) => [event.phase, event.operation])).toEqual([
    ['begin', 'output'],
  ])
  await pending
  expect(operations().map((event) => [event.phase, event.operation])).toEqual([
    ['begin', 'output'],
    ['success', 'output'],
  ])
})

test('a refused call still records its begin and its refusal', async () => {
  const surface = await mount()
  editor.setDiagnosticsEnabled(true)
  surface.dispatchEvent(new CompositionEvent('compositionstart'))
  for (let index = 0; index < 2; index++)
    expect(() => editor.snapshot()).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
  expect(
    operations().map((event) => [event.phase, event.code, event.count]),
  ).toEqual([
    ['begin', undefined, undefined],
    ['refused', 'composition', undefined],
    ['begin', undefined, undefined],
    ['refused', 'composition', undefined],
  ])
  expect(editor.diagnosticReport().incident).toBeUndefined()
})

test('a call that records other events while it runs keeps its begin', async () => {
  await mount()
  editor.setDiagnosticsEnabled(true)
  // An edit runs the preservation check, which records its path during the call.
  editor.insertText('kept', 1)
  expect(
    editor
      .diagnosticReport()
      .events.slice(1)
      .map((event) => [event.kind, event.phase, event.operation]),
  ).toEqual([
    ['operation', 'begin', 'edit'],
    ['preservation', undefined, undefined],
    ['operation', 'success', 'edit'],
  ])
})

test('calls the editor makes to its own methods are not recorded as operations', async () => {
  root = document.createElement('div')
  document.body.append(root)
  let published = 0
  let hostReads = false
  editor = await InkKitEditor.mount(root, {
    changed() {},
    commandStateChanged: () => {
      published++
      // A host call made from an editor event is still the host's.
      if (hostReads) editor.headings()
    },
  })
  editor.loadDocument({
    documentId: privateText,
    generation: 1,
    format: 'md',
    text: `${privateText}\n`,
  })
  editor.setDiagnosticsEnabled(true)
  const before = published
  const { snapshotId } = editor.textSnapshot()
  editor.selectTextRange({ snapshotId, from: 0, to: 1 }, { reveal: true })
  editor.visibleTextRanges(editor.textSnapshot().snapshotId)
  expect(published).toBeGreaterThan(before)
  expect(
    operations().map((event) => [event.phase, event.operation, event.count]),
  ).toEqual([
    ['success', 'output', undefined],
    ['success', 'selection', undefined],
    ['success', 'output', undefined],
    ['success', 'selection', undefined],
  ])
  hostReads = true
  editor.selectTextRange(
    { snapshotId: editor.textSnapshot().snapshotId, from: 1, to: 2 },
    { reveal: true },
  )
  expect(
    operations()
      .slice(-4)
      .map((event) => [event.phase, event.operation]),
  ).toEqual([
    ['success', 'output'],
    ['begin', 'selection'],
    ['success', 'other'],
    ['success', 'selection'],
  ])
})

test('consecutive repeats merge into one event with a count and the latest sequence', async () => {
  await mount()
  editor.setDiagnosticsEnabled(true)
  for (let index = 0; index < 3; index++) editor.textSnapshot()
  const [enabled, merged, ...rest] = editor.diagnosticReport().events
  expect(rest).toEqual([])
  expect(merged).toMatchObject({
    kind: 'operation',
    phase: 'success',
    operation: 'output',
    count: 3,
  })
  // Each occurrence is numbered, so the merged range follows the previous event without a gap.
  expect(merged!.sequence - merged!.count! + 1).toBe(enabled!.sequence + 1)
  expect(merged!.elapsedMs).toBeGreaterThanOrEqual(enabled!.elapsedMs)
  editor.textSnapshot()
  const after = editor.diagnosticReport().events
  expect(after).toHaveLength(2)
  expect(after[1]).toMatchObject({ count: 4, sequence: merged!.sequence + 1 })
})

test('a repeat in a different state or category is a new event', async () => {
  const surface = await mount()
  editor.setDiagnosticsEnabled(true)
  editor.textSnapshot()
  editor.insertText('changed', 1)
  editor.textSnapshot()
  const output = operations().filter((event) => event.operation === 'output')
  expect(output).toHaveLength(2)
  expect(output[1]!.state.revision).toBeGreaterThan(output[0]!.state.revision)
  const type = (inputType: string) =>
    surface.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType }),
    )
  type('insertText')
  type('deleteContentBackward')
  type('deleteContentBackward')
  expect(
    editor
      .diagnosticReport()
      .events.slice(-2)
      .map((event) => [event.input, event.count]),
  ).toEqual([
    ['text', undefined],
    ['delete', 2],
  ])
  const real = (
    editor as unknown as { diagnosticState(): DiagnosticState }
  ).diagnosticState()
  const { selection: _, ...withoutSelection } = real
  const variants: DiagnosticState[] = [
    { ...real, revision: real.revision + 1 },
    { ...real, generation: 9 },
    { ...real, mode: 'source' },
    { ...real, format: 'txt' },
    { ...real, ready: !real.ready },
    { ...real, editable: !real.editable },
    { ...real, composing: !real.composing },
    { ...real, pending: !real.pending },
    { ...real, selection: { from: 0, to: 1 } },
    { ...real, selection: { from: 1, to: 1 } },
    withoutSelection,
  ]
  const state = vi.spyOn(
    editor as unknown as { diagnosticState(): DiagnosticState },
    'diagnosticState',
  )
  for (const variant of variants) {
    state.mockReturnValue(variant)
    type('deleteContentBackward')
  }
  state.mockRestore()
  const deletes = editor.diagnosticReport().events.slice(-variants.length)
  expect(deletes.map((event) => [event.input, event.count])).toEqual(
    variants.map(() => ['delete', undefined]),
  )
  expect(deletes.map((event) => event.state)).toEqual(variants)
})

test('events that freeze an incident are never merged, and the tail merges repeats while it has room', async () => {
  const surface = await mount()
  editor.setDiagnosticsEnabled(true)
  const failure = vi
    .spyOn(Preservation.prototype, 'serialize')
    .mockImplementation(() => {
      throw new PreservationError(privateText)
    })
  for (let index = 0; index < 2; index++)
    expect(() => editor.insertText('refused', 1)).toThrow(
      expect.objectContaining({ code: 'preservation' }),
    )
  failure.mockRestore()
  const report = editor.diagnosticReport()
  const failures = report.events.filter(
    (event) => event.code === 'preservation',
  )
  expect(failures.length).toBeGreaterThanOrEqual(4)
  expect(failures.every((event) => event.count === undefined)).toBe(true)
  const trigger = report.incident!.events.at(-1)!
  expect(trigger.sequence).toBe(report.incident!.triggerSequence)
  expect(trigger.count).toBeUndefined()
  for (let index = 0; index < 5; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }),
    )
  const tail = editor.diagnosticReport().incident!.tail
  expect(tail.at(-1)).toMatchObject({ input: 'text', count: 5 })
  expect(tail.at(-1)).toEqual(editor.diagnosticReport().events.at(-1))
  expect(editor.diagnosticReport().incident!.events).toEqual(
    report.incident!.events,
  )
})
