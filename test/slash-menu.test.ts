import { afterEach, expect, test, vi } from 'vitest'
import { InkKitEditor, InkKitError, type EditorOptions } from '../src/index'

const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})
async function mount(
  text: string,
  options: EditorOptions = { slashMenu: { enabled: true } },
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: unknown[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (e) => errors.push(e) },
    options,
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'slash',
    generation: 1,
    format: 'md',
    text,
  })
  return { editor, root, errors }
}
// These literals specify saved Markdown independently of the editor's serializer.
const commandBodies = {
  'Heading 1': '#',
  'Heading 2': '##',
  'Heading 3': '###',
  'Bulleted List': '- <br />',
  'Numbered List': '1. <br />',
  Checklist: '- [ ] <br />',
  Quote: '> <br />',
  'Code Block': '```\n```',
  Table: '|   |   |\n| - | - |\n|   |   |\n|   |   |',
  Callout: '> [!NOTE]\n> <br />',
  Divider: '---\n\n<br />',
  Diagram: '```mermaid\n```',
}
const commands = Object.keys(commandBodies) as (keyof typeof commandBodies)[]
// Dividers use underscores inside containers; lists keep the next paragraph tight.
const dividerBodies = {
  paragraph: '---\n\n<br />',
  list: '___\n<br />',
  quote: '___\n\n<br />',
}
// Each row: source, retained prefix, first-line prefix, continuation prefix,
// blank-line prefix, divider form. Original list markers and indentation stay literal.
const contexts = {
  paragraph: ['TARGET', '', '', '', '', 'paragraph'],
  list: ['* TARGET', '', '* ', '  ', '', 'list'],
  hyphen: ['- TARGET', '', '- ', '  ', '', 'list'],
  plus: ['+ TARGET', '', '+ ', '  ', '', 'list'],
  ordered: ['1. TARGET', '', '1. ', '   ', '', 'list'],
  parenthesized: ['1) TARGET', '', '1) ', '   ', '', 'list'],
  task: ['- [ ] TARGET', '- [ ] <br />\n', '  ', '  ', '', 'list'],
  nested: ['- a\n  - TARGET', '- a\n', '  - ', '    ', '', 'list'],
  quotedList: ['> - TARGET', '', '> - ', '>   ', '>', 'list'],
  calloutList: [
    '> [!TIP]\n> - TARGET',
    '> [!TIP]\n',
    '> - ',
    '>   ',
    '>',
    'list',
  ],
  hardBreakList: ['- aTARGET', '- a\n', '  ', '  ', '', 'list'],
  quote: ['> TARGET', '', '> ', '> ', '>', 'quote'],
  callout: ['> [!TIP]\n> TARGET', '> [!TIP]\n', '> ', '> ', '>', 'quote'],
} as const

function expectedMarkdown(
  context: keyof typeof contexts,
  command: keyof typeof commandBodies,
  ending: string,
) {
  const [, before, first, continuation, blank, divider] = contexts[context]
  const body =
    command === 'Divider' ? dividerBodies[divider] : commandBodies[command]
  const wrapped = body
    .split('\n')
    .map((line, index) =>
      line ? `${index === 0 ? first : continuation}${line}` : blank,
    )
    .join('\n')
  return `Before  \n\n${before}${wrapped}\n\nAfter _unchanged_.\n`.replaceAll(
    '\n',
    ending,
  )
}
for (const ending of ['\n', '\r\n']) {
  for (const name of Object.keys(contexts) as (keyof typeof contexts)[]) {
    const [body] = contexts[name]
    for (const command of commands)
      test(`${name} ${JSON.stringify(ending)}: ${command} saves, reopens, undoes and redoes`, async () => {
        const source = `Before  \n\n${body}\n\nAfter _unchanged_.\n`.replaceAll(
          '\n',
          ending,
        )
        const { editor, root, errors } = await mount(source)
        editor.find('TARGET')
        editor.insertText('', 1)
        if (name === 'hardBreakList')
          editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
        const before = editor.snapshot().text
        editor.insertText('/', 1)
        expect(root.querySelector('[role=listbox]')).not.toBeNull()
        const row = [...root.querySelectorAll('[role=option]')].find(
          (el) => el.textContent === command,
        )
        expect(row, command).toBeDefined()
        row!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        if (command === 'Callout') {
          const note = [...root.querySelectorAll('[role=option]')].find(
            (el) => el.textContent === 'Note',
          )!
          note.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
        expect(errors).toEqual([])
        const selectors: Record<string, string> = {
          'Heading 1': 'h1',
          'Heading 2': 'h2',
          'Heading 3': 'h3',
          'Bulleted List': 'ul',
          'Numbered List': 'ol',
          Checklist: 'li[data-item-type="task"]',
          Quote: 'blockquote',
          'Code Block': 'pre',
          Table: 'table',
          Callout: '.inkkit-callout',
          Divider: 'hr',
          Diagram: 'pre',
        }
        expect(root.querySelector(selectors[command]!)).not.toBeNull()
        const saved = editor.snapshot().text
        expect(saved).toBe(expectedMarkdown(name, command, ending))
        expect(editor.textSnapshot().text).not.toContain('/')
        expect(saved.startsWith(`Before  ${ending}${ending}`)).toBe(true)
        expect(
          saved.endsWith(`${ending}${ending}After _unchanged_.${ending}`),
        ).toBe(true)
        expect(saved.replaceAll('\r\n', '')).not.toContain(
          ending === '\r\n' ? '\n' : '\r',
        )
        const reader = await mount(saved)
        expect(reader.editor.snapshot().text).toBe(saved)
        expect(reader.root.querySelector(selectors[command]!)).not.toBeNull()
        expect(reader.editor.textSnapshot().text).toBe(
          editor.textSnapshot().text,
        )
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(before)
        expect(editor.redo()).toBe(true)
        expect(editor.snapshot().text).toBe(saved)
      })
  }
}

test('off by default; enabling and command names are validated', async () => {
  const { editor, root } = await mount('', {})
  editor.insertText('/', 1)
  expect(root.querySelector('[role=listbox]')).toBeNull()
  for (const slashMenu of [
    { enabled: 'yes' },
    { enabled: true, commands: ['typo'] },
    { enabled: true, unknown: true },
  ]) {
    await expect(mount('', { slashMenu } as never)).rejects.toMatchObject({
      code: 'invalid-argument',
    })
  }
})

test('an unrelated host edit closes the menu and cannot be rolled back', async () => {
  const { editor, root } = await mount('Before\n\nTARGET\n')
  editor.find('TARGET')
  editor.insertText('', 1)
  editor.insertText('/', 1)
  expect(root.querySelector('[role=listbox]')).not.toBeNull()
  editor.replaceAll('Before', 'Update')
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toContain('Update')
})
test('presentation changes close the menu without restoring old policy', async () => {
  const { editor, root } = await mount('%%hidden%%\n\nTARGET\n')
  editor.find('TARGET')
  editor.insertText('', 1)
  editor.insertText('/', 1)
  editor.setCommentsVisible(true)
  expect(root.querySelector('[role=listbox]')).toBeNull()
  expect(editor.snapshot().text).toContain('%%hidden%%')
})

for (const context of ['heading', 'hard break']) {
  test(`opens on an empty ${context} line and keeps preceding content through undo and redo`, async () => {
    const { editor, root, errors } = await mount(
      context === 'heading'
        ? '## TARGET\r\n\r\nAfter _kept_.\r\n'
        : 'Before lineTARGET\r\n\r\nAfter _kept_.\r\n',
    )
    editor.find('TARGET')
    editor.insertText('', 1)
    if (context === 'hard break')
      editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
    const before = editor.snapshot().text
    editor.insertText('/', 1)
    editor.insertText('h1', 1)
    expect(root.querySelector('[role=listbox]')).not.toBeNull()
    editor.keyDown({ key: 'Enter' }, 1)
    expect(root.querySelector('h1')).not.toBeNull()
    const saved = editor.snapshot().text
    if (context === 'hard break') expect(saved).toContain('Before line')
    expect(saved).toContain('After _kept_.\r\n')
    expect(errors).toEqual([])
    editor.undo()
    expect(editor.snapshot().text).toBe(before)
    editor.redo()
    expect(editor.snapshot().text).toBe(saved)
  })
}

test('the combobox does not keep textbox-only attributes and an empty result has valid listbox structure', async () => {
  const { editor, root } = await mount('')
  editor.insertText('/', 1)
  expect(
    root.querySelector('[role=combobox]')?.hasAttribute('aria-multiline'),
  ).toBe(false)
  editor.insertText('no-such-command', 1)
  expect(
    root.querySelector('[role=listbox] [role=option][aria-disabled=true]')
      ?.textContent,
  ).toBe('No matches')
  editor.keyDown({ key: 'Escape' }, 1)
  expect(
    root.querySelector('[role=textbox]')?.getAttribute('aria-multiline'),
  ).toBe('true')
})

test('typing after a divider uses a new paragraph and leaves the following block alone', async () => {
  const { editor, root } = await mount('Before\n\nTARGET\n\nAfter\n')
  editor.find('TARGET')
  editor.insertText('', 1)
  editor.insertText('/', 1)
  editor.insertText('divider', 1)
  editor.keyDown({ key: 'Enter' }, 1)
  const divided = editor.snapshot().text
  editor.insertText('New', 1)
  expect(editor.snapshot().text).toBe('Before\n\n---\n\nNew\n\nAfter\n')
  expect(root.querySelector('hr')).not.toBeNull()
  editor.undo()
  expect(editor.snapshot().text).toBe(divided)
})

for (const outcome of ['resolve', 'reject'] as const) {
  test(`a pending host action ${outcome}s silently after destruction`, async () => {
    let resolve!: (value: string) => void
    let reject!: (error: Error) => void
    const pending = new Promise<string>((yes, no) => {
      resolve = yes
      reject = no
    })
    const { editor, errors } = await mount('', {
      slashMenu: {
        enabled: true,
        commands: [],
        customCommands: [{ name: 'Host', action: () => pending }],
      },
    })
    editor.insertText('/', 1)
    editor.keyDown({ key: 'Enter' }, 1)
    await editor.destroy()
    editors.splice(editors.indexOf(editor), 1)
    if (outcome === 'resolve') resolve('Note')
    else reject(new Error('Host closed'))
    await new Promise((done) => setTimeout(done, 0))
    expect(errors).toEqual([])
  })
}

for (const source of ['', '## TARGET\r\n\r\nAfter _kept_.\r\n']) {
  test(`an empty host result restores the original block: ${JSON.stringify(source)}`, async () => {
    const { editor, root, errors } = await mount(source, {
      slashMenu: {
        enabled: true,
        commands: [],
        customCommands: [{ name: 'Clear', action: () => '' }],
      },
    })
    if (source) {
      editor.find('TARGET')
      editor.insertText('', 1)
    }
    const before = editor.snapshot().text
    editor.insertText('/', 1)
    editor.keyDown({ key: 'Enter' }, 1)
    expect(editor.snapshot().text).toBe(before)
    if (source) expect(root.querySelector('h2')).not.toBeNull()
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(before)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(before)
    expect(errors).toEqual([])
  })
}

// A failure thrown or rejected by the host's action is reported as `slash-command-failed`, with the
// original error as `cause`. An `InkKitError` of the host's own passes through unchanged.
const hostFailures: [string, unknown][] = [
  ['an Error', new RangeError('Host broke')],
  ['a string', 'Host broke'],
  ['an InkKitError', new InkKitError('file-unavailable', 'Host file')],
]
for (const [name, failure] of hostFailures) {
  for (const timing of ['throws', 'rejects']) {
    test(`a host action that ${timing} ${name} reports it and keeps the typed text`, async () => {
      const { editor, errors } = await mount('', {
        slashMenu: {
          enabled: true,
          commands: [],
          customCommands: [
            {
              name: 'Host',
              action: () => {
                if (timing === 'throws') throw failure
                return Promise.reject(failure)
              },
            },
          ],
        },
      })
      editor.insertText('/', 1)
      editor.insertText('ho', 1)
      const before = editor.snapshot()
      editor.keyDown({ key: 'Enter' }, 1)
      await new Promise((done) => setTimeout(done, 0))
      if (failure instanceof InkKitError) expect(errors).toEqual([failure])
      else {
        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(InkKitError)
        expect(errors[0]).toMatchObject({
          code: 'slash-command-failed',
          cause: failure,
        })
      }
      expect(editor.snapshot()).toEqual(before)
      expect(editor.snapshot().text).toBe('/ho\n')
      // The editor is still usable.
      expect(editor.insertText('!', 1)).toBe(true)
    })
  }
}

test('a failure in Inkkit own insert is not blamed on the host action', async () => {
  const { editor, errors } = await mount('', {
    slashMenu: {
      enabled: true,
      commands: [],
      customCommands: [{ name: 'Host', action: async () => 'Note' }],
    },
  })
  const cause = new TypeError('Inkkit broke')
  editor.insertText('/', 1)
  vi.spyOn(
    editor as unknown as { assertMutation(): void },
    'assertMutation',
  ).mockImplementation(() => {
    throw cause
  })
  editor.keyDown({ key: 'Enter' }, 1)
  await new Promise((done) => setTimeout(done, 0))
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({ code: 'internal', cause })
})

test('a host action that returns something other than text still reports invalid-argument', async () => {
  const { editor, errors } = await mount('', {
    slashMenu: {
      enabled: true,
      commands: [],
      customCommands: [{ name: 'Host', action: (() => 5) as never }],
    },
  })
  editor.insertText('/', 1)
  editor.keyDown({ key: 'Enter' }, 1)
  expect(errors).toEqual([
    expect.objectContaining({ code: 'invalid-argument' }),
  ])
})
