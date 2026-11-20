import { editorViewCtx } from '@milkdown/kit/core'
import { expect } from 'vitest'
import { InkKitEditor } from '../src/core'
import { ctxOf } from './editor-access'

// Helpers for tests that edit a loaded document through the public facade and
// check what it saves, how the save reads back and what Undo restores.

// The edited document, without how each link was written: a bare address
// saved in angle brackets reads as the same link. Spaces carry no visible
// formatting, and Markdown puts a space at the edge of emphasis outside it.
export function content(editor: InkKitEditor): unknown {
  const doc = ctxOf(editor).get(editorViewCtx).state.doc
  return JSON.parse(
    JSON.stringify(doc.toJSON(), (key, value) =>
      key === 'form' ? undefined : value,
    ),
    function (key, value) {
      if (key !== 'marks' || !/^\s+$/.test(this.text ?? '')) return value
      const kept = value.filter(
        (mark: { type: string }) => mark.type === 'link',
      )
      return kept.length ? kept : undefined
    },
  )
}

export function links(editor: InkKitEditor): string[] {
  const found: string[] = []
  ctxOf(editor)
    .get(editorViewCtx)
    .state.doc.descendants((node) => {
      const link = node.marks.find((mark) => mark.type.name === 'link')
      if (node.isText && link) found.push(`${node.text} -> ${link.attrs.href}`)
    })
  return found
}

export async function mounted<T>(run: (editor: InkKitEditor) => Promise<T>) {
  const errors: Error[] = []
  const root = document.body.appendChild(document.createElement('div'))
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    const result = await run(editor)
    expect(errors).toEqual([])
    return result
  } finally {
    await editor.destroy()
    root.remove()
  }
}

export function load(editor: InkKitEditor, text: string): void {
  editor.loadDocument({ documentId: 'url', generation: 1, format: 'md', text })
  // An unedited document saves its bytes.
  expect(editor.snapshot()).toMatchObject({ text, dirty: false })
}

// Places the caret after, or with `before` before, `text` in the readable text.
export function caretAt(editor: InkKitEditor, text: string, before = false) {
  const snapshot = editor.textSnapshot()
  const at = snapshot.text.indexOf(text)
  expect(at).toBeGreaterThanOrEqual(0)
  const offset = before ? at : at + text.length
  editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from: offset,
    to: offset,
  })
}

// Applies each edit, checking that it is applied and saves `expected`, that
// the saved text reads back as the edited document, and that the link targets
// are `targets` when given. Undo then returns the loaded bytes and links, and
// Redo the last edit's.
export async function edited(
  source: string,
  steps: ReadonlyArray<
    readonly [edit: (editor: InkKitEditor) => boolean, expected: string]
  >,
  targets?: string[],
  start: (editor: InkKitEditor) => void = () => {},
): Promise<void> {
  const saves = await mounted(async (editor) => {
    load(editor, source)
    const loaded = links(editor)
    start(editor)
    const saves: Array<{
      saved: string
      readable: string
      edited: unknown
      links: string[]
    }> = []
    for (const [edit, expected] of steps) {
      expect(edit(editor)).toBe(true)
      const saved = editor.snapshot().text
      expect(saved).toBe(expected)
      if (targets) expect(links(editor)).toEqual(targets)
      saves.push({
        saved,
        readable: editor.textSnapshot().text,
        edited: content(editor),
        links: links(editor),
      })
    }
    for (const _ of steps) editor.undo()
    expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
    expect(links(editor)).toEqual(loaded)
    for (const _ of steps) editor.redo()
    expect(editor.snapshot().text).toBe(saves.at(-1)!.saved)
    expect(links(editor)).toEqual(saves.at(-1)!.links)
    return saves
  })
  for (const { saved, readable, edited, links: linked } of saves)
    await mounted(async (editor) => {
      load(editor, saved)
      expect(editor.textSnapshot().text).toBe(readable)
      expect(content(editor)).toEqual(edited)
      expect(links(editor)).toEqual(linked)
    })
}

// Types each step at the caret after, or with `before` before, `anchor`.
export async function typed(
  source: string,
  anchor: string,
  steps: ReadonlyArray<readonly [typed: string, expected: string]>,
  { before = false, targets }: { before?: boolean; targets?: string[] } = {},
): Promise<void> {
  await edited(
    source,
    steps.map(
      ([text, expected]) =>
        [
          (editor: InkKitEditor) => editor.insertText(text, 1),
          expected,
        ] as const,
    ),
    targets,
    (editor) => caretAt(editor, anchor, before),
  )
}

// Deletes the first `text` in the readable text, or the first that directly
// follows `after`.
export async function deleted(
  source: string,
  text: string,
  expected: string,
  targets?: string[],
  after = '',
): Promise<void> {
  await edited(
    source,
    [
      [
        (editor) => {
          const snapshot = editor.textSnapshot()
          const found = snapshot.text.indexOf(after + text)
          expect(found).toBeGreaterThanOrEqual(0)
          const at = found + after.length
          return editor.replaceTextRange(
            { snapshotId: snapshot.snapshotId, from: at, to: at + text.length },
            '',
          )
        },
        expected,
      ],
    ],
    targets,
  )
}
