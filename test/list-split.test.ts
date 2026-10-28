import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor } from '../src/editor'
import { semanticSignature } from '../src/preserve'

// Presses keys at the end of the first match of `at`, as a person would, and
// returns what the editor saves. The saved text must reopen as the document
// the keys made, unchanged and clean.
async function press(
  source: string,
  at: string,
  keys: string[],
): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    editor.loadDocument({
      documentId: 'lists',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = ctxOf(editor)
    const view = ctx.get(editorViewCtx)
    const caret = (text: string, end: boolean) => {
      editor.find(text)
      const { from, to, empty } = view.state.selection
      expect(empty).toBe(false)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, end ? to : from),
        ),
      )
    }
    caret(at, true)
    for (const key of keys) {
      // `type:` types text at the caret; `end:` and `start:` move the caret
      // to the end or start of some text, and `end of note` to the end of the
      // note; `tick:` toggles the task holding some text, as a click on its
      // checkbox does.
      const [action, text] = key.split(/:(.*)/s)
      if (action === 'type') {
        expect(editor.insertText(text!, 1)).toBe(true)
        continue
      }
      if (key === 'end of note') {
        view.dispatch(
          view.state.tr.setSelection(Selection.atEnd(view.state.doc)),
        )
        continue
      }
      if (action === 'end' || action === 'start') {
        caret(text!, action === 'end')
        continue
      }
      if (action === 'tick') {
        caret(text!, true)
        const $at = view.state.selection.$from
        const item = $at.node(-1)
        view.dispatch(
          view.state.tr.setNodeMarkup($at.before(-1), undefined, {
            ...item.attrs,
            checked: !item.attrs.checked,
          }),
        )
        continue
      }
      const [name, shift] = key === 'Shift-Tab' ? ['Tab', true] : [key, false]
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: name,
          shiftKey: shift,
          bubbles: true,
        }),
      )
    }
    expect(errors).toEqual([])
    const saved = editor.snapshot().text
    const edited = semanticSignature(view.state.doc)
    editor.loadDocument({
      documentId: 'lists',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
    expect(semanticSignature(view.state.doc)).toBe(edited)
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const styles: Array<[string, string[], string]> = [
  ...['-', '*', '+'].map((marker): [string, string[], string] => [
    `${marker} bullets`,
    [`${marker} __a__ one`, `${marker} _b_ two`, `${marker} c __three__`],
    '\n',
  ]),
  ...['.', ')'].map((delimiter): [string, string[], string] => [
    `${delimiter} numbers from 3`,
    [
      `3${delimiter} __a__ one`,
      `4${delimiter} _b_ two`,
      `5${delimiter} c __three__`,
    ],
    '\n',
  ]),
  ...['-', '*'].map((marker): [string, string[], string] => [
    `${marker} tasks`,
    [
      `${marker} [ ] __a__ one`,
      `${marker} [x] _b_ two`,
      `${marker} [ ] c __three__`,
    ],
    '\n',
  ]),
  ['loose + bullets', ['+ __a__ one', '+ _b_ two', '+ c __three__'], '\n\n'],
]

test.each(
  styles.flatMap(([name, lines, gap]) =>
    ['a one', 'b two', 'c three'].map(
      (at, index): [string, string, string[], string, number] => [
        name,
        at,
        lines,
        gap,
        index + 1,
      ],
    ),
  ),
)(
  'Enter twice in a list with %s, after %j, keeps every item as written',
  async (_, at, lines, gap, count) => {
    const before = lines.slice(0, count).join(gap)
    const after = lines.slice(count).join(gap)
    expect(await press(lines.join(gap) + '\n', at, ['Enter', 'Enter'])).toBe(
      after ? `${before}\n\n<br />\n\n${after}\n` : `${before}\n\n<br />\n`,
    )
  },
)

test.each([
  [
    'CRLF line endings',
    '* __a__ one\r\n* _b_ two\r\n* c three\r\n',
    'b two',
    ['Enter', 'Enter'],
    '* __a__ one\r\n* _b_ two\r\n\r\n<br />\r\n\r\n* c three\r\n',
  ],
  [
    'a list in a quote',
    '> * __a__ one\n> * b two\n> * _c_ three\n',
    'b two',
    ['Enter', 'Enter'],
    '> * __a__ one\n> * b two\n>\n> <br />\n>\n> * _c_ three\n',
  ],
  [
    'a quote split by Enter on an empty line',
    '> __a__ one\n>\n> b two\n>\n> _c_ three\n',
    'b two',
    ['Enter', 'Enter'],
    '> __a__ one\n>\n> b two\n\n> <br />\n>\n> _c_ three\n',
  ],
  [
    'a quote ended in the middle',
    '> __a__ one\n>\n> b two\n>\n> _c_ three\n',
    'b two',
    ['Enter', 'Enter', 'Enter'],
    '> __a__ one\n>\n> b two\n\n<br />\n\n> _c_ three\n',
  ],
  [
    'a quote in a list item',
    '- x\n\n  > __a__ one\n  >\n  > b two\n  >\n  > _c_ three\n',
    'b two',
    ['Enter', 'Enter', 'Enter'],
    '- x\n\n  > __a__ one\n  >\n  > b two\n\n  <br />\n\n  > _c_ three\n',
  ],
  [
    'a nested list ended in the middle',
    '* __a__ one\n  * b two\n  * _c_ three\n* d\n',
    'b two',
    ['Enter', 'Enter'],
    '* __a__ one\n  * b two\n* * _c_ three\n* d\n',
  ],
  [
    'a nested ordered list ended in the middle',
    '* __a__ one\n  1) b two\n  2) _c_ three\n  3) d\n* e\n',
    'b two',
    ['Enter', 'Enter'],
    '* __a__ one\n  1) b two\n* 1) _c_ three\n  2) d\n* e\n',
  ],
  [
    'a nested list ended at its last item',
    '* __a__ one\n  * b two\n  * _c_ three\n',
    'c three',
    ['Enter', 'Enter'],
    '* __a__ one\n  * b two\n  * _c_ three\n* <br />\n',
  ],
  [
    'a nested list in an ordered list in a quote',
    '> 1. __a__\n>    * b two\n>    * _c_ three\n',
    'b two',
    ['Enter', 'Enter'],
    '> 1. __a__\n>    * b two\n> 2. * _c_ three\n',
  ],
  [
    'Backspace after ending a list, which joins the list again',
    '* __a__ one\n* b two\n* _c_ three\n',
    'b two',
    ['Enter', 'Enter', 'Backspace'],
    '* __a__ one\n* b two\n* _c_ three\n',
  ],
  [
    'Shift-Tab on an item in the middle of an ordered list',
    '3) __a__ one\n4) b two\n5) _c_ three\n',
    'b two',
    ['Shift-Tab'],
    '3) __a__ one\n\nb two\n\n4) _c_ three\n',
  ],
  [
    'Shift-Tab on a nested ordered item into a bullet list, which renumbers the item after it',
    '* __a__ one\n  1) b two\n  2) _c_ three\n* e\n',
    'b two',
    ['Shift-Tab'],
    '* __a__ one\n* b two\n  1) _c_ three\n* e\n',
  ],
  [
    'Delete joining two lists',
    '* __a__ one\n* b two\n\n- _c_ three\n',
    'b two',
    ['Delete'],
    '* __a__ one\n* b two\n* _c_ three\n',
  ],
  [
    'Tab on an item of an ordered list',
    '1) __a__\n2) _b_\n3) c\n',
    'b',
    ['Tab'],
    '1) __a__\n   1) _b_\n3) c\n',
  ],
  [
    'Shift-Tab on a nested ordered item in an ordered list',
    '1. __a__\n   1) b\n   2) _c_\n   3) d\n2. e\n',
    'c',
    ['Shift-Tab'],
    '1. __a__\n   1) b\n2. _c_\n   1) d\n2. e\n',
  ],
  [
    'a nested ordered list in an ordered list ended in the middle',
    '1. __a__ one\n   1) b two\n   2) _c_ three\n2. e\n',
    'b two',
    ['Enter', 'Enter'],
    '1. __a__ one\n   1) b two\n2. 1) _c_ three\n2. e\n',
  ],
  [
    'typing in the item a nested ordered list ended at',
    '* __a__ one\n  1) b two\n  2) _c_ three\n  3) d\n* e\n',
    'b two',
    ['Enter', 'Enter', 'type:x'],
    '* __a__ one\n  1) b two\n* x\n  1) _c_ three\n  2) d\n* e\n',
  ],
  [
    'Shift-Tab on the first item of an ordered list',
    '1. __a__ one\n2. _b_ two\n',
    'a one',
    ['Shift-Tab'],
    '__a__ one\n\n1. _b_ two\n',
  ],
  [
    'Shift-Tab on the first item of an ordered list from 3',
    '3. __a__ one\n4. _b_ two\n',
    'a one',
    ['Shift-Tab'],
    '__a__ one\n\n3. _b_ two\n',
  ],
  [
    'a list numbered 1. throughout, ended after its first item',
    '1. a\n1. _b_\n1. c\n',
    'a',
    ['Enter', 'Enter'],
    '1. a\n\n<br />\n\n2. _b_\n1. c\n',
  ],
  [
    'a list numbered with leading zeros, ended after its first item',
    '01. a\n02. _b_\n03. c\n',
    'a',
    ['Enter', 'Enter'],
    '01. a\n\n<br />\n\n02. _b_\n03. c\n',
  ],
  [
    'a list numbered past 9, ended after its first item',
    '8. a\n9. _b_\n10. c\n11. d\n',
    'a',
    ['Enter', 'Enter'],
    '8. a\n\n<br />\n\n9. _b_\n10. c\n11. d\n',
  ],
  [
    'a long list of equal items ended in the middle',
    `${'* _x_\n'.repeat(400)}* mid\n${'* _x_\n'.repeat(400)}`,
    'mid',
    ['Enter', 'Enter'],
    `${'* _x_\n'.repeat(400)}* mid\n\n<br />\n\n${'* _x_\n'.repeat(400)}`,
  ],
  [
    'ticking a task in a list that was not split',
    '- [ ] __alpha__\n- [ ] _beta_\n- [ ] __gamma__\n',
    'beta',
    ['tick:gamma'],
    '- [ ] __alpha__\n- [ ] _beta_\n- [x] __gamma__\n',
  ],
  [
    'a task ticked in the second part of a split list',
    '- [ ] __a__\n- [ ] _b_\n- [ ] __c__\n- [ ] _d_\n',
    'a',
    ['Enter', 'Enter', 'tick:c'],
    '- [ ] __a__\n\n<br />\n\n- [ ] _b_\n- [x] __c__\n- [ ] _d_\n',
  ],
  [
    'a task ticked in the first part of a split list',
    '- [ ] __a__\n- [ ] _b_\n- [ ] __c__\n- [ ] _d_\n',
    'c',
    ['Enter', 'Enter', 'tick:a'],
    '- [x] __a__\n- [ ] _b_\n- [ ] __c__\n\n<br />\n\n- [ ] _d_\n',
  ],
  [
    'a part whose items repeat with other spellings in the part before it',
    '* __a__\n* b\n* __a__\n* c\n* **a**\n* d\n',
    'c',
    ['Enter', 'Enter', 'end:d', 'type:!', 'Enter', 'type:new'],
    '* __a__\n* b\n* __a__\n* c\n\n<br />\n\n* **a**\n* d!\n* new\n',
  ],
  [
    'an item added at the end of the second part',
    '* __alpha__\n* _beta_\n* __gamma__\n* _delta_\n* epsilon\n',
    'beta',
    ['Enter', 'Enter', 'end:epsilon', 'Enter', 'type:new'],
    '* __alpha__\n* _beta_\n\n<br />\n\n* __gamma__\n* _delta_\n* epsilon\n* new\n',
  ],
  [
    'an item added at the start of the second part',
    '* __alpha__\n* _beta_\n* __gamma__\n* _delta_\n* epsilon\n',
    'beta',
    ['Enter', 'Enter', 'start:gamma', 'Enter'],
    '* __alpha__\n* _beta_\n\n<br />\n\n* <br />\n* __gamma__\n* _delta_\n* epsilon\n',
  ],
  [
    'an item added at the end of the first part',
    '* __alpha__\n* _beta_\n* __gamma__\n* _delta_\n* epsilon\n',
    'gamma',
    ['Enter', 'Enter', 'end:gamma', 'Enter', 'type:new'],
    '* __alpha__\n* _beta_\n* __gamma__\n* new\n\n<br />\n\n* _delta_\n* epsilon\n',
  ],
  [
    'an item added at the start of the first part',
    '* __alpha__\n* _beta_\n* __gamma__\n* _delta_\n* epsilon\n',
    'gamma',
    ['Enter', 'Enter', 'start:alpha', 'Enter'],
    '* <br />\n* __alpha__\n* _beta_\n* __gamma__\n\n<br />\n\n* _delta_\n* epsilon\n',
  ],
  [
    'the first and last items of the second part edited',
    '* __alpha__\n* _beta_\n* __gamma__\n* _delta_\n* epsilon\n',
    'beta',
    ['Enter', 'Enter', 'end:gamma', 'type:!', 'end:epsilon', 'type:!'],
    '* __alpha__\n* _beta_\n\n<br />\n\n* __gamma!__\n* _delta_\n* epsilon!\n',
  ],
  [
    'the first and last tasks of the second part ticked',
    '- [ ] __alpha__\n- [ ] _beta_\n- [ ] __gamma__\n- [ ] _delta_\n- [ ] epsilon\n',
    'beta',
    ['Enter', 'Enter', 'tick:gamma', 'tick:epsilon'],
    '- [ ] __alpha__\n- [ ] _beta_\n\n<br />\n\n- [x] __gamma__\n- [ ] _delta_\n- [x] epsilon\n',
  ],
  [
    'an item added at the end of a part of a long list of equal items',
    `${'* _x_\n'.repeat(400)}* mid\n${'* _x_\n'.repeat(400)}`,
    'mid',
    ['Enter', 'Enter', 'end of note', 'Enter', 'type:new'],
    `${'* _x_\n'.repeat(400)}* mid\n\n<br />\n\n${'* _x_\n'.repeat(400)}* new\n`,
  ],
  [
    'Backspace after ending a nested list in the middle',
    '* __a__ one\n  * b two\n  * _c_ three\n* d\n',
    'b two',
    ['Enter', 'Enter', 'Backspace'],
    '* __a__ one\n  * b two\n  * <br />\n  * _c_ three\n* d\n',
  ],
])('%s keeps the items it did not reach', async (_, source, at, keys, saved) =>
  expect(await press(source, at, keys)).toBe(saved),
)

test('undo after ending a list restores the authored list', async () => {
  const source = '* __a__ one\n* _b_ two\n* c three\n'
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      documentId: 'lists',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = ctxOf(editor)
    const view = ctx.get(editorViewCtx)
    editor.find('a one')
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.selection.to),
      ),
    )
    for (const _ of [1, 2])
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    expect(editor.snapshot().text).toBe(
      '* __a__ one\n\n<br />\n\n* _b_ two\n* c three\n',
    )
    while (editor.snapshot().dirty) expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(source)
  } finally {
    await editor.destroy()
    root.remove()
  }
})
