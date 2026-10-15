import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Puts the caret at the end of the first match of `at`.
async function caretAfter(page: Page, source: string, at: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
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
] as const)
  test(`${name} keeps the items it did not reach`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await caretAfter(page, source, at)
    for (const key of keys) await page.keyboard.press(key)
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
