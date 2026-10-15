import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Puts the caret at the end of the first match of `at`.
async function caretAfter(page: Page, source: string, at: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await caretTo(page, at)
}

async function caretTo(page: Page, at: string) {
  await operation(page, 'find', { text: at })
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => {
      const { selection } = (await observe(page)).textSnapshot!
      return selection.to - selection.from
    })
    .toBe(0)
}

// The saved text reopens as itself, unchanged and clean.
async function reopens(page: Page, saved: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    saved,
  )
  await expect
    .poll(async () => (await observe(page)).snapshot)
    .toMatchObject({ text: saved, dirty: false })
}

for (const [name, source, at, keys, saved] of [
  [
    'a * list ended after its first item',
    '* __a__ one\n* _b_ two\n* c three\n',
    'a one',
    ['Enter', 'Enter'],
    '* __a__ one\n\n<br />\n\n* _b_ two\n* c three\n',
  ],
  [
    'a + list ended in the middle',
    '+ __a__ one\n+ _b_ two\n+ c three\n',
    'b two',
    ['Enter', 'Enter'],
    '+ __a__ one\n+ _b_ two\n\n<br />\n\n+ c three\n',
  ],
  [
    'a - list ended at its last item',
    '- __a__ one\n- _b_ two\n',
    'b two',
    ['Enter', 'Enter'],
    '- __a__ one\n- _b_ two\n\n<br />\n',
  ],
  [
    'a task list ended in the middle',
    '- [ ] __a__ one\n- [x] _b_ two\n- [ ] c three\n',
    'a one',
    ['Enter', 'Enter'],
    '- [ ] __a__ one\n\n<br />\n\n- [x] _b_ two\n- [ ] c three\n',
  ],
  [
    'a list in a quote ended in the middle',
    '> * __a__ one\n> * b two\n> * _c_ three\n',
    'b two',
    ['Enter', 'Enter'],
    '> * __a__ one\n> * b two\n>\n> <br />\n>\n> * _c_ three\n',
  ],
  [
    'a quote ended in the middle',
    '> __a__ one\n>\n> b two\n>\n> _c_ three\n',
    'b two',
    ['Enter', 'Enter', 'Enter'],
    '> __a__ one\n>\n> b two\n\n<br />\n\n> _c_ three\n',
  ],
  [
    'a nested list ended in the middle',
    '* __a__ one\n  * b two\n  * _c_ three\n* d\n',
    'b two',
    ['Enter', 'Enter'],
    '* __a__ one\n  * b two\n* * _c_ three\n* d\n',
  ],
  [
    'Backspace after ending a list',
    '* __a__ one\n* b two\n* _c_ three\n',
    'b two',
    ['Enter', 'Enter', 'Backspace'],
    '* __a__ one\n* b two\n* _c_ three\n',
  ],
  [
    'typing in the item a nested ordered list ended at',
    '* __a__ one\n  1) b two\n  2) _c_ three\n  3) d\n* e\n',
    'b two',
    ['Enter', 'Enter', 'x'],
    '* __a__ one\n  1) b two\n* x\n  1) _c_ three\n  2) d\n* e\n',
  ],
  [
    'a nested ordered list in an ordered list ended in the middle',
    '1. __a__ one\n   1) b two\n   2) _c_ three\n2. e\n',
    'b two',
    ['Enter', 'Enter'],
    '1. __a__ one\n   1) b two\n2. 1) _c_ three\n2. e\n',
  ],
  [
    'Tab on an item of an ordered list',
    '1) __a__\n2) _b_\n3) c\n',
    'b',
    ['Tab'],
    '1) __a__\n   1. *b*\n3) c\n',
  ],
  [
    'Shift+Tab on a nested ordered item in an ordered list',
    '1. __a__\n   1) b\n   2) _c_\n   3) d\n2. e\n',
    'c',
    ['Shift+Tab'],
    '1. __a__\n   1) b\n2. *c*\n   1) d\n2. e\n',
  ],
  [
    'Shift+Tab on the first item of an ordered list',
    '1. __a__ one\n2. _b_ two\n',
    'a one',
    ['Shift+Tab'],
    '**a** one\n\n1. _b_ two\n',
  ],
  [
    'Backspace after ending a nested list in the middle',
    '* __a__ one\n  * b two\n  * _c_ three\n* d\n',
    'b two',
    ['Enter', 'Enter', 'Backspace'],
    '* __a__ one\n  * b two\n  * <br />\n  * _c_ three\n* d\n',
  ],
  [
    'an item added at the end of the part after a split',
    '* __alpha__\n* _beta_\n* __gamma__\n* _delta_\n* epsilon\n',
    'beta',
    ['Enter', 'Enter', 'end:epsilon', 'Enter', 'n', 'e', 'w'],
    '* __alpha__\n* _beta_\n\n<br />\n\n* __gamma__\n* _delta_\n* epsilon\n* new\n',
  ],
] as const)
  test(`${name} keeps the items it did not reach`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await caretAfter(page, source, at)
    // `end:` moves the caret to the end of some text.
    for (const key of keys)
      if (key.startsWith('end:')) await caretTo(page, key.slice(4))
      else await page.keyboard.press(key)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(saved)
    // Undo returns to the authored list, in as many steps as history made.
    for (const _ of keys) {
      if (!(await observe(page)).snapshot!.dirty) break
      await page.keyboard.press('ControlOrMeta+z')
    }
    await expect
      .poll(async () => (await observe(page)).snapshot)
      .toMatchObject({ text: source, dirty: false })
    await reopens(page, saved)
  })

for (const delimiter of ['.', ')'])
  test(`an ordered list with ${delimiter} ended in the middle keeps its numbers`, async ({
    page,
    openFixture,
  }) => {
    const source = `3${delimiter} __a__ one\n4${delimiter} _b_ two\n5${delimiter} c three\n`
    await openFixture()
    await caretAfter(page, source, 'b two')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const saved = `3${delimiter} __a__ one\n4${delimiter} _b_ two\n\n<br />\n\n5${delimiter} c three\n`
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(saved)
    // The editor shows the numbers the file keeps.
    await expect(page.locator('.ProseMirror > ol')).toHaveCount(2)
    await expect(page.locator('.ProseMirror > ol').first()).toHaveAttribute(
      'start',
      '3',
    )
    await expect(page.locator('.ProseMirror > ol').last()).toHaveAttribute(
      'start',
      '5',
    )
    await reopens(page, saved)
  })
