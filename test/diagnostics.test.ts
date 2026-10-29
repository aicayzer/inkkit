import { afterEach, expect, test, vi } from 'vitest'
import { InkKitEditor, InkKitError } from '../src/core'
import { documentOf, importsOf, diagnosticsOf } from './editor-access'
import { Preservation, PreservationError } from '../src/preserve'
import { PreservationRefusal } from '../src/preserve-error'

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
  expect(listen).toHaveBeenCalledTimes(6)
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
  expect(remove).toHaveBeenCalledTimes(6)
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
  for (let index = 0; index < 220; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertText',
        data: privateText,
      }),
    )
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
  for (let index = 0; index < 260; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: privateText,
        data: privateText,
      }),
    )
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
  for (let index = 0; index < 50; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }),
    )
  const frozen = editor.diagnosticReport().incident!.tail
  for (let index = 0; index < 50; index++)
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'deleteContentBackward',
      }),
    )
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
