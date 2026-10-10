import type {
  InkKitEditor,
  TableCommand,
  FormatCommand,
  Heading,
  EditingMode,
  TextRange,
  ViewportOptions,
  ClipboardInput,
  TextInputPreferences,
  Keymap,
} from '../src/index'
import type { AdapterMode } from '../scripts/interop/consumer/fixtures'

export interface OperationContext {
  editor: InkKitEditor
  target: InkKitEditor
  generation: number
  reload(args: { text?: string; sameGeneration?: boolean }): void
  editable(value: boolean): void
  fileMode(mode: AdapterMode): void
  fileRelease(): void
  fileEvents(): unknown
  startImagePaste(): unknown
  finishImagePaste(): Promise<void>
  startOutput(kind: 'print' | 'clipboard'): unknown
  finishOutput(): Promise<unknown>
}
interface Definition<A extends object> {
  description: string
  args: string
  example: A
  run(context: OperationContext, args: A): unknown
}
function define<A extends object>(
  description: string,
  args: string,
  example: A,
  run: Definition<A>['run'],
): Definition<A> {
  return { description, args, example, run }
}
const range: TextRange = {
  snapshotId: 'capture-from-textSnapshot',
  from: 0,
  to: 1,
}
export const operations = {
  textSnapshot: define(
    'Capture readable text and a scoped selection range.',
    'instance?: "second"',
    {},
    (c) => c.target.textSnapshot(),
  ),
  selectTextRange: define(
    'Select a range from a current readable snapshot.',
    'range: TextRange; options?: {focus, reveal}; instance?: "second"',
    { range } as {
      range: TextRange
      options?: { focus?: boolean; reveal?: boolean }
    },
    (c, a) => c.target.selectTextRange(a.range, a.options),
  ),
  revealTextRange: define(
    'Reveal a current readable range without selecting it.',
    'range: TextRange; instance?: "second"',
    { range },
    (c, a) => c.target.revealTextRange(a.range),
  ),
  replaceTextRange: define(
    'Replace a current readable range.',
    'range: TextRange; text: string; instance?: "second"',
    { range, text: 'Replacement' },
    (c, a) => c.target.replaceTextRange(a.range, String(a.text)),
  ),
  textRangeRects: define(
    'Inspect layout rectangles for a readable range.',
    'range: TextRange; instance?: "second"',
    { range },
    (c, a) => c.target.textRangeRects(a.range),
  ),
  visibleTextRanges: define(
    'Inspect visible ranges in a readable snapshot.',
    'snapshotId: string; instance?: "second"',
    { snapshotId: range.snapshotId },
    (c, a) => c.target.visibleTextRanges(String(a.snapshotId)),
  ),
  setViewport: define(
    'Apply host viewport insets.',
    'insets: {top?, bottom?, left?, right?}; instance?: "second"',
    { insets: { top: 36, bottom: 28 } } as ViewportOptions,
    (c, a) => c.target.setViewport({ insets: a.insets }),
  ),
  viewport: define(
    'Inspect viewport geometry.',
    'instance?: "second"',
    {},
    (c) => c.target.viewport(),
  ),
  reload: define(
    'Reload the current document while retaining selection and scroll.',
    'text?: string; sameGeneration?: boolean; instance?: "second"',
    {} as { text?: string; sameGeneration?: boolean },
    (c, a) => c.reload(a),
  ),
  format: define(
    'Apply a public formatting command.',
    'command: FormatCommand; arg?: string | number',
    { command: 'bold' } as { command: FormatCommand; arg?: string | number },
    (c, a) => c.editor.format(a.command, a.arg),
  ),
  table: define(
    'Apply a public table command.',
    'command: TableCommand; options?: TableOptions',
    { command: 'insert' } as {
      command: TableCommand
      options?: Parameters<InkKitEditor['table']>[1]
    },
    (c, a) => c.editor.table(a.command, a.options),
  ),
  editingMode: define(
    'Switch between formatted and source editing.',
    'mode: "formatted" | "source"',
    { mode: 'source' } as { mode: EditingMode },
    (c, a) => c.editor.setEditingMode(a.mode, c.generation),
  ),
  editable: define(
    'Change the host read-only policy.',
    'editable: boolean',
    { editable: false },
    (c, a) => c.editable(Boolean(a.editable)),
  ),
  textInput: define(
    'Set host text-input preferences.',
    'preferences: TextInputPreferences',
    { preferences: { spellcheck: false } } as {
      preferences: TextInputPreferences
    },
    (c, a) => c.editor.setTextInputPreferences(a.preferences),
  ),
  keymap: define(
    'Set host keyboard bindings.',
    'keymap: Keymap',
    { keymap: { undo: ['Mod-z'] } } as { keymap: Keymap },
    (c, a) => c.editor.setKeymap(a.keymap),
  ),
  focus: define('Focus the primary editor.', 'none', {}, (c) =>
    c.editor.focus(),
  ),
  commentsVisible: define(
    'Reveal or hide author comments.',
    'visible: boolean',
    { visible: true },
    (c, a) => c.editor.setCommentsVisible(Boolean(a.visible)),
  ),
  insertText: define(
    'Insert text at the current selection.',
    'text: string',
    { text: 'Inserted text' },
    (c, a) => c.editor.insertText(String(a.text), c.generation),
  ),
  replaceSource: define(
    'Replace the complete source as an undoable edit.',
    'text: string',
    { text: '# Replacement\n' },
    (c, a) => c.editor.replaceSource(String(a.text), c.generation),
  ),
  undo: define('Undo the last document edit.', 'none', {}, (c) =>
    c.editor.undo(c.generation),
  ),
  redo: define('Redo an undone document edit.', 'none', {}, (c) =>
    c.editor.redo(c.generation),
  ),
  find: define(
    'Find and focus the next literal match.',
    'text: string',
    { text: 'bold' },
    (c, a) => {
      c.editor.find(String(a.text), c.generation)
      c.editor.focus()
    },
  ),
  replace: define(
    'Replace the selected or next literal match.',
    'search: string; replacement: string',
    { search: 'bold', replacement: 'changed' },
    (c, a) =>
      c.editor.replace(String(a.search), String(a.replacement), c.generation),
  ),
  replaceAll: define(
    'Replace all literal matches.',
    'search: string; replacement: string',
    { search: 'bold', replacement: 'changed' },
    (c, a) =>
      c.editor.replaceAll(
        String(a.search),
        String(a.replacement),
        c.generation,
      ),
  ),
  headings: define('Read the current document outline.', 'none', {}, (c) =>
    c.editor.headings(c.generation),
  ),
  navigateHeading: define(
    'Navigate to a current outline entry.',
    'heading: Heading returned by headings',
    { heading: { id: 'capture-from-headings' } } as { heading: Heading },
    (c, a) => c.editor.navigateHeading(a.heading),
  ),
  clipboard: define(
    'Capture portable clipboard content without writing the OS clipboard.',
    'all?: boolean (default true)',
    { all: true },
    (c, a) => c.editor.clipboardSnapshot(a.all !== false),
  ),
  printable: define(
    'Capture portable printable HTML and assets.',
    'none',
    {},
    (c) => c.editor.printableSnapshot(c.generation),
  ),
  paste: define(
    'Paste an explicit clipboard payload.',
    'input: ClipboardInput',
    { input: { text: 'Pasted text' } } as { input: ClipboardInput },
    (c, a) => c.editor.paste(a.input),
  ),
  pastePlain: define(
    'Paste text without Markdown interpretation.',
    'text: string',
    { text: '**Literal**' },
    (c, a) => c.editor.pasteAsPlainText(String(a.text)),
  ),
  commandState: define(
    'Inspect command availability, optionally testing a generation.',
    'generation?: number',
    {} as { generation?: number },
    (c, a) => c.editor.commandState(a.generation),
  ),
  startImagePaste: define(
    'Begin a controlled fixture image import without awaiting completion.',
    'none',
    {},
    (c) => c.startImagePaste(),
  ),
  finishImagePaste: define(
    'Release and await the started image import.',
    'none',
    {},
    (c) => c.finishImagePaste(),
  ),
  fileMode: define(
    'Set controlled file resolution/export behaviour.',
    'mode: "normal" | "reject" | "hold" | "corrupt"',
    { mode: 'hold' } as { mode: AdapterMode },
    (c, a) => c.fileMode(a.mode),
  ),
  fileRelease: define(
    'Release held file resolution and export operations.',
    'none',
    {},
    (c) => c.fileRelease(),
  ),
  fileEvents: define('Read file and wiki host callbacks.', 'none', {}, (c) =>
    c.fileEvents(),
  ),
  startOutput: define(
    'Begin an export without awaiting held adapters.',
    'kind: "print" | "clipboard"',
    { kind: 'print' } as { kind: 'print' | 'clipboard' },
    (c, a) => c.startOutput(a.kind),
  ),
  finishOutput: define(
    'Await the started export. Release its adapter separately.',
    'none',
    {},
    (c) => c.finishOutput(),
  ),
} as const
export type OperationName = keyof typeof operations
export function describeOperations() {
  return Object.entries(operations).map(([name, definition]) => ({
    name,
    description: definition.description,
    args: definition.args,
    example: definition.example,
  }))
}
export function executeOperation(
  name: string,
  context: OperationContext,
  args: Record<string, unknown>,
) {
  if (!Object.hasOwn(operations, name))
    throw Error(`Unknown public operation: ${name}`)
  // The browser boundary accepts JSON; public facade methods retain their validation.
  const definition = operations[name as OperationName] as Definition<
    Record<string, unknown>
  >
  return definition.run(context, args)
}
