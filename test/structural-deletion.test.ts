import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/core'
const cases = [
  ['html-break', 'two<br />more\n', '<br />more\n'],
  ['tight-nested', '- two\n  * nested\n  * more\n', '- * nested\n  * more\n'],
  [
    'tight-ordered',
    '- two\n  1) nested\n  2) more\n',
    '- 1) nested\n  2) more\n',
  ],
  ['tight-heading', '- two\n  ## Title ##\n', '- ## Title ##\n'],
  ['tight-quote', '- two\n  > nested\n  > more\n', '- > nested\n  > more\n'],
  [
    'tight-fence',
    '- two\n  ```js\n  nested\n  ```\n',
    '- ```js\n  nested\n  ```\n',
  ],
  [
    'loose-nested',
    '- two\n\n  * nested\n  * more\n',
    '- <br />\n\n  * nested\n  * more\n',
  ],
  ['wrapped-paragraph', 'two\nmore\n', 'more\n'],
  ['wrapped-list', '- two\n  more\n', '- more\n'],
  ['wrapped-quote', '> two\n> more\n', '> more\n'],
  [
    'crlf-nested',
    '+ two\r\n  * nested\r\n  * more\r\n',
    '+ * nested\r\n  * more\r\n',
  ],
  ['crlf-wrapped', '> two\r\n> more 🌍\r\n', '> more 🌍\r\n'],
] as const
for (const [name, source, expected] of cases) {
  test(`deleting an introductory line through the facade: ${name}`, async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error(error) {
        errors.push(error)
      },
    })
    try {
      editor.loadDocument({
        documentId: 'deletion',
        generation: 1,
        format: 'md',
        text: source,
      })
      const unchanged = editor.snapshot()
      expect(() => editor.replace('two', '', 0)).toThrow('Document changed')
      expect(editor.snapshot()).toEqual(unchanged)
      editor.setEditable(false)
      expect(() => editor.replace('two', '', 1)).toThrow('read-only')
      expect(editor.snapshot()).toEqual(unchanged)
      editor.setEditable(true)
      expect(editor.replace('two', '', 1)).toBe(true)
      expect(editor.snapshot().text).toBe(expected)
      expect(errors).toEqual([])
      expect(editor.undo(1)).toBe(true)
      expect(editor.snapshot().text).toBe(source)
      expect(editor.redo(1)).toBe(true)
      expect(editor.snapshot().text).toBe(expected)
      editor.loadDocument({
        documentId: 'reopen',
        generation: 2,
        format: 'md',
        text: expected,
      })
      expect(editor.snapshot().text).toBe(expected)
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
}

test.each(['two  \nmore\n', 'two<br />more\n', '[two][missing]\nmore\n'])(
  'deliberate breaks and unsupported syntax remain authored: %j',
  async (source) => {
    const root = document.createElement('div')
    document.body.append(root)
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error(error) {
        errors.push(error)
      },
    })
    try {
      editor.loadDocument({
        documentId: 'controls',
        generation: 1,
        format: 'md',
        text: source + '\nKeep\n',
      })
      expect(editor.replace('Keep', 'Changed', 1)).toBe(true)
      expect(editor.snapshot().text).toBe(source + '\nChanged\n')
      expect(errors).toEqual([])
    } finally {
      await editor.destroy()
      root.remove()
    }
  },
)

test.each(['\n', '\r\n'])(
  'one replacement normalises several changed blocks: %j',
  async (ending) => {
    const source =
      'two\nfirst 🌍\n\n- two\n  second\n\n> two\n> third\n\nUnchanged [r][ref].\n\n[ref]: /keep\n'.replaceAll(
        '\n',
        ending,
      )
    const expected =
      'first 🌍\n\n- second\n\n> third\n\nUnchanged [r][ref].\n\n[ref]: /keep\n'.replaceAll(
        '\n',
        ending,
      )
    const root = document.createElement('div')
    document.body.append(root)
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error(error) {
        errors.push(error)
      },
    })
    try {
      editor.loadDocument({
        documentId: 'batch',
        generation: 1,
        format: 'md',
        text: source,
      })
      const before = editor.snapshot()
      expect(editor.replaceAll('two', '', 1)).toBe(3)
      expect(editor.snapshot().text).toBe(expected)
      expect(editor.snapshot().revision).toBe(before.revision + 1)
      expect(errors).toEqual([])
      expect(editor.undo(1)).toBe(true)
      expect(editor.snapshot().text).toBe(source)
      expect(editor.redo(1)).toBe(true)
      expect(editor.snapshot().text).toBe(expected)
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: expected,
      })
      expect(editor.snapshot().text).toBe(expected)
    } finally {
      await editor.destroy()
      root.remove()
    }
  },
)

const closingCases = [
  ['wrapped-paragraph', 'first\nlast\n', 'last', 'first\n'],
  [
    'followed-paragraph',
    'first\nlast\n\nAfter.\n',
    'last',
    'first\n\nAfter.\n',
  ],
  ['no-final-ending', 'first\nlast', 'last', 'first'],
  ['single-character', 'first\nZ\n', 'Z', 'first\n'],
  ['wrapped-list', '- first\n  last\n', 'last', '- first\n'],
  ['wrapped-quote', '> first\n> last\n', 'last', '> first\n'],
  [
    'wrapped-callout',
    '> [!NOTE]\n> first\n> last\n',
    'last',
    '> [!NOTE]\n> first\n',
  ],
  ['middle-line', 'one\nmiddle\nlast\n', 'middle', 'one\nlast\n'],
  ['crlf-wrapped', '> first 🌍\r\n> last\r\n', 'last', '> first 🌍\r\n'],
  [
    'crlf-middle',
    'one 🌍\r\nmiddle\r\nlast\r\n',
    'middle',
    'one 🌍\r\nlast\r\n',
  ],
] as const
for (const [name, source, line, expected] of closingCases) {
  test(`deleting a closing or middle line through the facade: ${name}`, async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      copy() {},
      openLink() {},
      error(error) {
        errors.push(error)
      },
    })
    try {
      const tail = '\nUnchanged [r][ref].\n\n[ref]: /keep\n'
      const ending = source.includes('\r\n') ? '\r\n' : '\n'
      const withTail = (text: string) =>
        text.endsWith(ending) ? text + tail.replaceAll('\n', ending) : text
      editor.loadDocument({
        documentId: 'closing',
        generation: 1,
        format: 'md',
        text: withTail(source),
      })
      const before = editor.snapshot()
      expect(editor.replace(line, '', 1)).toBe(true)
      expect(editor.snapshot().text).toBe(withTail(expected))
      expect(editor.snapshot().revision).toBe(before.revision + 1)
      expect(errors).toEqual([])
      expect(editor.undo(1)).toBe(true)
      expect(editor.snapshot().text).toBe(withTail(source))
      expect(editor.redo(1)).toBe(true)
      expect(editor.snapshot().text).toBe(withTail(expected))
      editor.loadDocument({
        documentId: 'reopen',
        generation: 2,
        format: 'md',
        text: withTail(expected),
      })
      expect(editor.snapshot().text).toBe(withTail(expected))
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
}

test('emptying the closing lines one after another keeps the first', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error(error) {
      errors.push(error)
    },
  })
  try {
    editor.loadDocument({
      documentId: 'closing',
      generation: 1,
      format: 'md',
      text: 'one\ntwo\nlast\n',
    })
    expect(editor.replace('two', '', 1)).toBe(true)
    expect(editor.snapshot().text).toBe('one\nlast\n')
    expect(editor.replace('last', '', 1)).toBe(true)
    expect(editor.snapshot().text).toBe('one\n')
    expect(errors).toEqual([])
  } finally {
    await editor.destroy()
    root.remove()
  }
})
