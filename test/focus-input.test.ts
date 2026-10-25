import { afterEach, expect, test, vi } from 'vitest'
import { InkKitEditor } from '../src/core'

let editor: InkKitEditor | undefined
let root: HTMLElement | undefined
let holdSelection = false
const deferSelectionChange = (event: Event) => {
  if (holdSelection) event.stopImmediatePropagation()
}

afterEach(() => {
  holdSelection = false
  document.removeEventListener('selectionchange', deferSelectionChange, true)
  editor?.destroy()
  editor = undefined
  root?.remove()
  root = undefined
  vi.useRealTimers()
})

async function mount(text = 'Background document') {
  root = document.createElement('div')
  document.body.append(root)
  // A browser can deliver the focus timer before its queued selectionchange.
  // Hold that event explicitly rather than waiting for the race to disappear.
  document.addEventListener('selectionchange', deferSelectionChange, true)
  editor = await InkKitEditor.mount(root, {
    changed() {},
    error(error) {
      throw error
    },
    copy() {},
    openLink() {},
  })
  const surface = root.querySelector<HTMLElement>('[contenteditable="true"]')!
  // jsdom does not make contenteditable elements focusable by itself.
  surface.tabIndex = 0
  vi.useFakeTimers()
  editor.loadDocument({
    documentId: 'focus',
    generation: 1,
    format: 'md',
    text,
  })
  const snapshot = editor.textSnapshot()
  editor.selectTextRange({ snapshotId: snapshot.snapshotId, from: 1, to: 1 })
  // Finish the initial document render before the focus transition under test.
  vi.advanceTimersByTime(50)
  editor.focus()
  expect(document.activeElement).toBe(surface)
  holdSelection = true
  return surface
}

for (const text of ['Background document', 'Béfore 😀 after\r\n']) {
  test(`a caret key wins over pending focus restoration: ${JSON.stringify(text)}`, async () => {
    const surface = await mount(text)
    const node = surface.querySelector('p')!.firstChild!
    surface.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    // This is the browser's native caret movement, after keydown returns.
    const end = node.textContent!.length
    window.getSelection()!.collapse(node, end)
    expect(editor!.textSnapshot().selection).toMatchObject({ from: 1, to: 1 })
    vi.advanceTimersByTime(20)
    expect(window.getSelection()!.anchorOffset).toBe(end)
    holdSelection = false
    document.dispatchEvent(new Event('selectionchange'))
    expect(editor!.textSnapshot().selection).toMatchObject({
      from: end,
      to: end,
    })
    editor!.insertText(' q', 1)
    const saved = editor!.snapshot().text
    expect(saved).toBe(text.replace(/(\r?\n)?$/, ' q$1'))
    editor!.loadDocument({
      documentId: 'reopened',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor!.snapshot().text).toBe(saved)
  })
}

test('focus still restores the model selection when no input intervenes', async () => {
  const surface = await mount()
  const node = surface.querySelector('p')!.firstChild!
  window.getSelection()!.collapse(node, node.textContent!.length)
  vi.advanceTimersByTime(20)
  expect(window.getSelection()!.anchorOffset).toBe(1)
  expect(editor!.textSnapshot().selection).toMatchObject({ from: 1, to: 1 })
})

test('a modifier alone still allows the pending focus correction', async () => {
  const surface = await mount()
  surface.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', keyCode: 16, bubbles: true }),
  )
  const node = surface.querySelector('p')!.firstChild!
  window.getSelection()!.collapse(node, node.textContent!.length)
  vi.advanceTimersByTime(20)
  expect(window.getSelection()!.anchorOffset).toBe(1)
  expect(editor!.snapshot().text).toBe('Background document')
})

test('a composition key does not restore a stale focus selection', async () => {
  const surface = await mount()
  surface.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true }),
  )
  surface.dispatchEvent(
    new KeyboardEvent('keydown', { keyCode: 229, bubbles: true }),
  )
  const node = surface.querySelector('p')!.firstChild!
  const end = node.textContent!.length
  window.getSelection()!.collapse(node, end)
  vi.advanceTimersByTime(20)
  expect(window.getSelection()!.anchorOffset).toBe(end)
  surface.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true }),
  )
})

for (const text of [
  'Before gamma after',
  'Béfore 😀 gamma after\r\n\r\nUntouched é 中文.\r\n',
]) {
  test(`the next key reads a caret while selectionchange is held: ${JSON.stringify(text)}`, async () => {
    const surface = await mount(text)
    expect(editor!.find('gamma', 1)).toBe(true)
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()!
    while (!node.textContent!.includes('gamma')) node = walker.nextNode()!
    const caret = text.indexOf('gamma') + 2
    window
      .getSelection()!
      .collapse(node, node.textContent!.indexOf('gamma') + 2)
    expect(editor!.textSnapshot().selection).toMatchObject({
      from: text.indexOf('gamma'),
      to: text.indexOf('gamma') + 5,
    })
    surface.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        keyCode: 39,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(editor!.textSnapshot().selection).toMatchObject({
      from: caret,
      to: caret,
    })
    editor!.insertText('q', 1)
    const saved = text.slice(0, caret) + 'q' + text.slice(caret)
    expect(editor!.snapshot().text).toBe(saved)
    expect(editor!.undo(1)).toBe(true)
    expect(editor!.snapshot().text).toBe(text)
    editor!.loadDocument({
      documentId: 'reopened',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor!.snapshot().text).toBe(saved)
  })
}

test('modifier and composition keys leave an unreported caret pending', async () => {
  const surface = await mount()
  const node = surface.querySelector('p')!.firstChild!
  const end = node.textContent!.length
  window.getSelection()!.collapse(node, end)
  surface.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', keyCode: 16, bubbles: true }),
  )
  expect(editor!.textSnapshot().selection).toMatchObject({ from: 1, to: 1 })
  surface.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true }),
  )
  surface.dispatchEvent(
    new KeyboardEvent('keydown', { keyCode: 229, bubbles: true }),
  )
  expect(window.getSelection()!.anchorOffset).toBe(end)
  expect(() => editor!.snapshot()).toThrow('Text composition is in progress')
  surface.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true }),
  )
})

test('a 229 key before compositionstart leaves an unreported caret pending', async () => {
  const surface = await mount()
  const node = surface.querySelector('p')!.firstChild!
  const end = node.textContent!.length
  window.getSelection()!.collapse(node, end)
  surface.dispatchEvent(
    new KeyboardEvent('keydown', { keyCode: 229, bubbles: true }),
  )
  expect(editor!.textSnapshot().selection).toMatchObject({ from: 1, to: 1 })
  expect(window.getSelection()!.anchorOffset).toBe(end)
  vi.advanceTimersByTime(20)
  expect(window.getSelection()!.anchorOffset).toBe(end)
  expect(editor!.textSnapshot().selection).toMatchObject({ from: 1, to: 1 })
})
