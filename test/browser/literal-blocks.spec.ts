import { test, expect, observe, caretAfterMatch } from './fixtures'
import type { Page } from '@playwright/test'

// Blocks kept as literal Markdown, edited with a person's keyboard: Enter at
// the end of one starts a paragraph, and removing what made one literal, or
// typing a blank line into one, reads it again as the blocks its text holds.

async function load(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md', 'literal'),
    text,
  )
  await expect.poll(async () => (await observe(page)).snapshot?.text).toBe(text)
}

async function saves(page: Page, expected: string) {
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe(expected)
  expect((await observe(page)).diagnostics).toEqual([])
  // The saved note reopens as it was edited.
  await load(page, expected)
  expect((await observe(page)).diagnostics).toEqual([])
}

const note = (block: string, ending: string) =>
  `Intro __bold__ and * star.\n\n${block}\n\n* item _one_\n`.replaceAll(
    '\n',
    ending,
  )

for (const [name, ending] of [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
] as const) {
  test(`Enter at the end of a literal paragraph starts a paragraph: ${name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await load(page, note('A [full][ref] x.', ending))
    await caretAfterMatch(page, 'ref] x.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Next *one*')
    await saves(page, note('A [full][ref] x.\n\nNext *one*', ending))
  })

  test(`Backspace through inline HTML saves a paragraph: ${name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await load(page, note('Hello <b>x</b>', ending))
    await caretAfterMatch(page, '</b>')
    for (let key = 0; key < '<b>x</b>'.length; key++)
      await page.keyboard.press('Backspace')
    await page.keyboard.type('there')
    await saves(page, note('Hello there', ending))
  })

  test(`a blank line typed into a literal paragraph splits it: ${name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await load(page, note('A [full][ref] x.\nMore words.', ending))
    await caretAfterMatch(page, 'ref] x.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Then ')
    await saves(page, note('A [full][ref] x.\n\nThen More words.', ending))
  })
}

test('Undo and redo cross the change between literal and formatted', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = note('Hello <span>x</span> there.', '\n')
  const edited = note('Hello  there.', '\n')
  await load(page, source)
  await caretAfterMatch(page, '</span>')
  for (let key = 0; key < '<span>x</span>'.length; key++)
    await page.keyboard.press('Backspace')
  const text = async () => (await observe(page)).snapshot?.text
  await expect.poll(text).toBe(edited)
  for (let step = 0; step < 20 && (await text()) !== source; step++)
    await page.keyboard.press('ControlOrMeta+z')
  expect(await text()).toBe(source)
  for (let step = 0; step < 20 && (await text()) !== edited; step++)
    await page.keyboard.press('ControlOrMeta+Shift+z')
  expect(await text()).toBe(edited)
  expect((await observe(page)).diagnostics).toEqual([])
})
