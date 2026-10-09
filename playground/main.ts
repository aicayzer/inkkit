import {
  InkKitEditor,
  type TableCommand,
  type FormatCommand,
  type Heading,
} from '../src/index'
import {
  fixtures,
  configurations,
  ControlledImages,
  ControlledFiles,
  imageBytes,
  type AdapterMode,
} from '../scripts/interop/consumer/fixtures'
import '../src/style.css'
import './style.css'

const params = new URLSearchParams(location.search)
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T
let fixtureId = params.get('fixture') ?? 'everyday'
let configuration = params.get('configuration') ?? 'rich'
let adapterMode = (params.get('adapter') ?? 'normal') as AdapterMode
if (!fixtures[fixtureId]) throw Error(`Unknown fixture: ${fixtureId}`)
if (!configurations.includes(configuration as (typeof configurations)[number]))
  throw Error(`Unknown configuration: ${configuration}`)
if (!['normal', 'reject', 'hold'].includes(adapterMode))
  throw Error(`Unknown adapter: ${adapterMode}`)
for (const [id, fixture] of Object.entries(fixtures)) {
  const option = document.createElement('option')
  option.value = id
  option.textContent = fixture.label
  element<HTMLSelectElement>('fixture').append(option)
}
const tableCommands: TableCommand[] = [
  'insert',
  'addRowBefore',
  'addRowAfter',
  'addColumnBefore',
  'addColumnAfter',
  'deleteRow',
  'deleteColumn',
  'deleteTable',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'sortRows',
  'exit',
]
for (const command of tableCommands) {
  const option = document.createElement('option')
  option.value = command
  option.textContent = command
  element<HTMLSelectElement>('table-action').append(option)
}
let editor: InkKitEditor
let secondEditor: InkKitEditor | undefined
let images = new ControlledImages()
let files = new ControlledFiles()
let pendingOutput: Promise<{ value?: unknown; error?: unknown }> | undefined
let generation = 0
let mountEpoch = 0
let headings: readonly Heading[] = []
let pendingImage: Promise<void> | undefined
let diagnostics: { code: string | null; message: string }[] = []
let lastResult: unknown = null
let searchSnapshot: ReturnType<InkKitEditor['textSnapshot']> | undefined
let searchRange: Parameters<InkKitEditor['selectTextRange']>[0] | undefined
function record(error: unknown) {
  const entry = {
    code: error instanceof Error && 'code' in error ? String(error.code) : null,
    message: error instanceof Error ? error.message : String(error),
  }
  diagnostics.push(entry)
  element<HTMLOutputElement>('status').value = entry.message
}
function selectedText() {
  const root = element('editor')
  const plain = root.querySelector('textarea')
  if (editor.editingMode === 'source' && plain instanceof HTMLTextAreaElement)
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
  let snapshot, snapshotError
  try {
    snapshot = editor.snapshot(generation)
  } catch (error) {
    snapshotError = {
      message: String(error),
      code: error instanceof Error && 'code' in error ? error.code : null,
    }
  }
  let commandState, commandStateError
  try {
    commandState = editor.commandState(generation)
  } catch (error) {
    commandStateError = String(error)
  }
  let textSnapshot, textSnapshotError
  try {
    textSnapshot = editor.textSnapshot()
  } catch (error) {
    textSnapshotError = String(error)
  }
  return {
    fixture: fixtureId,
    configuration,
    adapterMode,
    snapshot: snapshot ?? null,
    snapshotError: snapshotError ?? null,
    selectedText: selectedText(),
    mode: editor.editingMode,
    editable: editor.editable,
    commandState: commandState ?? null,
    commandStateError: commandStateError ?? null,
    textSnapshot: textSnapshot ?? null,
    textSnapshotError: textSnapshotError ?? null,
    viewport: editor.viewport(),
    secondTextSnapshot: secondEditor?.textSnapshot() ?? null,
    adapterEvents: [...images.events],
    fileEvents: [...files.events],
    diagnostics: [...diagnostics],
    lastResult,
  }
}
function updateControls() {
  if (!editor) return
  const observation = observe()
  element('observations').textContent = JSON.stringify(observation, null, 2)
  element('editing-mode').textContent =
    editor.editingMode === 'source' ? 'Edit formatted' : 'Edit source'
  element('read-only').textContent = editor.editable
    ? 'Make read-only'
    : 'Make editable'
  const state = observation.commandState
  if (state) {
    for (const [id, enabled] of Object.entries({
      bold: state.commands.format.bold,
      table: state.commands.table.insert,
      undo: state.commands.undo,
      redo: state.commands.redo,
      replace: state.commands.replace,
      'replace-all': state.commands.replace,
      'import-image': state.commands.paste && configuration === 'rich',
      plain: state.commands.paste,
      'apply-table':
        state.commands.table[
          element<HTMLSelectElement>('table-action').value as TableCommand
        ],
    }))
      element<HTMLButtonElement>(id).disabled = !enabled
    element<HTMLButtonElement>('editing-mode').disabled = state.format === 'txt'
  }
  try {
    headings = editor.headings(generation)
  } catch {
    headings = []
  }
  const select = element<HTMLSelectElement>('headings')
  const selected = select.value
  select.replaceChildren()
  for (const heading of headings) {
    const option = document.createElement('option')
    option.value = heading.id
    option.textContent = `${'  '.repeat(heading.level - 1)}${heading.text || 'Untitled heading'}`
    select.append(option)
  }
  if (headings.some((heading) => heading.id === selected))
    select.value = selected
  select.disabled = !headings.length
  element<HTMLButtonElement>('navigate-heading').disabled = !headings.length
  if (!diagnostics.length && observation.snapshot)
    element<HTMLOutputElement>('status').value =
      `${observation.snapshot.documentId}, generation ${generation}, revision ${observation.snapshot.revision}, ${observation.snapshot.dirty ? 'Unsaved changes' : 'Unchanged'}`
}
function load(
  text: string,
  format: 'md' | 'txt',
  documentId = `fixture:${fixtureId}`,
) {
  editor.loadDocument({ documentId, generation: ++generation, format, text })
  updateControls()
  return observe()
}
async function reset(
  nextFixture = fixtureId,
  nextConfiguration = configuration,
) {
  if (!fixtures[nextFixture]) throw Error(`Unknown fixture: ${nextFixture}`)
  if (
    !configurations.includes(
      nextConfiguration as (typeof configurations)[number],
    )
  )
    throw Error(`Unknown configuration: ${nextConfiguration}`)
  const epoch = ++mountEpoch
  if (editor) await editor.destroy()
  if (secondEditor) {
    await secondEditor.destroy()
    secondEditor = undefined
  }
  images.dispose()
  files.dispose()
  images = new ControlledImages()
  files = new ControlledFiles()
  pendingOutput = undefined
  pendingImage = undefined
  diagnostics = []
  lastResult = null
  searchSnapshot = undefined
  searchRange = undefined
  fixtureId = nextFixture
  configuration = nextConfiguration
  images.setMode('import', adapterMode)
  images.setMode('export', adapterMode)
  files.setMode(adapterMode)
  const update = () => {
    if (epoch === mountEpoch)
      queueMicrotask(() => {
        if (epoch === mountEpoch) updateControls()
      })
  }
  editor = await InkKitEditor.mount(
    element('editor'),
    {
      changed: update,
      stateChanged: update,
      commandStateChanged: update,
      openLink: (href) => {
        lastResult = href
        update()
      },
      copy: (text) => {
        void navigator.clipboard.writeText(text).catch(record)
      },
      error: (error) => {
        if (epoch === mountEpoch) {
          record(error)
          update()
        }
      },
    },
    {
      images: configuration === 'rich' ? images.adapter : undefined,
      files:
        configuration === 'rich' &&
        (fixtureId === 'linked-files' || params.get('files') === 'true')
          ? files.adapter
          : undefined,
      wikiLinks:
        configuration === 'rich' &&
        (fixtureId === 'linked-files' || params.get('files') === 'true')
          ? files.wiki
          : undefined,
      editable: params.get('editable') !== 'false',
      textInput:
        configuration === 'rich'
          ? { spellcheck: false, autocorrect: false, autocapitalize: 'off' }
          : undefined,
    },
  )
  const fixture = fixtures[fixtureId]!
  load(fixture.text, fixture.format)
  for (const [id, value] of Object.entries({
    fixture: fixtureId,
    configuration,
    adapter: adapterMode,
  }))
    element<HTMLSelectElement>(id).value = value
  if (params.get('editors') === '2') {
    element('second-editor').hidden = false
    secondEditor = await InkKitEditor.mount(
      element('second-editor'),
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
  updateControls()
  return observe()
}
async function operation(name: string, args: Record<string, unknown> = {}) {
  const operationEpoch = mountEpoch
  let result: unknown
  try {
    const target = args.instance === 'second' ? secondEditor : editor
    if (!target) throw Error('Requested editor instance is not mounted')
    switch (name) {
      case 'textSnapshot':
        result = target.textSnapshot()
        break
      case 'selectTextRange':
        result = target.selectTextRange(
          args.range as Parameters<InkKitEditor['selectTextRange']>[0],
          args.options as Parameters<InkKitEditor['selectTextRange']>[1],
        )
        break
      case 'revealTextRange':
        result = target.revealTextRange(
          args.range as Parameters<InkKitEditor['revealTextRange']>[0],
        )
        break
      case 'replaceTextRange':
        result = target.replaceTextRange(
          args.range as Parameters<InkKitEditor['replaceTextRange']>[0],
          String(args.text),
        )
        break
      case 'textRangeRects':
        result = target.textRangeRects(
          args.range as Parameters<InkKitEditor['textRangeRects']>[0],
        )
        break
      case 'visibleTextRanges':
        result = target.visibleTextRanges(String(args.snapshotId))
        break
      case 'setViewport':
        result = target.setViewport({
          insets: args.insets as Parameters<
            InkKitEditor['setViewport']
          >[0]['insets'],
        })
        break
      case 'viewport':
        result = target.viewport()
        break
      case 'reload': {
        const snapshot = target.snapshot()
        if (target === editor && args.sameGeneration !== true) generation += 1
        target.reloadDocument({
          documentId: snapshot.documentId,
          generation: target === editor ? generation : snapshot.generation + 1,
          format: snapshot.format,
          text: args.text === undefined ? snapshot.text : String(args.text),
        })
        break
      }
      case 'format':
        result = editor.format(
          args.command as FormatCommand,
          args.arg as string | number | undefined,
        )
        break
      case 'table':
        result = editor.table(
          args.command as TableCommand,
          args.options as Parameters<InkKitEditor['table']>[1],
        )
        break
      case 'editingMode':
        result = editor.setEditingMode(
          args.mode as 'source' | 'formatted',
          generation,
        )
        break
      case 'editable':
        result = editor.setEditable(Boolean(args.editable))
        break
      case 'textInput':
        result = editor.setTextInputPreferences(
          args.preferences as Parameters<
            InkKitEditor['setTextInputPreferences']
          >[0],
        )
        break
      case 'keymap':
        result = editor.setKeymap(
          args.keymap as Parameters<InkKitEditor['setKeymap']>[0],
        )
        break
      case 'focus':
        editor.focus()
        break
      case 'insertText':
        result = editor.insertText(String(args.text), generation)
        break
      case 'replaceSource':
        result = editor.replaceSource(String(args.text), generation)
        break
      case 'undo':
        result = editor.undo(generation)
        break
      case 'redo':
        result = editor.redo(generation)
        break
      case 'find':
        editor.find(String(args.text), generation)
        editor.focus()
        break
      case 'replace':
        result = editor.replace(
          String(args.search),
          String(args.replacement),
          generation,
        )
        break
      case 'replaceAll':
        result = editor.replaceAll(
          String(args.search),
          String(args.replacement),
          generation,
        )
        break
      case 'headings':
        result = editor.headings(generation)
        break
      case 'navigateHeading':
        result = editor.navigateHeading(args.heading as Heading)
        break
      case 'clipboard':
        result = await editor.clipboardSnapshot(args.all !== false)
        break
      case 'printable':
        result = await editor.printableSnapshot(generation)
        break
      case 'paste':
        await editor.paste(args.input as Parameters<InkKitEditor['paste']>[0])
        break
      case 'pastePlain':
        editor.pasteAsPlainText(String(args.text))
        break
      case 'commandState':
        result = editor.commandState(args.generation as number | undefined)
        break
      case 'startImagePaste': {
        const epoch = mountEpoch
        pendingImage = editor
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
          .catch((error) => {
            if (epoch === mountEpoch) record(error)
          })
        result = { pending: true }
        break
      }
      case 'fileMode':
        files.setMode(args.mode as AdapterMode)
        break
      case 'fileRelease':
        files.release()
        break
      case 'fileEvents':
        result = [...files.events]
        break
      case 'startOutput':
        pendingOutput = (
          args.kind === 'print'
            ? editor.printableSnapshot()
            : editor.clipboardSnapshot()
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        result = { pending: true }
        break
      case 'finishOutput': {
        if (!pendingOutput) throw Error('No output is pending')
        const completed = await pendingOutput
        pendingOutput = undefined
        if (completed.error) throw completed.error
        result = completed.value
        break
      }
      case 'finishImagePaste':
        images.release('import')
        if (!pendingImage) throw Error('No image paste is pending')
        await pendingImage
        pendingImage = undefined
        break
      default:
        throw Error(`Unknown public operation: ${name}`)
    }
    if (operationEpoch === mountEpoch) lastResult = result ?? null
  } catch (error) {
    if (operationEpoch === mountEpoch) record(error)
    throw error
  } finally {
    updateControls()
  }
  return result ?? null
}
async function act(action: () => unknown) {
  try {
    await action()
  } catch (error) {
    if (
      diagnostics.at(-1)?.message !==
      String(error instanceof Error ? error.message : error)
    )
      record(error)
  }
  updateControls()
}
const click = (id: string, action: () => unknown) =>
  element(id).addEventListener('click', () => {
    void act(action)
  })
click('reset', () => reset())
click('replace-document', () =>
  load(
    '# Replacement document\n\nDisposable replacement.\n',
    'md',
    'replacement',
  ),
)
click('read-only', () => operation('editable', { editable: !editor.editable }))
click('release', () => {
  files.release()
  images.release('import')
  images.release('export')
})
click('import-image', () => operation('startImagePaste'))
click('bold', () => operation('format', { command: 'bold' }))
click('table', () => operation('table', { command: 'insert' }))
click('plain', async () =>
  operation('pastePlain', { text: await navigator.clipboard.readText() }),
)
click('source', async () =>
  navigator.clipboard.writeText(editor.snapshot(generation).text),
)
click('copy-readable', async () => {
  const data = await editor.clipboardSnapshot()
  await navigator.clipboard.writeText(data.text)
})
click('printable', () => operation('printable'))
click('editing-mode', async () => {
  await operation('editingMode', {
    mode: editor.editingMode === 'source' ? 'formatted' : 'source',
  })
  editor.focus()
})
click('mode', () => {
  const snapshot = editor.snapshot(generation)
  return load(snapshot.text, snapshot.format === 'md' ? 'txt' : 'md')
})
click('undo', () => operation('undo'))
click('redo', () => operation('redo'))
click('apply-table', () =>
  operation('table', {
    command: element<HTMLSelectElement>('table-action').value,
    options: {
      comparison: element<HTMLSelectElement>('comparison').value,
      order: element<HTMLSelectElement>('sort-order').value,
    },
  }),
)
const query = () => element<HTMLInputElement>('query').value
const replacement = () => element<HTMLInputElement>('replacement').value
click('find', () => operation('find', { text: query() }))
click('replace', () =>
  operation('replace', { search: query(), replacement: replacement() }),
)
click('replace-all', () =>
  operation('replaceAll', { search: query(), replacement: replacement() }),
)
click('capture-text', async () => {
  searchSnapshot = (await operation('textSnapshot')) as ReturnType<
    InkKitEditor['textSnapshot']
  >
  const from = searchSnapshot.text.indexOf(query())
  if (from < 0)
    throw Error('Search text is not present in the readable snapshot')
  searchRange = {
    snapshotId: searchSnapshot.snapshotId,
    from,
    to: from + query().length,
  }
})
click('select-range', () => {
  if (!searchRange) throw Error('Capture a matching text range first')
  return operation('selectTextRange', {
    range: searchRange,
    options: { focus: true, reveal: true },
  })
})
click('replace-range', () => {
  if (!searchRange) throw Error('Capture a matching text range first')
  return operation('replaceTextRange', {
    range: searchRange,
    text: replacement(),
  })
})
click('range-rects', () => {
  if (!searchRange) throw Error('Capture a matching text range first')
  return operation('textRangeRects', { range: searchRange })
})
click('viewport-insets', () =>
  operation('setViewport', {
    insets: {
      top: Number(element<HTMLInputElement>('inset-top').value),
      bottom: Number(element<HTMLInputElement>('inset-bottom').value),
    },
  }),
)
click('navigate-heading', () =>
  operation('navigateHeading', {
    heading: headings.find(
      (heading) => heading.id === element<HTMLSelectElement>('headings').value,
    ),
  }),
)
element('fixture').addEventListener('change', () => {
  void act(() => reset(element<HTMLSelectElement>('fixture').value))
})
element('configuration').addEventListener('change', () => {
  void act(() =>
    reset(fixtureId, element<HTMLSelectElement>('configuration').value),
  )
})
element('adapter').addEventListener('change', () => {
  adapterMode = element<HTMLSelectElement>('adapter').value as AdapterMode
  images.setMode('import', adapterMode)
  images.setMode('export', adapterMode)
  files.setMode(adapterMode)
  updateControls()
})
element('table-action').addEventListener('change', updateControls)
export const playground = {
  fixtures: Object.keys(fixtures),
  configurations,
  reset,
  selectFixture: reset,
  replaceDocument: load,
  operation,
  observe,
  adapter: {
    setMode: (kind: 'import' | 'export', mode: AdapterMode) => {
      images.setMode(kind, mode)
      updateControls()
    },
    release: (kind: 'import' | 'export') => {
      images.release(kind)
      updateControls()
    },
  },
}
declare global {
  interface Window {
    inkkitPlayground: typeof playground
  }
}
window.inkkitPlayground = playground
await reset()
