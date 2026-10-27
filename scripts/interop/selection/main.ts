import { InkKitEditor } from '@aicayzer/inkkit/core'
import '@aicayzer/inkkit/style.css'

// DOM ranges set up selection; public facade snapshots verify retained state.
const text = 'Selection sentinel with Unicode café.\r\n\r\nUnedited tail.\r\n'
let changedEvents = 0
const errors: string[] = []
const editors = await Promise.all(
  ['one', 'two'].map((id) =>
    InkKitEditor.mount(document.getElementById(id)!, {
      changed() {
        changedEvents += 1
      },
      openLink() {},
      error(error) {
        errors.push(String(error))
      },
    }),
  ),
)
let mode = 'formatted'
let baseline: string[] = []
const ranges: (Range | null)[] = [null, null]
const state = () =>
  editors.map((editor) => ({
    snapshot: editor.snapshot(),
    undo: editor.commandState().commands.undo,
    redo: editor.commandState().commands.redo,
  }))
const surface = (index: number) =>
  document
    .querySelectorAll('.inkkit-root')
    [index].querySelector(
      mode === 'formatted' ? '.ProseMirror' : 'textarea',
    ) as HTMLElement
const select = (index: number) => {
  const target = surface(index)
  target.focus()
  if (target instanceof HTMLTextAreaElement) target.setSelectionRange(0, 18)
  else {
    const node = target.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 18)
    ranges[index] = range.cloneRange()
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }
}
const capture = async () => {
  const current = state()
  if (changedEvents || errors.length)
    throw Error(JSON.stringify({ changedEvents, errors }))
  if (current.some((value, index) => JSON.stringify(value) !== baseline[index]))
    throw Error('Document, revision or history changed')
  const selections = await Promise.all(
    [...document.querySelectorAll('.inkkit-root')].map(async (root, index) => {
      const target = surface(index)
      const textarea = target instanceof HTMLTextAreaElement ? target : null
      const range = ranges[index]
      const selected = (await editors[index].clipboardSnapshot('selection'))
        .text
      const rect = textarea
        ? target.getBoundingClientRect()
        : range && selected
          ? range.getBoundingClientRect()
          : null
      return {
        selected,
        offsets: textarea
          ? [textarea.selectionStart, textarea.selectionEnd]
          : null,
        geometryKind: textarea ? 'textarea-bounds' : 'selected-range',
        geometry: rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null,
        active: root.classList.contains('inkkit-selection-active'),
        activeColour: getComputedStyle(root)
          .getPropertyValue('--inkkit-selection-background')
          .trim(),
        inactiveColour: getComputedStyle(root)
          .getPropertyValue('--inkkit-inactive-selection-background')
          .trim(),
      }
    }),
  )
  return {
    mode,
    documents: current,
    selections,
    painted: Array.from(CSS.highlights.get('inkkit-selection') ?? [], (range) =>
      (range as Range).toString(),
    ),
    browserFocus: document.hasFocus(),
    activeElement: document.activeElement?.tagName,
  }
}
;(window as any).selectionFixture = {
  async prepare(next: string) {
    mode = next
    editors.forEach((editor, index) => {
      editor.loadDocument({
        documentId: `selection-${index}`,
        generation: next === 'formatted' ? 1 : next === 'source' ? 2 : 3,
        format: next === 'txt' ? 'txt' : 'md',
        text,
      })
      if (next !== 'txt') editor.setEditingMode(next as 'source' | 'formatted')
    })
    if (
      state().some(
        ({ snapshot }) => snapshot.text !== text || snapshot.revision !== 0,
      )
    )
      throw Error('Load did not preserve source exactly')
    baseline = state().map((value) => JSON.stringify(value))
    select(0)
  },
  select,
  setHostActive(active: boolean | null) {
    const focused = document.activeElement
    const selections = editors.map((editor) =>
      JSON.stringify(editor.textSnapshot().selection),
    )
    editors.forEach((editor) => editor.setHostActive(active))
    if (
      document.activeElement !== focused ||
      editors.some(
        (editor, index) =>
          JSON.stringify(editor.textSnapshot().selection) !== selections[index],
      )
    )
      throw Error('Host activation changed focus or selection')
  },
  blur: (index: number) => editors[index].blur(),
  capture,
}
;(window as any).selectionReady = true
