import { expect, test, vi } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { closeHistory, redoDepth, undoDepth } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, InkKitError } from '../src/core'
import {
  Preservation,
  crossCheck,
  preservationWork,
  semanticSignature,
} from '../src/preserve'
import {
  MarkdownParseRefusal,
  PreservationError,
  PreservationRefusal,
} from '../src/preserve-error'
import { tooManyBlocks } from '../src/preserve-alignment'
import { DefinitionContext } from '../src/preserve-context'
import { LocalEdits } from '../src/preserve-local'
import { MoveOrigins } from '../src/preserve-moves'
import { Reconstruction } from '../src/preserve-reconstruction'
import { LoadedSource } from '../src/preserve-source'
import { withEditor } from './harness'
import { ctxOf } from './editor-access'

const source = 'Before __bold__.\r\n\r\nMiddle.\r\n\r\nAfter.\r\n'
const structural = source.replace('Middle.', 'Middle.\r\n\r\nAdded é👩‍💻.')
const inline = source.replace('Middle.', 'Middle changed.')

function failureOf(run: () => unknown): unknown {
  try {
    run()
    return undefined
  } catch (error) {
    return error
  }
}

function containsCause(error: unknown, expected: unknown): boolean {
  const seen = new Set<unknown>()
  while (!seen.has(error)) {
    if (error === expected) return true
    seen.add(error)
    if (!error || typeof error !== 'object' || !('cause' in error)) return false
    error = error.cause
  }
  return false
}

// Each case owns only its new diagnostics; preserve any pre-existing failure.
async function scoped(
  run: () => Promise<void>,
  checking = false,
): Promise<void> {
  const before = {
    enabled: crossCheck.enabled,
    compared: crossCheck.compared,
    differences: crossCheck.differences.length,
    characters: preservationWork.characters,
  }
  crossCheck.enabled = checking
  try {
    await run()
  } finally {
    vi.restoreAllMocks()
    crossCheck.enabled = before.enabled
    crossCheck.compared = before.compared
    crossCheck.differences.splice(before.differences)
    preservationWork.characters = before.characters
  }
}

function reopens(ctx: Ctx, text: string, doc: ProseNode): void {
  expect(semanticSignature(ctx.get(parserCtx)(text))).toBe(
    semanticSignature(doc),
  )
  const reopened = new Preservation(ctx, text)
  expect(reopened.serialize(reopened.baseline)).toBe(text)
}

for (const [name, fault] of [
  ['TypeError', new TypeError('region pairing defect')],
  ['non-Error value', Object.freeze({ defect: 'region pairing sentinel' })],
] as const) {
  test(`a region pairing ${name} cannot disappear into whole-document fallback`, () =>
    scoped(() =>
      withEditor(source, (editor) => {
        const preservation = new Preservation(editor.ctx, source)
        const doc = editor.ctx.get(parserCtx)(structural)
        const pairing = vi
          .spyOn(MoveOrigins.prototype, 'pairing')
          .mockImplementationOnce(() => {
            throw fault
          })
        const whole = vi.spyOn(Reconstruction.prototype, 'writeDocument')
        const failure = failureOf(() => preservation.serialize(doc))
        expect(pairing).toHaveBeenCalled()
        expect
          .soft(
            containsCause(failure, fault),
            'original injected fault must survive',
          )
          .toBe(true)
        expect.soft(pairing).toHaveBeenCalledTimes(1)
        expect.soft(whole).not.toHaveBeenCalled()
        pairing.mockRestore()
        whole.mockRestore()
        expect(preservation.serialize(doc)).toBe(structural)
        expect(preservation.serialize(preservation.baseline)).toBe(source)
        reopens(editor.ctx, structural, doc)
      }),
    ))
}

for (const stage of ['reconstruction', 'validation'] as const) {
  test(`an unexpected region ${stage} failure does not retry the whole document`, () =>
    scoped(() =>
      withEditor(source, (editor) => {
        const preservation = new Preservation(editor.ctx, source)
        const doc = editor.ctx.get(parserCtx)(structural)
        const fault = new TypeError(`region ${stage} defect`)
        const injected =
          stage === 'reconstruction'
            ? vi
                .spyOn(Reconstruction.prototype, 'runPieces')
                .mockImplementationOnce(() => {
                  throw fault
                })
            : vi
                .spyOn(DefinitionContext.prototype, 'readsAs')
                .mockImplementationOnce(() => {
                  throw fault
                })
        const whole = vi.spyOn(Reconstruction.prototype, 'writeDocument')
        const failure = failureOf(() => preservation.serialize(doc))
        expect(injected).toHaveBeenCalled()
        expect
          .soft(
            containsCause(failure, fault),
            'original injected fault must survive',
          )
          .toBe(true)
        expect.soft(whole).not.toHaveBeenCalled()
        injected.mockRestore()
        whole.mockRestore()
        expect(preservation.serialize(doc)).toBe(structural)
        reopens(editor.ctx, structural, doc)
      }),
    ))
}

test('a carried reconstruction defect cannot retry without the carried origins', () =>
  scoped(() =>
    withEditor('* __first__\r\n\r\n+ second\r\n', (editor) => {
      const authored = '* __first__\r\n\r\n+ second\r\n'
      const expected = '+ second\r\n\r\n* __first__\r\n'
      const preservation = new Preservation(editor.ctx, authored)
      const first = preservation.baseline.child(0)
      const second = preservation.baseline.child(1)
      const doc = preservation.baseline.copy(
        Fragment.fromArray([second, first]),
      )
      const moved = new WeakSet([first])
      const fault = new TypeError('carried reconstruction defect')
      const original = Reconstruction.prototype.writeDocument
      const attempts: boolean[] = []
      let injected = 0
      const writing = vi
        .spyOn(Reconstruction.prototype, 'writeDocument')
        .mockImplementation(function (
          this: Reconstruction,
          doc,
          current,
          pairing,
        ) {
          const carries =
            pairing.carried.moved.size > 0 || pairing.carried.children
          attempts.push(carries)
          if (carries && injected++ === 0) throw fault
          return original.call(this, doc, current, pairing)
        })
      const failure = failureOf(() => preservation.serialize(doc, moved))
      expect(injected).toBe(1)
      expect
        .soft(
          containsCause(failure, fault),
          'original injected fault must survive',
        )
        .toBe(true)
      expect.soft(attempts).toEqual([true])
      writing.mockRestore()
      expect(preservation.serialize(doc, moved)).toBe(expected)
      expect(preservation.serialize(preservation.baseline)).toBe(authored)
      // Without the move record, matching canonically spells the unpaired list.
      // This different spelling also detects leaked movement.current state.
      expect(preservation.serialize(doc)).toBe(
        '- second\r\n\r\n* __first__\r\n',
      )
      reopens(editor.ctx, expected, doc)
    }),
  ))

for (const [name, fault] of [
  ['TypeError', new TypeError('whole comparison defect')],
  ['non-Error value', Object.freeze({ defect: 'whole comparison sentinel' })],
  ['ordinary Error with budget wording', new Error(tooManyBlocks().message)],
  ['spoofed budget message', new PreservationError(tooManyBlocks().message)],
  [
    'diagnostic wrapper containing a refusal',
    new PreservationError('Failed comparison', { cause: tooManyBlocks() }),
  ],
  [
    'public preservation envelope',
    new InkKitError('preservation', 'Failed comparison', {
      cause: new MarkdownParseRefusal(),
    }),
  ],
] as const) {
  test(`cross-check propagates ${name} rather than accepting or recording a refusal`, () =>
    scoped(
      () =>
        withEditor(source, (editor) => {
          const preservation = new Preservation(editor.ctx, source)
          const doc = editor.ctx.get(parserCtx)(inline)
          const localMethod = LocalEdits.prototype.localEdits
          let fastWork: number | undefined
          const local = vi
            .spyOn(LocalEdits.prototype, 'localEdits')
            .mockImplementation(function (this: LocalEdits, doc) {
              const text = localMethod.call(this, doc)
              expect(text).toBe(inline)
              fastWork = preservationWork.characters
              return text
            })
          const whole = vi
            .spyOn(Reconstruction.prototype, 'writeDocument')
            .mockImplementationOnce(() => {
              throw fault
            })
          const compared = crossCheck.compared
          const differences = [...crossCheck.differences]
          const failure = failureOf(() => preservation.serialize(doc))
          expect(local).toHaveBeenCalledTimes(1)
          expect(whole).toHaveBeenCalledTimes(1)
          expect
            .soft(
              containsCause(failure, fault),
              'original injected fault must survive',
            )
            .toBe(true)
          expect(crossCheck.compared).toBe(compared + 1)
          expect.soft(crossCheck.differences).toEqual(differences)
          expect.soft(preservationWork.characters).toBe(fastWork)
          local.mockRestore()
          whole.mockRestore()
          expect(preservation.serialize(doc)).toBe(inline)
          reopens(editor.ctx, inline, doc)
        }),
      true,
    ))
}

test('cross-check restores work when matching-budget verification itself throws', () =>
  scoped(
    () =>
      withEditor(source, (editor) => {
        const preservation = new Preservation(editor.ctx, source)
        const parse = editor.ctx.get(parserCtx)
        const doc = parse(inline)
        const localMethod = LocalEdits.prototype.localEdits
        let fastWork: number | undefined
        const local = vi
          .spyOn(LocalEdits.prototype, 'localEdits')
          .mockImplementation(function (this: LocalEdits, doc) {
            const text = localMethod.call(this, doc)
            expect(text).toBe(inline)
            fastWork = preservationWork.characters
            return text
          })
        let verifying = false
        let parserFaults = 0
        const fault = new TypeError('budget verification parser defect')
        const whole = vi
          .spyOn(Reconstruction.prototype, 'writeDocument')
          .mockImplementationOnce(() => {
            verifying = true
            throw tooManyBlocks()
          })
        editor.ctx.set(parserCtx, (text) => {
          if (verifying) {
            parserFaults++
            throw fault
          }
          return parse(text)
        })
        try {
          const compared = crossCheck.compared
          const differences = [...crossCheck.differences]
          const failure = failureOf(() => preservation.serialize(doc))
          expect(whole).toHaveBeenCalledTimes(1)
          expect(parserFaults).toBe(1)
          expect
            .soft(
              containsCause(failure, fault),
              'original injected fault must survive',
            )
            .toBe(true)
          expect(crossCheck.compared).toBe(compared + 1)
          expect.soft(crossCheck.differences).toEqual(differences)
          expect.soft(preservationWork.characters).toBe(fastWork)
        } finally {
          editor.ctx.set(parserCtx, parse)
          whole.mockRestore()
          local.mockRestore()
        }
        expect(preservation.serialize(doc)).toBe(inline)
        reopens(editor.ctx, inline, doc)
      }),
    true,
  ))

test('a matching-budget refusal still accepts a fast edit after successful reparse', () =>
  scoped(
    () =>
      withEditor(source, (editor) => {
        const preservation = new Preservation(editor.ctx, source)
        const doc = editor.ctx.get(parserCtx)(inline)
        const original = editor.ctx.get(parserCtx)
        let verifying = false
        let parses = 0
        const whole = vi
          .spyOn(Reconstruction.prototype, 'writeDocument')
          .mockImplementationOnce(() => {
            verifying = true
            throw tooManyBlocks()
          })
        editor.ctx.set(parserCtx, (text) => {
          if (verifying) parses++
          return original(text)
        })
        try {
          const differences = [...crossCheck.differences]
          expect(preservation.serialize(doc)).toBe(inline)
          expect(whole).toHaveBeenCalledTimes(1)
          expect(parses).toBeGreaterThan(0)
          expect.soft(crossCheck.differences).toEqual(differences)
        } finally {
          editor.ctx.set(parserCtx, original)
          whole.mockRestore()
        }
        reopens(editor.ctx, inline, doc)
      }),
    true,
  ))

test('a failed link-form rewrite clears its temporary state before the next save', () =>
  scoped(() =>
    withEditor('Before.\n\nhttps://example.com\n\nAfter.\n', (editor) => {
      const authored = 'Before.\n\nhttps://example.com\n\nAfter.\n'
      const expected = authored.replace(
        'https://example.com',
        '<https://example.com>',
      )
      const preservation = new Preservation(editor.ctx, authored)
      const doc = editor.ctx.get(parserCtx)(expected)
      const linkMethod = Reconstruction.prototype.withLinkEdits
      const retainMethod = LoadedSource.prototype.retainBlock
      const fault = new TypeError('link rewrite defect')
      let rewriting = false
      let injected = 0
      const links = vi
        .spyOn(Reconstruction.prototype, 'withLinkEdits')
        .mockImplementation(function <T>(
          this: Reconstruction,
          run: () => T,
        ): T {
          return linkMethod.call(this, () => {
            rewriting = true
            try {
              return run()
            } finally {
              rewriting = false
            }
          }) as T
        })
      const retain = vi
        .spyOn(LoadedSource.prototype, 'retainBlock')
        .mockImplementation(function (this: LoadedSource, ...args) {
          if (rewriting && injected++ === 0) throw fault
          return retainMethod.apply(this, args)
        })
      const failure = failureOf(() => preservation.serialize(doc))
      expect(links).toHaveBeenCalledTimes(1)
      expect(injected).toBe(1)
      expect
        .soft(
          containsCause(failure, fault),
          'original injected fault must survive',
        )
        .toBe(true)
      links.mockRestore()
      retain.mockRestore()
      expect(preservation.serialize(doc)).toBe(expected)
      expect(preservation.serialize(preservation.baseline)).toBe(authored)
      reopens(editor.ctx, expected, doc)
    }),
  ))

function select(view: EditorView, word: string): void {
  let from = -1
  view.state.doc.descendants((node, position) => {
    if (from < 0 && node.isText && node.text!.includes(word))
      from = position + node.text!.indexOf(word)
  })
  if (from < 0) throw Error(`No ${word}`)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, from, from + word.length),
    ),
  )
}

for (const [path, fault] of [
  ['local', new TypeError('local facade preservation defect')],
  ['region', new TypeError('region facade preservation defect')],
  ['later region', new TypeError('later region facade preservation defect')],
  [
    'local',
    new PreservationRefusal(
      'source-location',
      'A source token has no location',
    ),
  ],
  ['local', new MarkdownParseRefusal()],
] as const) {
  test(`a real ${path} preservation failure (${fault.message}) leaves facade state, bytes, history and events unchanged`, () =>
    scoped(async () => {
      const authored =
        '\uFEFF# Heading\r\n\r\nTarget __bold__ é👩‍💻.\r\n\r\n3) unusual\r\n\r\n<custom>untouched</custom>\r\n'
      const root = document.createElement('div')
      document.body.append(root)
      const events: string[] = []
      const editor = await InkKitEditor.mount(root, {
        changed: () => events.push('changed'),
        commandStateChanged: () => events.push('command-state'),
        error: () => events.push('error'),
      })
      try {
        editor.loadDocument({
          documentId: 'failure-recovery',
          generation: 7,
          format: 'md',
          text: authored,
        })
        const view = ctxOf(editor).get(editorViewCtx)
        select(view, 'Target')
        expect(editor.insertText('Prepared', 7)).toBe(true)
        view.dispatch(closeHistory(view.state.tr))
        select(view, 'Prepared')
        const before = editor.snapshot()
        const state = view.state
        const selection = state.selection.toJSON()
        const depth = [undoDepth(state), redoDepth(state)]
        expect(depth[0]).toBeGreaterThan(0)
        const originalPairing = MoveOrigins.prototype.pairing
        let calls = 0
        let stateAtFault: typeof state | undefined
        const injected =
          path === 'local'
            ? vi
                .spyOn(LoadedSource.prototype, 'retainBlock')
                .mockImplementationOnce(() => {
                  throw fault
                })
            : vi
                .spyOn(MoveOrigins.prototype, 'pairing')
                .mockImplementation(function (this: MoveOrigins, doc, current) {
                  if (++calls === (path === 'later region' ? 2 : 1)) {
                    stateAtFault = view.state
                    throw fault
                  }
                  return originalPairing.call(this, doc, current)
                })
        const action = () =>
          path === 'local'
            ? editor.insertText('Changed', 7)
            : editor.format(path === 'later region' ? 'taskList' : 'quote')
        events.length = 0
        const failure = failureOf(action)
        expect(injected).toHaveBeenCalled()
        if (path === 'later region') {
          expect(calls).toBeGreaterThanOrEqual(2)
          expect(stateAtFault).toBeDefined()
          expect(stateAtFault).not.toBe(state)
        }
        expect.soft(failure).toBeInstanceOf(InkKitError)
        expect.soft(failure).toMatchObject({ code: 'preservation' })
        expect
          .soft(
            containsCause(failure, fault),
            'original injected fault must survive',
          )
          .toBe(true)
        expect.soft(view.state).toBe(state)
        expect.soft(view.state.selection.toJSON()).toEqual(selection)
        expect.soft(editor.snapshot()).toEqual(before)
        expect
          .soft([undoDepth(view.state), redoDepth(view.state)])
          .toEqual(depth)
        expect.soft(events).toEqual([])
        injected.mockRestore()
        // Baseline swallowing has already failed the assertions above; recovery
        // is meaningful only after an operation actually failed atomically.
        if (failure === undefined) return
        expect(action()).toBe(true)
        const expected =
          path === 'local'
            ? before.text.replace('Prepared', 'Changed')
            : before.text.replace(
                'Prepared __bold__ é👩‍💻.',
                `${path === 'later region' ? '- [ ]' : '>'} Prepared **bold** é👩‍💻.`,
              )
        expect(editor.snapshot().text).toBe(expected)
        editor.undo()
        expect(editor.snapshot().text).toBe(before.text)
        editor.redo()
        expect(editor.snapshot().text).toBe(expected)
        editor.loadDocument({
          documentId: 'failure-reopened',
          generation: 8,
          format: 'md',
          text: expected,
        })
        expect(editor.snapshot().text).toBe(expected)
      } finally {
        vi.restoreAllMocks()
        await editor.destroy()
        root.remove()
      }
    }))
}

for (const refusal of [
  new PreservationRefusal('source-location', 'A source token has no location'),
  new MarkdownParseRefusal(),
  tooManyBlocks(),
]) {
  test(`an explicit region refusal (${refusal.message}) still tries and validates the whole document`, () =>
    scoped(() =>
      withEditor(source, (editor) => {
        const preservation = new Preservation(editor.ctx, source)
        const doc = editor.ctx.get(parserCtx)(structural)
        const region = vi
          .spyOn(Reconstruction.prototype, 'runPieces')
          .mockImplementationOnce(() => {
            throw refusal
          })
        const whole = vi.spyOn(Reconstruction.prototype, 'writeDocument')
        expect(preservation.serialize(doc)).toBe(structural)
        expect(region).toHaveBeenCalled()
        expect(whole).toHaveBeenCalledTimes(1)
        region.mockRestore()
        whole.mockRestore()
        reopens(editor.ctx, structural, doc)
      }),
    ))
}

for (const refusal of [
  new PreservationRefusal('source-location', 'A source token has no location'),
  new MarkdownParseRefusal(),
]) {
  test(`a carried reconstruction refusal (${refusal.message}) still validates a retry without carried origins`, () =>
    scoped(() =>
      withEditor('* __first__\r\n\r\n+ second\r\n', (editor) => {
        const authored = '* __first__\r\n\r\n+ second\r\n'
        const expected = '- second\r\n\r\n* __first__\r\n'
        const preservation = new Preservation(editor.ctx, authored)
        const first = preservation.baseline.child(0)
        const second = preservation.baseline.child(1)
        const doc = preservation.baseline.copy(
          Fragment.fromArray([second, first]),
        )
        const moved = new WeakSet([first])
        const original = Reconstruction.prototype.writeDocument
        const attempts: boolean[] = []
        const writing = vi
          .spyOn(Reconstruction.prototype, 'writeDocument')
          .mockImplementation(function (
            this: Reconstruction,
            doc,
            current,
            pairing,
          ) {
            const carries =
              pairing.carried.moved.size > 0 || pairing.carried.children
            attempts.push(carries)
            if (attempts.length === 1) throw refusal
            return original.call(this, doc, current, pairing)
          })
        expect(preservation.serialize(doc, moved)).toBe(expected)
        expect(attempts).toEqual([true, false])
        writing.mockRestore()
        reopens(editor.ctx, expected, doc)
        expect(preservation.serialize(doc, moved)).toBe(
          '+ second\r\n\r\n* __first__\r\n',
        )
        expect(preservation.serialize(doc)).toBe(expected)
        expect(preservation.serialize(preservation.baseline)).toBe(authored)
      }),
    ))
}

for (const refusal of [
  new PreservationRefusal('reopen-mismatch', tooManyBlocks().message),
  new MarkdownParseRefusal(),
]) {
  test(`cross-check records a non-budget refusal (${refusal.constructor.name}) as a disagreement`, () =>
    scoped(
      () =>
        withEditor(source, (editor) => {
          const preservation = new Preservation(editor.ctx, source)
          const doc = editor.ctx.get(parserCtx)(inline)
          const differences = [...crossCheck.differences]
          const compared = crossCheck.compared
          const whole = vi
            .spyOn(Reconstruction.prototype, 'writeDocument')
            .mockImplementationOnce(() => {
              throw refusal
            })
          expect(preservation.serialize(doc)).toBe(inline)
          expect(whole).toHaveBeenCalledTimes(1)
          expect(crossCheck.compared).toBe(compared + 1)
          expect(crossCheck.differences).toEqual([
            ...differences,
            JSON.stringify({
              source,
              fast: inline,
              whole: `refused: ${refusal.message}`,
            }),
          ])
          whole.mockRestore()
          reopens(editor.ctx, inline, doc)
        }),
      true,
    ))
}

test('an internal failure during view dispatch rejects the edit and reports one preservation error', () =>
  scoped(async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const errors: InkKitError[] = []
    const events: string[] = []
    const editor = await InkKitEditor.mount(root, {
      changed: () => events.push('changed'),
      commandStateChanged: () => events.push('command-state'),
      error: (error) => errors.push(error),
    })
    try {
      editor.loadDocument({
        documentId: 'dispatch-failure',
        generation: 1,
        format: 'md',
        text: source,
      })
      const view = ctxOf(editor).get(editorViewCtx)
      select(view, 'Middle')
      expect(editor.insertText('Prepared', 1)).toBe(true)
      const before = editor.snapshot()
      const state = view.state
      const depths = [undoDepth(state), redoDepth(state)]
      const commands = editor.commandState()
      const fault = new TypeError('dispatch region defect')
      const pairing = vi
        .spyOn(MoveOrigins.prototype, 'pairing')
        .mockImplementationOnce(() => {
          throw fault
        })
      const at = state.doc.child(0).nodeSize
      const paragraph = state.doc.child(1)
      const action = () =>
        view.dispatch(
          view.state.tr.replaceWith(
            at,
            at + paragraph.nodeSize,
            state.schema.nodes.blockquote!.create(null, paragraph),
          ),
        )
      events.length = 0
      action()
      expect(pairing).toHaveBeenCalledTimes(1)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({ code: 'preservation' })
      expect(containsCause(errors[0], fault)).toBe(true)
      expect(view.state).toBe(state)
      expect(editor.snapshot()).toEqual(before)
      expect([undoDepth(view.state), redoDepth(view.state)]).toEqual(depths)
      // Reverting a DOM transaction refreshes the unchanged command state.
      expect(events).toEqual(['command-state'])
      expect(editor.commandState()).toEqual(commands)
      pairing.mockRestore()
      action()
      const expected = before.text.replace('Prepared.', '> Prepared.')
      expect(editor.snapshot().text).toBe(expected)
      expect(errors).toHaveLength(1)
      editor.loadDocument({
        documentId: 'dispatch-reopened',
        generation: 2,
        format: 'md',
        text: expected,
      })
      expect(editor.snapshot().text).toBe(expected)
    } finally {
      vi.restoreAllMocks()
      await editor.destroy()
      root.remove()
    }
  }))
