import { InkKitEditor, type TableCommand } from '../src/index'
import '../src/style.css'

document.head.insertAdjacentHTML(
  'beforeend',
  '<style>#toolbar{display:flex;gap:8px;padding:8px;box-sizing:border-box;min-height:48px;flex-wrap:wrap}#editor{height:calc(100% - 96px)}#status{position:fixed;bottom:4px;left:16px;font-size:12px}</style>',
)

const status = document.querySelector<HTMLOutputElement>('#status')!
const editor = await InkKitEditor.mount(
  document.querySelector<HTMLElement>('#editor')!,
  {
    changed() {},
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
document.querySelector('#mode')!.addEventListener('click', () => {
  const snapshot = editor.snapshot()
  editor.loadDocument({
    ...snapshot,
    generation: ++generation,
    format: snapshot.format === 'md' ? 'txt' : 'md',
  })
  document.querySelector('#mode')!.textContent =
    `Switch to ${snapshot.format === 'md' ? 'MD' : 'TXT'}`
})

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
