import type { Playground } from './controller'
import type { TableCommand } from '../src/index'
import type { AdapterMode } from '../scripts/interop/consumer/fixtures'

const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const node = document.getElementById(id)
  if (!node) throw Error(`Missing playground element: ${id}`)
  return node as T
}
const value = (id: string) => element<HTMLInputElement>(id).value
const text = (id: string, content: string) => {
  const target = element(id)
  if (target.textContent !== content) target.textContent = content
}
const json = (input: unknown) => JSON.stringify(input, null, 2) ?? 'null'
const compact = (input: unknown): unknown => {
  if (typeof input === 'string' && input.length > 200)
    return {
      characters: input.length,
      preview: input.slice(0, 200),
      truncated: true,
    }
  if (ArrayBuffer.isView(input))
    return {
      byteLength: input.byteLength,
      representation: 'Download evidence for complete bytes',
    }
  if (Array.isArray(input)) return input.map(compact)
  if (input && typeof input === 'object')
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, compact(value)]),
    )
  return input
}
const textMetadata = <T extends { text: string }>(snapshot: T | null) => {
  if (!snapshot) return null
  const { text: source, ...metadata } = snapshot
  return { ...metadata, characters: source.length }
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

export function mountUI(api: Playground) {
  const description = api.describe()
  let observation = api.observe()
  let activeTab = 'state'
  let capturedRange:
    { snapshotId: string; from: number; to: number } | undefined
  let lastGeneration: number | undefined
  let headingsKey = ''
  let noticeVersion = 0
  let renderedClipboard: unknown
  let renderedPrintable: unknown

  const act = async (action: () => unknown) => {
    try {
      await action()
    } catch (error) {
      api.reportError(error)
    }
  }
  const click = (id: string, action: () => unknown) => {
    element(id).addEventListener('click', () => {
      void act(action)
    })
  }
  const run = (name: string, args: Record<string, unknown> = {}) =>
    api.operation(name, args)
  const notice = (message: string) => {
    const version = ++noticeVersion
    text('action-status', message)
    window.setTimeout(() => {
      if (version === noticeVersion) text('action-status', '')
    }, 4000)
  }
  const fixtureButtons = new Map<string, HTMLButtonElement>()
  for (const fixture of description.fixtures) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = fixture.label
    button.dataset.fixture = fixture.id
    button.addEventListener('click', () => {
      void act(() => api.selectFixture(fixture.id))
    })
    element('fixture-list').append(button)
    fixtureButtons.set(fixture.id, button)
  }
  text('fixture-count', String(description.fixtures.length))
  element('fixture-search').addEventListener('input', () => {
    const query = value('fixture-search').toLowerCase().trim()
    let matches = 0
    for (const fixture of description.fixtures) {
      const matchesQuery = `${fixture.id} ${fixture.label}`
        .toLowerCase()
        .includes(query)
      fixtureButtons.get(fixture.id)!.hidden = !matchesQuery
      if (matchesQuery) matches++
    }
    element('fixture-empty').hidden = matches > 0
    text(
      'fixture-count',
      query
        ? `${matches}/${description.fixtures.length}`
        : String(description.fixtures.length),
    )
  })
  for (const command of tableCommands) {
    element('table-action').append(new Option(command, command))
  }
  for (const operation of description.operations) {
    element('operation-name').append(new Option(operation.name, operation.name))
  }
  const updateExample = () => {
    const operation = description.operations.find(
      (entry) => entry.name === value('operation-name'),
    )
    text('operation-description', operation?.description ?? '')
    text(
      'operation-signature',
      operation?.args === 'none' ? '' : (operation?.args ?? ''),
    )
    element<HTMLTextAreaElement>('operation-args').value = json(
      operation?.example ?? {},
    )
  }
  element('operation-name').addEventListener('change', updateExample)
  updateExample()

  function renderOutput() {
    const outputs = observation.outputs
    if (
      renderedClipboard === outputs.clipboard &&
      renderedPrintable === outputs.printable
    )
      return
    renderedClipboard = outputs.clipboard
    renderedPrintable = outputs.printable
    const container = element('captured-output')
    container.replaceChildren()
    element('output-empty').hidden = Boolean(
      outputs.clipboard || outputs.printable,
    )
    for (const [kind, captured] of Object.entries(outputs)) {
      if (captured == null) continue
      const entries =
        typeof captured === 'object'
          ? Object.entries(captured)
          : [['value', captured]]
      for (const [field, content] of entries) {
        const heading = document.createElement('h3')
        heading.textContent = `${kind === 'clipboard' ? 'Clipboard' : 'Printable'} / ${field}`
        const pre = document.createElement('pre')
        pre.tabIndex = 0
        pre.textContent =
          typeof content === 'string' ? content : json(compact(content))
        container.append(heading, pre)
      }
    }
  }
  function renderInspector() {
    if (!element<HTMLDetailsElement>('inspector').open) return
    if (activeTab === 'state') {
      const {
        operations: _operations,
        outputs: _outputs,
        lifecycle,
        snapshot,
        ...state
      } = observation
      text(
        'observations',
        json({
          lifecycle,
          snapshot: textMetadata(snapshot),
          ...state,
          textSnapshot: textMetadata(state.textSnapshot),
          secondTextSnapshot: textMetadata(state.secondTextSnapshot),
          lastResult: compact(state.lastResult),
        }),
      )
    } else if (activeTab === 'operations') {
      const count = observation.operations.length
      const summary = count
        ? `${count} operation${count === 1 ? '' : 's'}`
        : 'No operations'
      const dropped = observation.droppedOperations
        ? `; ${observation.droppedOperations} dropped`
        : ''
      text('operation-history', json(compact(observation.operations)))
      element('operation-history').hidden = count === 0
      text('history-count', summary + dropped)
    } else if (activeTab === 'adapters') {
      const hasEvents =
        observation.adapterEvents.length + observation.fileEvents.length > 0
      element('adapter-empty').hidden = hasEvents
      element('adapter-events').hidden = !hasEvents
      text(
        'adapter-events',
        json({
          images: observation.adapterEvents,
          files: observation.fileEvents,
        }),
      )
    } else renderOutput()
  }
  function selectTab(tab: string, focus = false) {
    activeTab = tab
    for (const name of ['state', 'operations', 'adapters', 'output']) {
      const button = element<HTMLButtonElement>(`tab-${name}`)
      button.setAttribute('aria-selected', String(name === tab))
      button.tabIndex = name === tab ? 0 : -1
      element(`panel-${name}`).hidden = name !== tab
      if (name === tab && focus) button.focus()
    }
    renderInspector()
  }
  const tabs = ['state', 'operations', 'adapters', 'output']
  for (const tab of tabs) {
    click(`tab-${tab}`, () => selectTab(tab))
    element(`tab-${tab}`).addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
        return
      event.preventDefault()
      const index = tabs.indexOf(tab)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 3
            : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4
      selectTab(tabs[next]!, true)
    })
  }
  element('inspector').addEventListener('toggle', renderInspector)
  const configurationPanel = element<HTMLDetailsElement>('configuration-panel')
  const dismissConfiguration = (event: PointerEvent) => {
    if (!configurationPanel.contains(event.target as Node))
      configurationPanel.open = false
  }
  document.addEventListener('pointerdown', dismissConfiguration)
  configurationPanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !configurationPanel.open) return
    event.preventDefault()
    configurationPanel.open = false
    configurationPanel.querySelector('summary')?.focus()
  })
  function renderSource() {
    if (!element<HTMLInputElement>('show-source').checked) return
    const snapshot = observation.snapshot
    const sourceError = observation.snapshotError
    element('source-error').hidden = !sourceError
    text('source-error', sourceError ? json(sourceError) : '')
    text(
      'source-snapshot',
      snapshot
        ? element<HTMLInputElement>('escaped-source').checked
          ? JSON.stringify(snapshot.text)
              .replaceAll('\uFEFF', '\\uFEFF')
              .replace(/ +(?=\\r\\n|\\n|\\r|"$)/g, (spaces) =>
                '\\u0020'.repeat(spaces.length),
              )
          : snapshot.text
        : `Source unavailable (${observation.lifecycle}).`,
    )
  }
  element('show-source').addEventListener('change', () => {
    const show = element<HTMLInputElement>('show-source').checked
    element('source-pane').hidden = !show
    element('workbench').classList.toggle('source-hidden', !show)
    renderSource()
  })
  element('escaped-source').addEventListener('change', renderSource)

  function render() {
    observation = api.observe()
    const { snapshot, commandState: state } = observation
    const setup =
      observation.lifecycle === 'resetting'
        ? observation.desiredSetup
        : observation.setup
    if (lastGeneration !== snapshot?.generation) {
      lastGeneration = snapshot?.generation
      capturedRange = undefined
    }
    const fixture = description.fixtures.find(
      (entry) => entry.id === setup.fixture,
    )
    text('fixture-title', fixture?.label ?? setup.fixture)
    text('fixture-format', snapshot?.format ?? fixture?.format ?? '')
    for (const [id, button] of fixtureButtons)
      button.setAttribute('aria-current', String(id === setup.fixture))
    element<HTMLSelectElement>('configuration').value = setup.configuration
    element<HTMLInputElement>('files').checked = setup.files
    element<HTMLInputElement>('two-editors').checked = setup.editors === 2
    element('probes').hidden = setup.editors !== 2
    element<HTMLSelectElement>('image-import').value = setup.imageImport
    element<HTMLSelectElement>('image-export').value = setup.imageExport
    element<HTMLSelectElement>('file-adapter').value = setup.fileAdapter
    text(
      'editing-mode',
      observation.mode === 'source' ? 'Edit formatted' : 'Edit source',
    )
    text('read-only', setup.editable ? 'Make read-only' : 'Make editable')
    text('mode', snapshot?.format === 'md' ? 'Load as TXT' : 'Load as Markdown')
    const reason =
      observation.lifecycle !== 'ready'
        ? observation.lifecycle
        : state?.composing
          ? 'Composition in progress'
          : state?.pending
            ? 'Operation pending'
            : observation.editable === false
              ? 'Read-only'
              : ''
    text('command-reason', reason)
    const enabled: Record<string, boolean | undefined> = {
      bold: state?.commands.format.bold,
      italic: state?.commands.format.italic,
      table: state?.commands.table.insert,
      undo: state?.commands.undo,
      redo: state?.commands.redo,
      replace: state?.commands.replace,
      'replace-all': state?.commands.replace,
      'import-image': state?.commands.paste && setup.configuration === 'rich',
      plain: state?.commands.paste,
      'apply-table':
        state?.commands.table[value('table-action') as TableCommand],
      'editing-mode':
        observation.lifecycle === 'ready' && snapshot?.format !== 'txt',
    }
    for (const [id, allowed] of Object.entries(enabled)) {
      const button = element<HTMLButtonElement>(id)
      button.disabled = !allowed
      button.title = !allowed
        ? reason || 'Unavailable for the current selection or document'
        : ''
    }
    const headings = observation.heads
    const nextHeadings = json(headings)
    if (headingsKey !== nextHeadings) {
      headingsKey = nextHeadings
      const select = element<HTMLSelectElement>('headings')
      const selected = select.value
      select.replaceChildren(
        ...headings.map(
          (heading) =>
            new Option(
              `${'  '.repeat(heading.level - 1)}${heading.text || 'Untitled heading'}`,
              heading.id,
            ),
        ),
      )
      if (headings.some((heading) => heading.id === selected))
        select.value = selected
    }
    element<HTMLSelectElement>('headings').disabled = !headings.length
    element<HTMLButtonElement>('navigate-heading').disabled = !headings.length
    const failure = observation.lifecycleError ?? observation.diagnostics.at(-1)
    const identity = snapshot
      ? `${snapshot.documentId} · generation ${snapshot.generation} · revision ${snapshot.revision} · ${snapshot.dirty ? 'Modified' : 'Unchanged'}`
      : 'Document unavailable'
    text('status', `${observation.lifecycle} · ${identity}`)
    text(
      'failure',
      failure ? (typeof failure === 'string' ? failure : failure.message) : '',
    )
    element('failure').hidden = !failure
    renderSource()
    renderInspector()
  }

  // Mouse toolbar actions must act on the editor selection that preceded the click.
  for (const button of document.querySelectorAll<HTMLElement>(
    '[data-preserve-selection], #undo, #redo',
  )) {
    button.addEventListener('mousedown', (event) => event.preventDefault())
  }
  click('reset', () => api.reset())
  click('replace-document', () =>
    api.replaceDocument(
      '# Replacement document\n\nDisposable replacement.\n',
      'md',
      'replacement',
    ),
  )
  click('read-only', () =>
    run('editable', { editable: !observation.setup.editable }),
  )
  click('editing-mode', async () => {
    await run('editingMode', {
      mode: observation.mode === 'source' ? 'formatted' : 'source',
    })
    await run('focus')
  })
  click('undo', () => run('undo'))
  click('redo', () => run('redo'))
  click('bold', () => run('format', { command: 'bold' }))
  click('italic', () => run('format', { command: 'italic' }))
  click('table', () => run('table', { command: 'insert' }))
  click('reload', () => run('reload'))
  click('mode', () => {
    const snapshot = observation.snapshot
    if (!snapshot) throw Error('Source snapshot unavailable')
    return api.replaceDocument(
      snapshot.text,
      snapshot.format === 'md' ? 'txt' : 'md',
    )
  })
  click('plain', () => run('pastePlain', { text: value('plain-text') }))
  click('find', () => run('find', { text: value('query') }))
  click('replace', () =>
    run('replace', {
      search: value('query'),
      replacement: value('replacement'),
    }),
  )
  click('replace-all', () =>
    run('replaceAll', {
      search: value('query'),
      replacement: value('replacement'),
    }),
  )
  click('apply-table', () =>
    run('table', {
      command: value('table-action'),
      options: { comparison: value('comparison'), order: value('sort-order') },
    }),
  )
  element('table-action').addEventListener('change', render)
  click('navigate-heading', () =>
    run('navigateHeading', {
      heading: observation.heads.find(
        (heading) => heading.id === value('headings'),
      ),
    }),
  )
  click('capture-text', async () => {
    const snapshot = (await run('textSnapshot')) as {
      snapshotId: string
      text: string
    }
    const query = value('query')
    if (!query) throw Error('Enter search text before capturing a range')
    const from = snapshot.text.indexOf(query)
    if (from < 0)
      throw Error('Search text is not present in the readable snapshot')
    capturedRange = {
      snapshotId: snapshot.snapshotId,
      from,
      to: from + query.length,
    }
    notice('Text range captured')
  })
  const range = () => {
    if (!capturedRange) throw Error('Capture a matching text range first')
    return capturedRange
  }
  click('select-range', () =>
    run('selectTextRange', {
      range: range(),
      options: { focus: true, reveal: true },
    }),
  )
  click('replace-range', () =>
    run('replaceTextRange', { range: range(), text: value('replacement') }),
  )
  click('range-rects', () => run('textRangeRects', { range: range() }))
  click('viewport-insets', () =>
    run('setViewport', {
      insets: {
        top: Number(value('inset-top')),
        bottom: Number(value('inset-bottom')),
      },
    }),
  )
  click('import-image', () => run('startImagePaste'))
  click('release-import', () => api.adapter.release('import'))
  click('release-export', () => api.adapter.release('export'))
  click('release-file', () => run('fileRelease'))
  for (const [id, kind] of [
    ['image-import', 'import'],
    ['image-export', 'export'],
  ] as const) {
    element(id).addEventListener('change', () => {
      void act(() => api.adapter.setMode(kind, value(id) as AdapterMode))
    })
  }
  element('file-adapter').addEventListener('change', () => {
    void act(() => run('fileMode', { mode: value('file-adapter') }))
  })
  element('configuration').addEventListener('change', () => {
    void act(() =>
      api.configure({
        configuration: value('configuration') as 'minimal' | 'rich',
      }),
    )
  })
  element('files').addEventListener('change', () => {
    void act(() =>
      api.configure({ files: element<HTMLInputElement>('files').checked }),
    )
  })
  element('two-editors').addEventListener('change', () => {
    void act(() =>
      api.configure({
        editors: element<HTMLInputElement>('two-editors').checked ? 2 : 1,
      }),
    )
  })
  click('copy-setup', async () => {
    await navigator.clipboard.writeText(location.href)
    notice('Setup link copied')
  })
  click('capture-clipboard', () => run('clipboard'))
  click('printable', () => run('printable'))
  click('source', async () => {
    const snapshot = api.observe().snapshot
    if (!snapshot) throw Error('Source snapshot unavailable')
    await navigator.clipboard.writeText(snapshot.text)
    notice('Markdown copied')
  })
  click('copy-readable', async () => {
    const output = (await run('clipboard')) as { text: string }
    await navigator.clipboard.writeText(output.text)
    notice('Readable content copied')
  })
  click('run-operation', () => {
    const args: unknown = JSON.parse(value('operation-args'))
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw Error('Arguments must be a JSON object')
    return run(value('operation-name'), args as Record<string, unknown>)
  })
  click('capture-evidence', () => {
    const blob = new Blob([json(api.captureEvidence())], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `inkkit-${observation.setup.fixture}-evidence.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notice('Evidence downloaded')
  })
  render()
  const unsubscribe = api.subscribe(render)
  let geometryFrame: number | undefined
  const refreshGeometry = () => {
    if (geometryFrame !== undefined) return
    geometryFrame = requestAnimationFrame(() => {
      geometryFrame = undefined
      render()
    })
  }
  const editorRoot = element('editor')
  const resizeObserver = new ResizeObserver(refreshGeometry)
  resizeObserver.observe(editorRoot)
  editorRoot.addEventListener('scroll', refreshGeometry, { passive: true })
  window.addEventListener('scroll', refreshGeometry, { passive: true })
  return () => {
    unsubscribe()
    resizeObserver.disconnect()
    editorRoot.removeEventListener('scroll', refreshGeometry)
    window.removeEventListener('scroll', refreshGeometry)
    document.removeEventListener('pointerdown', dismissConfiguration)
    if (geometryFrame !== undefined) cancelAnimationFrame(geometryFrame)
  }
}
