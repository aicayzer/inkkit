import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { InkKitEditor } from '../../../src/core'
import type {
  CommandState,
  DocumentFormat,
  DocumentSnapshot,
  EditorOptions,
  RichTextBlock,
  RichTextDocument,
  RichTextDocumentInput,
  RichTextDocumentSnapshot,
  RichTextInline,
  TextDocumentInput,
} from '../../../src/core'

type Editor = InkKitEditor<DocumentFormat>

/** The editor's Milkdown context, for tests that dispatch transactions directly. */
export const ctxOf = (editor: Editor) => editor['editor'].ctx

export interface RichMounted {
  editor: Editor
  root: HTMLElement
  changes: DocumentSnapshot<DocumentFormat>[]
  states: CommandState[]
}

const directory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** The golden documents the Swift converter wrote from real RTF files, by name. */
export const fixtures: Record<string, RichTextDocument> = Object.fromEntries(
  readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [
      name.replace(/\.json$/, ''),
      JSON.parse(
        readFileSync(join(directory, name), 'utf8'),
      ) as RichTextDocument,
    ]),
)

/** Mounts an editor that offers RTF, Markdown and TXT, runs `run` and destroys it. */
export async function withRichEditor<T>(
  options: Omit<EditorOptions<DocumentFormat>, 'formats'> & {
    formats?: readonly DocumentFormat[]
  },
  run: (mounted: RichMounted) => T | Promise<T>,
): Promise<T> {
  const root = document.createElement('div')
  document.body.append(root)
  const changes: DocumentSnapshot<DocumentFormat>[] = []
  const states: CommandState[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed: (snapshot) => changes.push(snapshot),
      commandStateChanged: (state) => states.push(state),
    },
    { ...options, formats: options.formats ?? ['rtf', 'md', 'txt'] },
  )
  try {
    return await run({ editor, root, changes, states })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

let generation = 1000

/** A load of `document` with a new generation. */
export function rich(document: unknown): RichTextDocumentInput {
  return {
    documentId: 'rtf-document',
    generation: ++generation,
    format: 'rtf',
    document: document as RichTextDocument,
  }
}

/** A Markdown or TXT load with a new generation. */
export function text(format: 'md' | 'txt', value: string): TextDocumentInput {
  return {
    documentId: `${format}-document`,
    generation: ++generation,
    format,
    text: value,
  }
}

export function doc(...blocks: RichTextBlock[]): RichTextDocument {
  return { version: 1, blocks }
}

export function para(
  ...content: (RichTextInline | string)[]
): RichTextBlock & { type: 'paragraph' } {
  return {
    type: 'paragraph',
    content: content.map((inline) =>
      typeof inline === 'string' ? { type: 'text', text: inline } : inline,
    ),
  }
}

/** The RTF snapshot, which the test expects the editor to give. */
export function richSnapshot(editor: Editor): RichTextDocumentSnapshot {
  const snapshot = editor.snapshot()
  expect(snapshot.format).toBe('rtf')
  return snapshot as RichTextDocumentSnapshot
}

/** Selects `needle` in the readable text, or puts the caret after it with `caret`. */
export function select(
  editor: Editor,
  needle: string,
  options: { caret?: 'start' | 'end'; occurrence?: number } = {},
): void {
  const readable = editor.textSnapshot()
  let from = -1
  for (let index = 0; index <= (options.occurrence ?? 0); index++)
    from = readable.text.indexOf(needle, from + 1)
  expect(
    from,
    `"${needle}" in ${JSON.stringify(readable.text)}`,
  ).toBeGreaterThanOrEqual(0)
  let to = from + needle.length
  if (options.caret === 'start') to = from
  if (options.caret === 'end') from = to
  editor.selectTextRange({ snapshotId: readable.snapshotId, from, to })
}

/** Types `value` one character at a time, as native input arrives. */
export function type(editor: Editor, value: string): void {
  const { generation } = editor.commandState()
  for (const character of value)
    expect(editor.insertText(character, generation)).toBe(true)
}
