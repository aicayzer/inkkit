import { InkKitEditor } from '../../src/core'
import type {
  CommandState,
  DocumentFormat,
  DocumentInput,
  DocumentSnapshot,
  EditorOptions,
} from '../../src/core'

export interface Mounted {
  editor: InkKitEditor
  root: HTMLElement
  /** The literal surface: the source and TXT textarea. */
  plain: HTMLTextAreaElement
  changes: DocumentSnapshot[]
  states: CommandState[]
}

/** Mounts an editor with `options`, runs `run` and destroys it. */
export async function withEditor<T>(
  options: EditorOptions | undefined,
  run: (mounted: Mounted) => T | Promise<T>,
): Promise<T> {
  const root = document.createElement('div')
  document.body.append(root)
  const changes: DocumentSnapshot[] = []
  const states: CommandState[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed: (snapshot) => changes.push(snapshot),
      commandStateChanged: (state) => states.push(state),
    },
    options,
  )
  try {
    return await run({
      editor,
      root,
      plain: root.querySelector('textarea')!,
      changes,
      states,
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

let generation = 0

/** A load of `text` with a new generation. */
export function input(format: DocumentFormat, text: string): DocumentInput {
  return {
    documentId: `${format}-document`,
    generation: ++generation,
    format,
    text,
  }
}

/** Untidy text every format must keep exactly. */
export const untidyTexts: Record<string, string> = {
  empty: '',
  'CRLF endings': 'First line\r\nSecond line\r\n',
  'lone CR endings': 'First line\rSecond line\r',
  'mixed endings': 'One\r\nTwo\nThree\rFour',
  'a byte-order mark': '\uFEFFAfter the mark\n',
  'Unicode and no final newline':
    'Café 👍🏽 नमस्ते שלום e\u0301 \u200d\u{1F469}\u200d\u{1F4BB}',
  'only blank lines': '\n\n\r\n',
  'tabs and trailing spaces': '\tindented  \n  \t\n',
}

/** Types `value` into the literal surface as the person would, with the caret at `caret`. */
export function typeLiteral(
  plain: HTMLTextAreaElement,
  value: string,
  caret = value.length,
): void {
  plain.value = value
  plain.setSelectionRange(caret, caret)
  plain.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
  )
}
