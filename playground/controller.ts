import { InkKitEditor } from '../src/index'
import { observeAdapter } from './adapters'
import {
  fixtures,
  configurations,
  ControlledImages,
  ControlledFiles,
  imageBytes,
  type AdapterMode,
} from '../scripts/interop/consumer/fixtures'
import { readSetup, validateSetup, setupURL, type Setup } from './configuration'
import {
  diagnostic,
  serialise,
  type Diagnostic,
  type OperationRecord,
} from './evidence'
import {
  describeOperations,
  executeOperation,
  type OperationContext,
} from './operations'
export type { Setup } from './configuration'

type Lifecycle = 'initialising' | 'ready' | 'resetting' | 'error'
type PendingOutput = {
  promise: Promise<{ value?: unknown; error?: unknown }>
  kind: 'print' | 'clipboard'
}
export function createPlayground(root: HTMLElement, secondRoot: HTMLElement) {
  let setup = readSetup('')
  let desiredSetup = setup
  let editor: InkKitEditor | undefined
  let secondEditor: InkKitEditor | undefined
  let lifecycle: Lifecycle = 'initialising'
  let lifecycleError: Diagnostic | null = null
  let generation = 0
  let epoch = 0
  let resetQueue: Promise<unknown> = Promise.resolve()
  let images = new ControlledImages()
  let files = new ControlledFiles()
  let pendingImage: Promise<void> | undefined
  let imageRecord: OperationRecord | undefined
  let outputRecord: OperationRecord | undefined
  let pendingOutput: PendingOutput | undefined
  let diagnostics: Diagnostic[] = []
  let lastResult: unknown = null
  let outputs: { clipboard?: unknown; printable?: unknown } = {}
  let records: OperationRecord[] = []
  let sequence = 0
  let droppedOperations = 0
  let frame: number | undefined
  const listeners = new Set<() => void>()
  function notify() {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      for (const listener of listeners) listener()
    })
  }
  function reportError(error: unknown) {
    const entry = diagnostic(error)
    if (diagnostics.at(-1)?.message !== entry.message) diagnostics.push(entry)
    notify()
  }
  function syncURL() {
    history.replaceState(null, '', setupURL(setup, location.href))
  }
  function read<T>(fn: () => T): { value: T | null; error: Diagnostic | null } {
    if (lifecycle !== 'ready') return { value: null, error: null }
    try {
      return { value: fn(), error: null }
    } catch (error) {
      return { value: null, error: diagnostic(error) }
    }
  }
  function selectedText() {
    if (!editor) return ''
    const plain = root.querySelector('textarea')
    if (editor.editingMode === 'source' && plain)
      return plain.value.slice(plain.selectionStart, plain.selectionEnd)
    const selection = getSelection()
    return selection?.anchorNode &&
      selection.focusNode &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode)
      ? selection.toString()
      : ''
  }
  function observe() {
    const snapshot = read(() => editor!.snapshot(generation))
    const command = read(() => editor!.commandState(generation))
    const text = read(() => editor!.textSnapshot())
    const viewport = read(() => editor!.viewport())
    const second = read(() => secondEditor?.textSnapshot() ?? null)
    const selection = read(selectedText)
    const heads = read(() => editor!.headings(generation))
    return {
      fixture: setup.fixture,
      configuration: setup.configuration,
      adapterMode: setup.adapterMode,
      setup: { ...setup },
      desiredSetup: { ...desiredSetup },
      lifecycle,
      lifecycleError,
      snapshot: snapshot.value,
      snapshotError: snapshot.error,
      selectedText: selection.value ?? '',
      selectionError: selection.error,
      mode: read(() => editor!.editingMode).value,
      editable: read(() => editor!.editable).value,
      commandState: command.value,
      commandStateError: command.error?.message ?? null,
      textSnapshot: text.value,
      textSnapshotError: text.error?.message ?? null,
      viewport: viewport.value,
      viewportError: viewport.error,
      secondTextSnapshot: second.value,
      secondTextSnapshotError: second.error,
      heads: heads.value ?? [],
      headingsError: heads.error,
      adapterEvents: [...images.events],
      fileEvents: [...files.events],
      diagnostics: [...diagnostics],
      lastResult,
      operations: records.map((record) => ({ ...record })),
      droppedOperations,
      outputs: { ...outputs },
    }
  }
  function requireEditor() {
    if (lifecycle !== 'ready' || !editor)
      throw Error(`Playground is ${lifecycle}`)
    return editor
  }
  function addRecord(name: string, args: Record<string, unknown>) {
    const record: OperationRecord = {
      sequence: ++sequence,
      name,
      args: structuredClone(args),
      generation,
      status: 'pending',
    }
    records.push(record)
    if (records.length > 200) {
      records.shift()
      droppedOperations++
    }
    notify()
    return record
  }
  function complete(
    record: OperationRecord,
    ticket: number,
    result: unknown,
    error?: unknown,
  ) {
    if (ticket !== epoch) {
      record.status = 'cancelled'
      return
    }
    if (error !== undefined) {
      record.status = 'error'
      record.error = diagnostic(error)
      reportError(error)
    } else {
      record.status = 'success'
      record.result = result ?? null
    }
    notify()
  }
  function cancelPending() {
    for (const record of records)
      if (record.status === 'pending') record.status = 'cancelled'
  }
  function setEditable(value: boolean) {
    requireEditor().setEditable(value)
    setup = { ...setup, editable: value }
    desiredSetup = { ...desiredSetup, editable: value }
    syncURL()
  }
  function changeAdapter(kind: 'import' | 'export', mode: AdapterMode) {
    const key = kind === 'import' ? 'imageImport' : 'imageExport'
    const next = validateSetup({ ...desiredSetup, [key]: mode })
    if (lifecycle !== 'ready') {
      void schedule(next).catch(reportError)
      return
    }
    setup = next
    desiredSetup = next
    images.setMode(kind, mode)
    syncURL()
    notify()
  }
  function changeFileMode(mode: AdapterMode) {
    const next = validateSetup({ ...desiredSetup, fileAdapter: mode })
    if (lifecycle !== 'ready') {
      void schedule(next).catch(reportError)
      return
    }
    setup = next
    desiredSetup = next
    files.setMode(mode)
    syncURL()
    notify()
  }
  async function remount(next: Setup, ticket: number) {
    if (ticket !== epoch) return observe()
    try {
      images.dispose()
      files.dispose()
      if (editor) await editor.destroy()
      editor = undefined
      if (secondEditor) await secondEditor.destroy()
      secondEditor = undefined
      if (ticket !== epoch) return observe()
      setup = next
      images = new ControlledImages()
      files = new ControlledFiles()
      images.setMode('import', setup.imageImport)
      images.setMode('export', setup.imageExport)
      files.setMode(setup.fileAdapter)
      pendingImage = undefined
      imageRecord = undefined
      outputRecord = undefined
      pendingOutput = undefined
      diagnostics = []
      lastResult = null
      outputs = {}
      records = []
      droppedOperations = 0
      sequence = 0
      const update = () => {
        if (ticket === epoch) notify()
      }
      const sessionImages = images
      const sessionFiles = files
      const adapterChanged = () => {
        if (ticket === epoch) notify()
        else {
          // A fixture may finish resolving after its host stopped using it.
          sessionImages.dispose()
          sessionFiles.dispose()
        }
      }
      const candidate = await InkKitEditor.mount(
        root,
        {
          changed: update,
          stateChanged: update,
          commandStateChanged: update,
          openLink: (href) => {
            if (ticket === epoch) {
              lastResult = href
              notify()
            }
          },
          copy: (text) => {
            void navigator.clipboard.writeText(text).catch((error) => {
              if (ticket === epoch) reportError(error)
            })
          },
          error: (error) => {
            if (ticket === epoch) reportError(error)
          },
        },
        {
          images:
            setup.configuration === 'rich'
              ? observeAdapter(sessionImages.adapter, adapterChanged)
              : undefined,
          rendering:
            setup.configuration === 'minimal'
              ? { codeHighlighting: false, diagramPreview: false }
              : undefined,
          files:
            setup.configuration === 'rich' &&
            (setup.fixture === 'linked-files' || setup.files)
              ? observeAdapter(sessionFiles.adapter, adapterChanged)
              : undefined,
          wikiLinks:
            setup.configuration === 'rich' &&
            (setup.fixture === 'linked-files' || setup.files)
              ? observeAdapter(sessionFiles.wiki, adapterChanged)
              : undefined,
          editable: setup.editable,
          textInput:
            setup.configuration === 'rich'
              ? { spellcheck: false, autocorrect: false, autocapitalize: 'off' }
              : undefined,
        },
      )
      if (ticket !== epoch) {
        await candidate.destroy()
        return observe()
      }
      editor = candidate
      const fixture = fixtures[setup.fixture]!
      editor.loadDocument({
        documentId: `fixture:${setup.fixture}`,
        generation: ++generation,
        format: fixture.format,
        text: fixture.text,
      })
      secondRoot.hidden = setup.editors !== 2
      if (setup.editors === 2) {
        secondEditor = await InkKitEditor.mount(
          secondRoot,
          { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
          { editable: false },
        )
        secondEditor.loadDocument({
          documentId: 'second',
          generation: 1,
          format: 'md',
          text: '# Independent fixture\n\nIndependent content.\n',
        })
      }
      if (ticket !== epoch) return observe()
      lifecycle = 'ready'
      lifecycleError = null
      syncURL()
      notify()
      return observe()
    } catch (error) {
      if (ticket === epoch) {
        lifecycle = 'error'
        lifecycleError = diagnostic(error)
        reportError(error)
      }
      throw error
    }
  }
  function schedule(next: Setup) {
    desiredSetup = next
    const ticket = ++epoch
    lifecycle = 'resetting'
    lifecycleError = null
    cancelPending()
    notify()
    const result = resetQueue.then(() => remount(next, ticket))
    resetQueue = result.catch(() => {})
    return result
  }
  async function reset(
    nextFixture = desiredSetup.fixture,
    nextConfiguration: string = desiredSetup.configuration,
  ) {
    return schedule(
      validateSetup({
        ...desiredSetup,
        fixture: nextFixture,
        configuration: nextConfiguration as Setup['configuration'],
      }),
    )
  }
  async function configure(patch: Partial<Setup>) {
    const next = validateSetup({
      ...desiredSetup,
      ...(patch.adapterMode
        ? {
            imageImport: patch.adapterMode,
            imageExport: patch.adapterMode,
            fileAdapter: patch.adapterMode,
          }
        : {}),
      ...patch,
    })
    if (
      lifecycle !== 'ready' ||
      (['fixture', 'configuration', 'files', 'editors'] as const).some(
        (key) => next[key] !== setup[key],
      )
    )
      return schedule(next)
    const record = addRecord('configure', patch)
    try {
      if (next.editable !== setup.editable) setEditable(next.editable)
      if (next.imageImport !== setup.imageImport)
        images.setMode('import', next.imageImport)
      if (next.imageExport !== setup.imageExport)
        images.setMode('export', next.imageExport)
      if (next.fileAdapter !== setup.fileAdapter)
        files.setMode(next.fileAdapter)
      setup = desiredSetup = next
      syncURL()
      complete(record, epoch, null)
      return observe()
    } catch (error) {
      complete(record, epoch, null, error)
      throw error
    }
  }
  async function initialise() {
    let initial: Setup
    try {
      initial = readSetup(location.search)
    } catch (error) {
      lifecycle = 'error'
      lifecycleError = diagnostic(error)
      reportError(error)
      return observe()
    }
    return schedule(initial).catch(() => observe())
  }
  function replaceDocument(
    text: string,
    format: 'md' | 'txt',
    documentId = `fixture:${setup.fixture}`,
  ) {
    const record = addRecord('replaceDocument', { text, format, documentId })
    try {
      const current = requireEditor()
      current.loadDocument({
        documentId,
        generation: generation + 1,
        format,
        text,
      })
      generation++
      complete(record, epoch, null)
      return observe()
    } catch (error) {
      complete(record, epoch, null, error)
      throw error
    }
  }
  async function operation(name: string, args: Record<string, unknown> = {}) {
    const ticket = epoch
    const record = addRecord(name, args)
    let deferred = false
    try {
      const current = requireEditor()
      const target = args.instance === 'second' ? secondEditor : current
      if (!target) throw Error('Requested editor instance is not mounted')
      const context: OperationContext = {
        editor: current,
        target,
        generation,
        reload: (options) => {
          const snapshot = target.snapshot()
          const nextGeneration =
            target === current
              ? options.sameGeneration === true
                ? generation
                : generation + 1
              : snapshot.generation + 1
          target.reloadDocument({
            documentId: snapshot.documentId,
            generation: nextGeneration,
            format: snapshot.format,
            text:
              options.text === undefined ? snapshot.text : String(options.text),
          })
          if (target === current) generation = nextGeneration
        },
        editable: setEditable,
        fileMode: changeFileMode,
        fileRelease: () => files.release(),
        fileEvents: () => [...files.events],
        startImagePaste: () => {
          if (imageRecord?.status === 'pending')
            throw Error(
              'An image paste is already started; finish it before starting another',
            )
          deferred = true
          imageRecord = record
          pendingImage = current
            .paste({
              text: '',
              images: [
                {
                  bytes: imageBytes(),
                  mimeType: 'image/png',
                  filename: 'fixture.png',
                },
              ],
            })
            .then(
              () => complete(record, ticket, null),
              (error) => complete(record, ticket, null, error),
            )
          return { pending: true }
        },
        finishImagePaste: async () => {
          images.release('import')
          const pending = pendingImage
          if (!pending) throw Error('No image paste is pending')
          await pending
          if (ticket === epoch && pendingImage === pending)
            pendingImage = undefined
        },
        startOutput: (kind) => {
          if (outputRecord?.status === 'pending')
            throw Error(
              'An output is already started; finish it before starting another',
            )
          deferred = true
          outputRecord = record
          const promise = (
            kind === 'print'
              ? current.printableSnapshot()
              : current.clipboardSnapshot()
          ).then(
            (value) => {
              if (ticket === epoch)
                outputs[kind === 'print' ? 'printable' : 'clipboard'] = value
              complete(record, ticket, value)
              return { value }
            },
            (error) => {
              complete(record, ticket, null, error)
              return { error }
            },
          )
          pendingOutput = { kind, promise }
          return { pending: true }
        },
        finishOutput: async () => {
          const pending = pendingOutput
          if (!pending) throw Error('No output is pending')
          const completed = await pending.promise
          if (ticket === epoch && pendingOutput === pending)
            pendingOutput = undefined
          if (completed.error) throw completed.error
          return completed.value
        },
      }
      const result = await executeOperation(name, context, args)
      if (ticket !== epoch) {
        record.status = 'cancelled'
        throw Error('Operation cancelled by playground reset')
      }
      lastResult = result ?? null
      if (name === 'clipboard' || name === 'printable') outputs[name] = result
      if (!deferred) complete(record, ticket, result)
      return result ?? null
    } catch (error) {
      complete(record, ticket, null, error)
      throw error
    } finally {
      notify()
    }
  }
  const api = {
    fixtures: Object.keys(fixtures),
    configurations,
    reset,
    selectFixture: reset,
    replaceDocument,
    operation,
    observe,
    configure,
    describe: () => ({
      fixtures: Object.entries(fixtures).map(([id, fixture]) => ({
        id,
        label: fixture.label,
        format: fixture.format,
      })),
      configurations,
      defaults: readSetup(''),
      adapterModes: {
        imageImport: ['normal', 'reject', 'hold'],
        imageExport: ['normal', 'reject', 'hold', 'corrupt'],
        fileAdapter: ['normal', 'reject', 'hold', 'corrupt'],
      },
      operations: describeOperations(),
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reportError,
    captureEvidence: () =>
      serialise({
        version: 1,
        url: location.href,
        setup: { ...setup },
        desiredSetup: { ...desiredSetup },
        observations: observe(),
        operations: records,
        droppedOperations,
        outputs,
      }),
    adapter: {
      setMode: changeAdapter,
      release: (kind: 'import' | 'export') => {
        images.release(kind)
        notify()
      },
    },
  }
  return { api, initialise }
}
export type Playground = ReturnType<typeof createPlayground>['api']
export type Observation = ReturnType<Playground['observe']>
