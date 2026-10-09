import {
  InkKitEditor,
  InkKitError,
  type TableCommand,
  type Heading,
} from '../src/index'
import '../src/style.css'

document.head.insertAdjacentHTML(
  'beforeend',
  '<style>body{margin:0;height:100dvh;display:flex;flex-direction:column}#toolbar{display:flex;gap:8px;padding:8px;box-sizing:border-box;flex-wrap:wrap}#toolbar input{min-width:8rem}#editor{flex:1;min-height:0;overflow:auto}#status{padding:4px 16px;font-size:12px;min-height:1.5em}#headings{max-width:16rem}</style>',
)

let active = false
const status = document.querySelector<HTMLOutputElement>('#status')!
const editor = await InkKitEditor.mount(
  document.querySelector<HTMLElement>('#editor')!,
  {
    changed() {
      if (active)
        queueMicrotask(() => {
          try {
            updateControls()
          } catch (error) {
            if (!(
              error instanceof InkKitError &&
              ['composition', 'operation-pending'].includes(error.code)
            ))
              status.value = String(error)
          }
        })
    },
    stateChanged() {},
    openLink(href) {
      status.value = href
    },
    copy(text) {
      void navigator.clipboard.writeText(text)
    },
    error(error) {
      status.value = error.message
    },
  },
)
let generation = 1
editor.loadDocument({
  documentId: 'playground',
  generation,
  format: 'md',
  text: '# InkKit\n\nEdit, copy and paste here.\n\n| Name | Value |\n| --- | --- |\n| Alice | 42 |\n',
})
let headings: readonly Heading[] = []
function updateControls() {
  const source = editor.editingMode === 'source'
  const snapshot = editor.snapshot(generation)
  document.querySelector('#editing-mode')!.textContent = source
    ? 'Edit formatted'
    : 'Edit source'
  document.querySelector<HTMLButtonElement>('#editing-mode')!.disabled =
    snapshot.format === 'txt'
  for (const id of ['bold', 'table', 'apply-table'])
    document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = source
  headings = editor.headings(generation)
  const select = document.querySelector<HTMLSelectElement>('#headings')!
  const selected = select.value
  select.replaceChildren()
  for (const heading of headings) {
    const option = document.createElement('option')
    option.value = heading.id
    option.textContent = `${'  '.repeat(heading.level - 1)}${heading.text || 'Untitled heading'}`
    select.append(option)
  }
  if (!headings.length) {
    const option = document.createElement('option')
    option.textContent = 'No headings'
    select.append(option)
  } else if (headings.some((heading) => heading.id === selected))
    select.value = selected
  select.disabled = !headings.length
  document.querySelector<HTMLButtonElement>('#navigate-heading')!.disabled =
    !headings.length
  status.value = `${snapshot.documentId}, generation ${snapshot.generation}, revision ${snapshot.revision}, ${snapshot.dirty ? 'Unsaved changes' : 'Unchanged'}`
}
function act(action: () => void) {
  try {
    action()
    updateControls()
  } catch (error) {
    status.value = String(error)
  }
}
active = true
updateControls()
editor.setKeymap({ bold: ['Mod-b'], italic: ['Mod-i'], code: ['Mod-e'] })
document
  .querySelector('#bold')!
  .addEventListener('click', () => editor.format('bold'))
document
  .querySelector('#table')!
  .addEventListener('click', () => editor.table('insert'))
document.querySelector('#plain')!.addEventListener('click', async () => {
  try {
    editor.pasteAsPlainText(await navigator.clipboard.readText())
  } catch (error) {
    status.value = String(error)
  }
})
document.querySelector('#source')!.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editor.snapshot().text)
  } catch (error) {
    status.value = String(error)
  }
})
document.querySelector('#mode')!.addEventListener('click', () =>
  act(() => {
    const snapshot = editor.snapshot(generation)
    const nextGeneration = generation + 1
    editor.loadDocument({
      ...snapshot,
      generation: nextGeneration,
      format: snapshot.format === 'md' ? 'txt' : 'md',
    })
    generation = nextGeneration
    document.querySelector('#mode')!.textContent =
      `Load as ${snapshot.format === 'md' ? 'MD' : 'TXT'}`
  }),
)

document.querySelector('#apply-table')!.addEventListener('click', () => {
  try {
    const command = document.querySelector<HTMLSelectElement>('#table-action')!
      .value as TableCommand
    const comparison = document.querySelector<HTMLSelectElement>('#comparison')!
      .value as 'text' | 'number'
    const order = document.querySelector<HTMLSelectElement>('#sort-order')!
      .value as 'ascending' | 'descending'
    status.value = editor.table(command, { comparison, order })
      ? 'Table updated'
      : 'Select an editable table cell'
  } catch (error) {
    status.value = String(error)
  }
})

document.querySelector('#editing-mode')!.addEventListener('click', () =>
  act(() => {
    editor.setEditingMode(
      editor.editingMode === 'source' ? 'formatted' : 'source',
      generation,
    )
    editor.focus()
  }),
)
document.querySelector('#undo')!.addEventListener('click', () =>
  act(() => {
    editor.undo(generation)
  }),
)
document.querySelector('#redo')!.addEventListener('click', () =>
  act(() => {
    editor.redo(generation)
  }),
)
const query = () => document.querySelector<HTMLInputElement>('#query')!.value
const replacement = () =>
  document.querySelector<HTMLInputElement>('#replacement')!.value
document.querySelector('#find')!.addEventListener('click', () =>
  act(() => {
    editor.find(query(), generation)
    editor.focus()
  }),
)
document.querySelector('#replace')!.addEventListener('click', () =>
  act(() => {
    editor.replace(query(), replacement(), generation)
    editor.focus()
  }),
)
document.querySelector('#replace-all')!.addEventListener('click', () =>
  act(() => {
    editor.replaceAll(query(), replacement(), generation)
    editor.focus()
  }),
)
document.querySelector('#navigate-heading')!.addEventListener('click', () =>
  act(() => {
    const id = document.querySelector<HTMLSelectElement>('#headings')!.value
    const heading = headings.find((entry) => entry.id === id)
    if (heading) editor.navigateHeading(heading)
  }),
)
