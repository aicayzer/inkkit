import {
  InkKitEditor,
  type ClipboardScope,
  type CommandState,
  type FindSession,
  type FindState,
  type TableCommand,
  type FormatCommand,
  type Heading,
  type DocumentFormat,
  type RichTextDocument,
  type TextDocumentSnapshot,
} from '../src/index'
import {
  allFixtures as fixtures,
  configurations,
  ControlledImages,
  ControlledFiles,
  imageBytes,
  type AdapterMode,
} from '../scripts/interop/consumer/fixtures'
import { generateDocument, parseGenerate, type GenerateSpec } from './generate'
import '../src/style.css'
import '../src/themes/standard.css'
import '../src/themes/calm.css'
import '../src/themes/essential.css'
import './style.css'

const params = new URLSearchParams(location.search)
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T
// A bad query parameter must leave a usable page, so each one is reported on
// the page and replaced by its default instead of throwing at module load.
const startupProblems: string[] = []
function choose(name: string, valid: readonly string[], fallback: string) {
  const value = params.get(name)
  if (value === null) return fallback
  if (valid.includes(value)) return value
  startupProblems.push(
    `Unknown ${name} "${value}". Using "${fallback}". Valid values: ${valid.join(', ')}.`,
  )
  return fallback
}
let fixtureId = choose('fixture', Object.keys(fixtures), 'everyday')
let configuration = choose('configuration', configurations, 'rich')
let theme = choose(
  'theme',
  ['default', 'standard', 'calm', 'essential'],
  'default',
)
let appearance = choose('appearance', ['system', 'light', 'dark'], 'system')
function applyAppearance() {
  const editors = element('editors')
  if (theme === 'default') delete editors.dataset.inkkitTheme
  else editors.dataset.inkkitTheme = theme
  document.documentElement.style.colorScheme =
    appearance === 'system' ? 'light dark' : appearance
  editors.style.setProperty(
    '--inkkit-color-scheme',
    appearance === 'system' ? 'light dark' : appearance,
  )
  element<HTMLSelectElement>('theme').value = theme
  element<HTMLSelectElement>('appearance').value = appearance
}
applyAppearance()
let adapterMode = choose(
  'adapter',
  ['normal', 'reject', 'hold'],
  'normal',
) as AdapterMode
let generated: GenerateSpec | undefined
const generateParam = params.get('generate')
if (generateParam !== null)
  try {
    generated = parseGenerate(generateParam)
  } catch (error) {
    startupProblems.push(String(error instanceof Error ? error.message : error))
  }
// What the URL can carry besides the fixture, configuration and adapter.
const settings = {
  editable: params.get('editable') !== 'false',
  editors: params.get('editors') === '2',
  files: params.get('files') === 'true',
}
let observing = params.get('observe') === 'true'
let urlReady = false
function syncUrl() {
  if (!urlReady) return
  const url = new URL(location.href)
  const write = (name: string, value: string, fallback: string) =>
    value === fallback
      ? url.searchParams.delete(name)
      : url.searchParams.set(name, value)
  write('fixture', fixtureId, 'everyday')
  write('configuration', configuration, 'rich')
  write('theme', theme, 'default')
  write('appearance', appearance, 'system')
  write('adapter', adapterMode, 'normal')
  write('editable', String(settings.editable), 'true')
  write('editors', settings.editors ? '2' : '1', '1')
  write('files', String(settings.files), 'false')
  write('observe', String(observing), 'false')
  write('generate', generated ? `${generated.kind}:${generated.count}` : '', '')
  try {
    history.replaceState(null, '', url)
  } catch {
    // Some file: documents refuse to rewrite their address; sharing is lost, nothing else.
  }
}
function showProblems(problems: readonly string[]) {
  const box = element('problems')
  box.textContent = problems.join(' ')
  box.hidden = !problems.length
}
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
// The playground offers every format, including RTF.
let editor: InkKitEditor<DocumentFormat>
let mounting = true
let secondEditor: InkKitEditor<DocumentFormat> | undefined
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
// The status line shows the last error until the next edit or document load;
// the diagnostics list keeps the history.
let statusError = false
function record(error: unknown) {
  const entry = {
    code: error instanceof Error && 'code' in error ? String(error.code) : null,
    message: error instanceof Error ? error.message : String(error),
  }
  diagnostics.push(entry)
  statusError = true
  element<HTMLOutputElement>('status').value = entry.message
}
function importPending() {
  try {
    return editor.commandState(generation).pending
  } catch {
    return false
  }
}
const keystrokeTimes: number[] = []
function percentile(sorted: number[], fraction: number) {
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]
}
const round = (value: number) => Math.round(value * 10) / 10
function timings() {
  const sorted = [...keystrokeTimes].sort((a, b) => a - b)
  return {
    keystrokes: sorted.length
      ? {
          count: sorted.length,
          last: round(keystrokeTimes.at(-1)!),
          median: round(percentile(sorted, 0.5)!),
          p95: round(percentile(sorted, 0.95)!),
        }
      : null,
  }
}
function renderTimings() {
  const { keystrokes } = timings()
  element<HTMLOutputElement>('timing').value = [
    keystrokes
      ? `Keystrokes to next frame (last ${keystrokes.count}): last ${keystrokes.last} ms, median ${keystrokes.median} ms, 95th percentile ${keystrokes.p95} ms.`
      : 'No keystrokes measured yet.',
  ].join(' ')
}
function resetTimings() {
  keystrokeTimes.length = 0
  renderTimings()
}
// Measured from the key press to the frame after it is handled, so long work
// in a key handler shows.
element('editor').addEventListener(
  'keydown',
  (event) => {
    if (
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      !(
        event.key.length === 1 ||
        ['Backspace', 'Delete', 'Enter'].includes(event.key)
      )
    )
      return
    const start = performance.now()
    requestAnimationFrame(() =>
      setTimeout(() => {
        keystrokeTimes.push(performance.now() - start)
        if (keystrokeTimes.length > 100) keystrokeTimes.shift()
        renderTimings()
      }),
    )
  },
  true,
)
function selectedText() {
  if (mounting) return ''
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
/** The snapshot an observation reports. An RTF snapshot carries `document` and no `text`; the
 *  type keeps `text` so that the Markdown specs read it without narrowing first. */
type ObservedSnapshot = Omit<TextDocumentSnapshot, 'format'> & {
  format: DocumentFormat
  document?: RichTextDocument
}
function observe() {
  let snapshot: ObservedSnapshot | undefined, snapshotError
  try {
    if (!mounting)
      snapshot = editor.snapshot(generation) as unknown as ObservedSnapshot
  } catch (error) {
    snapshotError = {
      message: String(error),
      code: error instanceof Error && 'code' in error ? error.code : null,
    }
  }
  let commandState, commandStateError
  try {
    if (!mounting) commandState = editor.commandState(generation)
  } catch (error) {
    commandStateError = String(error)
  }
  let textSnapshot, textSnapshotError
  try {
    if (!mounting) textSnapshot = editor.textSnapshot()
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
    mode: mounting ? null : editor.editingMode,
    editable: mounting ? null : editor.editable,
    commandState: commandState ?? null,
    commandStateError: commandStateError ?? null,
    textSnapshot: textSnapshot ?? null,
    textSnapshotError: textSnapshotError ?? null,
    viewport: mounting ? null : editor.viewport(),
    secondTextSnapshot: mounting
      ? null
      : (secondEditor?.textSnapshot() ?? null),
    adapterEvents: [...images.events],
    fileEvents: [...files.events],
    diagnostics: [...diagnostics],
    timings: timings(),
    lastResult,
  }
}
// Edits only schedule this, so typing does not wait for it. The full
// observation is the costly part (a snapshot of the whole document), so it
// runs only while Observe is on.
let refreshTimer: ReturnType<typeof setTimeout> | undefined
function scheduleControls(epoch = mountEpoch) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    if (epoch === mountEpoch) updateControls()
  }, 150)
}
// WebKit drops a click when the text under the pointer is replaced between
// press and release, so a refresh replaces a control's text only when it
// changes, and rebuilds the heading list only when the headings change.
function setText(id: string, text: string) {
  const target = element(id)
  if (target.textContent !== text) target.textContent = text
}
function updateControls() {
  if (!editor || mounting) return
  clearTimeout(refreshTimer)
  const observation = observing ? observe() : undefined
  element('observations').textContent = observation
    ? JSON.stringify(observation, null, 2)
    : 'Observation is off. Turn on Observe, or call window.inkkitPlayground.observe().'
  setText(
    'editing-mode',
    editor.editingMode === 'source' ? 'Edit formatted' : 'Edit source',
  )
  setText('read-only', editor.editable ? 'Make read-only' : 'Make editable')
  let state: CommandState | undefined = observation?.commandState ?? undefined
  if (!observation)
    try {
      state = editor.commandState(generation)
    } catch {
      state = undefined
    }
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
    element<HTMLButtonElement>('editing-mode').disabled = state.format !== 'md'
    setText('mode', state.format === 'md' ? 'Load as TXT' : 'Load as Markdown')
    element<HTMLButtonElement>('convert').disabled = state.format === 'txt'
    setText(
      'convert',
      state.format === 'rtf' ? 'Convert to Markdown' : 'Convert to RTF',
    )
  }
  try {
    headings = editor.headings(generation)
  } catch {
    headings = []
  }
  const select = element<HTMLSelectElement>('headings')
  const options = headings.map((heading) => [
    heading.id,
    `${'  '.repeat(heading.level - 1)}${heading.text || 'Untitled heading'}`,
  ])
  if (
    options.length !== select.options.length ||
    options.some(
      ([id, label], index) =>
        select.options[index]!.value !== id ||
        select.options[index]!.textContent !== label,
    )
  ) {
    const selected = select.value
    select.replaceChildren(
      ...options.map(([id, label]) => new Option(label, id)),
    )
    if (headings.some((heading) => heading.id === selected))
      select.value = selected
  }
  select.disabled = !headings.length
  element<HTMLButtonElement>('navigate-heading').disabled = !headings.length
  if (!statusError && state)
    element<HTMLOutputElement>('status').value =
      `${state.documentId}, generation ${generation}, revision ${state.revision}` +
      (observation?.snapshot
        ? `, ${observation.snapshot.dirty ? 'Unsaved changes' : 'Unchanged'}`
        : '')
}
/** Loads text, or for RTF the document a host's converter would give. */
function load(
  content: string | RichTextDocument,
  format: DocumentFormat,
  documentId = `fixture:${fixtureId}`,
) {
  editor.loadDocument(
    format === 'rtf'
      ? {
          documentId,
          generation: ++generation,
          format,
          document: content as RichTextDocument,
        }
      : { documentId, generation: ++generation, format, text: String(content) },
  )
  statusError = false
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
  mounting = true
  showProblems([])
  clearTimeout(refreshTimer)
  if (nextFixture !== fixtureId) generated = undefined
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
  statusError = false
  resetTimings()
  lastResult = null
  searchSnapshot = undefined
  searchRange = undefined
  fixtureId = nextFixture
  configuration = nextConfiguration
  images.setMode('import', adapterMode)
  images.setMode('export', adapterMode)
  files.setMode(adapterMode)
  const update = () => {
    if (epoch === mountEpoch) scheduleControls(epoch)
  }
  editor = await InkKitEditor.mount(
    element('editor'),
    {
      changed: () => {
        // A change made while an import is pending is that import's own,
        // such as the placeholder for an image it could not import, so it
        // leaves the import's error in place.
        if (epoch === mountEpoch && !importPending()) statusError = false
        update()
      },
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
      formats: ['md', 'txt', 'rtf'],
      images: configuration === 'rich' ? images.adapter : undefined,
      rendering:
        configuration === 'minimal'
          ? { codeHighlighting: false, diagramPreview: false }
          : undefined,
      files:
        configuration === 'rich' &&
        (fixtureId === 'linked-files' || settings.files)
          ? files.adapter
          : undefined,
      wikiLinks:
        configuration === 'rich' &&
        (fixtureId === 'linked-files' || settings.files)
          ? files.wiki
          : undefined,
      editable: settings.editable,
      textInput:
        configuration === 'rich'
          ? { spellcheck: false, autocorrect: false, autocapitalize: 'off' }
          : undefined,
    },
  )
  const fixture = fixtures[fixtureId]!
  if (generated)
    load(
      generateDocument(generated),
      'md',
      `generated:${generated.kind}:${generated.count}`,
    )
  else
    load(
      fixture.format === 'rtf' ? fixture.document : fixture.text,
      fixture.format,
    )
  for (const [id, value] of Object.entries({
    fixture: fixtureId,
    configuration,
    adapter: adapterMode,
  }))
    element<HTMLSelectElement>(id).value = value
  element<HTMLInputElement>('files-toggle').checked = settings.files
  element<HTMLInputElement>('second-toggle').checked = settings.editors
  element<HTMLInputElement>('observe').checked = observing
  if (generated)
    element<HTMLInputElement>('generate-count').value = String(generated.count)
  element('second-editor').hidden = !settings.editors
  if (settings.editors) {
    secondEditor = await InkKitEditor.mount(
      element('second-editor'),
      { changed() {}, copy() {}, openLink() {} },
      { editable: false },
    )
    secondEditor.loadDocument({
      documentId: 'second',
      generation: 1,
      format: 'md',
      text: '# Independent fixture\n\nIndependent content.\n',
    })
  }
  mounting = false
  updateControls()
  syncUrl()
  return observe()
}
let findSession: FindSession | undefined
let findSessionOwner: unknown
let findStates: FindState[] = []
async function operation(name: string, args: Record<string, unknown> = {}) {
  const operationEpoch = mountEpoch
  let result: unknown
  try {
    const target = args.instance === 'second' ? secondEditor : editor
    if (!target) throw Error('Requested editor instance is not mounted')
    switch (name) {
      case 'searchMatches':
        result = target.searchMatches(args.text as string)
        break
      case 'findSession': {
        // A fresh session for each mount; its reported states are kept for the spec to read.
        if (findSessionOwner !== target) {
          findSessionOwner = target
          findStates = []
          findSession = target.findSession((state) => findStates.push(state))
        }
        const command = args.command as string
        const query = args.query as string
        const replacement = args.replacement as string
        let value: unknown
        if (command === 'find')
          value = findSession!.find(
            query,
            args.direction
              ? { direction: args.direction as 'next' | 'previous' }
              : undefined,
          )
        else if (command === 'next') value = findSession!.next()
        else if (command === 'previous') value = findSession!.previous()
        else if (command === 'replace')
          value = findSession!.replace(query, replacement)
        else if (command === 'replaceAll')
          value = findSession!.replaceAll(query, replacement)
        else if (command === 'clear') findSession!.clear()
        else if (command === 'close') findSession!.close()
        result = {
          value,
          state: command === 'close' ? undefined : findSession!.state(),
          states: findStates,
        }
        break
      }
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
      case 'textRangesRects':
        result = target.textRangesRects(
          args.ranges as Parameters<InkKitEditor['textRangesRects']>[0],
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
        const next = target === editor ? ++generation : snapshot.generation + 1
        target.reloadDocument(
          snapshot.format === 'rtf'
            ? {
                documentId: snapshot.documentId,
                generation: next,
                format: 'rtf',
                document:
                  args.document === undefined
                    ? snapshot.document
                    : (args.document as RichTextDocument),
              }
            : {
                documentId: snapshot.documentId,
                generation: next,
                format: snapshot.format,
                text:
                  args.text === undefined ? snapshot.text : String(args.text),
              },
          snapshot.generation,
        )
        break
      }
      case 'convert':
        result = editor.convertDocument(
          args.format as DocumentFormat,
          generation,
        )
        break
      case 'format':
        result = editor.format(
          args.command as FormatCommand,
          args.options as Parameters<InkKitEditor['format']>[1],
          generation,
        )
        break
      case 'table':
        result = editor.table(
          args.command as TableCommand,
          args.options as Parameters<InkKitEditor['table']>[1],
          generation,
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
        settings.editable = editor.editable
        syncUrl()
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
        editor.focus(generation)
        break
      case 'blur':
        editor.blur(generation)
        break
      case 'commentsVisible':
        result = editor.setCommentsVisible(Boolean(args.visible))
        break
      case 'insertText':
        result = editor.insertText(String(args.text), generation)
        break
      case 'insertImages':
        result = editor.insertImages(
          args.images as Parameters<InkKitEditor['insertImages']>[0],
          args.at as Parameters<InkKitEditor['insertImages']>[1],
          generation,
        )
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
        result = editor.find(String(args.text), generation)
        editor.focus(generation)
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
        result = await editor.clipboardSnapshot(
          args.scope as ClipboardScope | undefined,
          generation,
        )
        break
      case 'printable':
        result = await editor.printableSnapshot(generation)
        break
      case 'paste':
        await editor.paste(
          args.input as Parameters<InkKitEditor['paste']>[0],
          generation,
        )
        break
      case 'pastePlain':
        result = editor.pasteAsPlainText(String(args.text), generation)
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
// A text box rather than navigator.clipboard.readText(), which WebKit refuses
// without a native paste prompt and which browsers gate behind permission.
click('plain', () => {
  const text = element<HTMLTextAreaElement>('plain-text').value
  if (!text) throw Error('Type or paste text into the plain text box first')
  return operation('pastePlain', { text })
})
click('generate', () => {
  const count = element<HTMLInputElement>('generate-count').value
  generated = parseGenerate(`paragraphs:${count}`)
  return reset()
})
click('source', async () => {
  const snapshot = editor.snapshot(generation)
  // An RTF document has no Markdown source; its Markdown is a conversion.
  const converted =
    snapshot.format === 'rtf'
      ? editor.convertDocument('md', generation)
      : undefined
  await navigator.clipboard.writeText(
    converted?.format === 'md'
      ? converted.text
      : snapshot.format === 'rtf'
        ? ''
        : snapshot.text,
  )
})
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
  if (snapshot.format === 'rtf') {
    const converted = editor.convertDocument('md', generation)
    return load(converted.format === 'md' ? converted.text : '', 'md')
  }
  return load(snapshot.text, snapshot.format === 'md' ? 'txt' : 'md')
})
// Converts between Markdown and RTF and loads the result, as a host would, showing what was lost.
click('convert', () => {
  const format = editor.snapshot(generation).format === 'rtf' ? 'md' : 'rtf'
  const converted = editor.convertDocument(format, generation)
  lastResult = converted.lost
  return load(
    converted.format === 'rtf' ? converted.document : converted.text,
    converted.format,
  )
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
  return operation('textRangesRects', { ranges: [searchRange] })
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
element('theme').addEventListener('change', () => {
  theme = element<HTMLSelectElement>('theme').value
  applyAppearance()
  syncUrl()
})
element('appearance').addEventListener('change', () => {
  appearance = element<HTMLSelectElement>('appearance').value
  applyAppearance()
  syncUrl()
})
element('files-toggle').addEventListener('change', () => {
  settings.files = element<HTMLInputElement>('files-toggle').checked
  void act(() => reset())
})
element('second-toggle').addEventListener('change', () => {
  settings.editors = element<HTMLInputElement>('second-toggle').checked
  void act(() => reset())
})
element('observe').addEventListener('change', () => {
  observing = element<HTMLInputElement>('observe').checked
  syncUrl()
  updateControls()
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
  syncUrl()
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
  timings,
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
try {
  await reset()
  showProblems(startupProblems)
} catch (error) {
  showProblems([
    ...startupProblems,
    `The playground could not start: ${error instanceof Error ? error.message : String(error)}`,
  ])
}
urlReady = true
window.inkkitPlayground = playground
