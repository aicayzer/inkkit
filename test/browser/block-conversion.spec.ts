import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Typing a fence and joining blocks run through the browser's keyboard and
// input events, which jsdom does not reproduce.

async function open(page: Page, source: string) {
  await operation(page, 'replaceSource', { text: source })
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe(source)
  await operation(page, 'commentsVisible', { visible: true })
}

// Readable offsets leave comments out; `find` is the readable text to put the caret before or after.
async function caret(page: Page, find: string, after = false) {
  await operation(page, 'textSnapshot')
  const { snapshotId, text } = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const index = text.indexOf(find)
  expect(index).toBeGreaterThanOrEqual(0)
  const at = after ? index + find.length : index
  await operation(page, 'selectTextRange', {
    range: { snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

async function expectSaved(page: Page, text: string) {
  await expect.poll(async () => (await observe(page)).snapshot?.text).toBe(text)
  expect((await observe(page)).diagnostics).toEqual([])
}

test('typing a fence before a paragraph keeps its comments as code', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, 'A <!--note--> %%other%% **B**\n')
  await caret(page, 'A')
  await page.keyboard.type('``` ')
  await expectSaved(page, '```\nA <!--note--> %%other%% **B**\n```\n')
})

for (const [name, find, after, key] of [
  ['Delete at the end of code', 'code', true, 'Delete'],
  ['Backspace at the start of the paragraph', 'A', false, 'Backspace'],
] as const)
  test(`${name} joins the paragraph as source`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, '```\ncode\n```\n\nA <!--n--> **B**\n')
    await caret(page, find, after)
    await page.keyboard.press(key)
    await expectSaved(page, '```\ncodeA <!--n--> **B**\n```\n')
  })

test('Backspace at the start of a heading after code lowers it, then joins it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, '```\ncode\n```\n\n# A <!--n--> **B**\n')
  await caret(page, 'A')
  await page.keyboard.press('Backspace')
  await expectSaved(page, '```\ncode\n```\n\nA <!--n--> **B**\n')
  await page.keyboard.press('Backspace')
  await expectSaved(page, '```\ncodeA <!--n--> **B**\n```\n')
})

test('Backspace after a visible block comment leaves both blocks as written', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, '<!--\nnote\n-->\n\nVisible text\n')
  await caret(page, 'Visible')
  await page.keyboard.press('Backspace')
  await expectSaved(page, '<!--\nnote\n-->\n\nVisible text\n')
})
