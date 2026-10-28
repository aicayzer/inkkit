import { controlInputTimers, finishInput } from './timing'
import type { Page } from '@playwright/test'
import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

// Smart quotes and dashes follow real key presses in the browser, which jsdom
// does not reproduce: the keys, the caret, Undo and Backspace.

async function load(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
  await expect.poll(async () => (await observe(page)).snapshot?.text).toBe(text)
}

const saved = (page: Page) =>
  expect.poll(async () => (await observe(page)).snapshot?.text)

const smart = (page: Page, smartPunctuation: boolean) =>
  operation(page, 'textInput', { preferences: { smartPunctuation } })

async function start(page: Page, text = '') {
  await load(page, text)
  await page.getByRole('textbox', { name: 'Formatted Markdown editor' }).click()
  await page.keyboard.press('ControlOrMeta+End')
}

test('quotes, apostrophes and dashes follow the keys when the option is on', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await smart(page, true)
  await start(page)
  await page.keyboard.type(`She said "it's 'fine'" -- or so --- they say (“x”)`)
  await saved(page).toBe(`She said “it’s ‘fine’” – or so — they say (“x”)\n`)
  expect((await observe(page)).diagnostics).toEqual([])
})

test('nothing changes with the option off, and turning it on or off needs no reload', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await start(page)
  await page.keyboard.type('"a" --')
  await saved(page).toBe('"a" --\n')
  await smart(page, true)
  await page.keyboard.type(' "b" --')
  await saved(page).toBe('"a" -- “b” –\n')
  await smart(page, false)
  await page.keyboard.type(' "c" --')
  await saved(page).toBe('"a" -- “b” – "c" --\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('Undo right after a quote or a dash restores the plain character', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await smart(page, true)
  await start(page)
  await page.keyboard.type('say "')
  await saved(page).toBe('say “\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('say "\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await saved(page).toBe('say "\n')
  await page.keyboard.type(' x --')
  await saved(page).toBe('say " x –\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('say " x --\n')
  await page.keyboard.type('-')
  await saved(page).toBe('say " x ---\n')
})

test('Undo with the option off is the ordinary Undo', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await start(page, 'one\n')
  await page.keyboard.type(' "a" --')
  await saved(page).toBe('one "a" --\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('one\n')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await saved(page).toBe('one "a" --\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('Backspace right after a quote restores the plain character', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await smart(page, true)
  await start(page)
  await page.keyboard.type("it'")
  await saved(page).toBe('it’\n')
  await page.keyboard.press('Backspace')
  await saved(page).toBe("it'\n")
})

test('--- on an empty line is a divider', async ({ page, openFixture }) => {
  await openFixture()
  await smart(page, true)
  await start(page, 'Above\n')
  await page.keyboard.press('Enter')
  await page.keyboard.type('---')
  await saved(page).toBe('Above\n\n---\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('it leaves code and existing text alone, and works in link text', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await smart(page, true)
  await start(
    page,
    'He said "hi" -- and `code` and [link](https://example.com/a--b)\n\n```\nblock\n```\n',
  )
  await caretAfterMatch(page, 'block')
  await page.keyboard.type(` "a" it's -- ---`)
  await caretAfterMatch(page, 'cod')
  await page.keyboard.type(`"'--`)
  await caretAfterMatch(page, 'lin')
  await page.keyboard.type(' "x"')
  await saved(page).toBe(
    'He said "hi" -- and `cod"\'--e` and [lin “x”k](https://example.com/a--b)\n\n```\nblock "a" it\'s -- ---\n```\n',
  )
  expect((await observe(page)).diagnostics).toEqual([])
})

test('source view types straight characters', async ({ page, openFixture }) => {
  await openFixture()
  await smart(page, true)
  await load(page, 'Plain')
  await operation(page, 'editingMode', { mode: 'source' })
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await source.press('ControlOrMeta+End')
  await page.keyboard.type(` "a" it's -- ---`)
  await saved(page).toBe(`Plain "a" it's -- ---`)
})

// Edit > Undo and the touch gestures arrive as beforeinput events, not keys.
const historyInput = (page: Page, inputType: 'historyUndo' | 'historyRedo') =>
  page
    .getByRole('textbox', { name: 'Formatted Markdown editor' })
    .evaluate((editor, inputType) => {
      const event = new InputEvent('beforeinput', {
        inputType,
        cancelable: true,
      })
      editor.dispatchEvent(event)
      // The editor handles it itself, so the browser has nothing left to do.
      if (!event.defaultPrevented) throw new Error('beforeinput not handled')
    }, inputType)

test('Undo and Redo from the menu or a gesture take the same path as the keys, with the option on', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await smart(page, true)
  await start(page, 'say\n')
  await page.keyboard.type(' "')
  await saved(page).toBe('say “\n')
  await historyInput(page, 'historyUndo')
  await saved(page).toBe('say "\n')
  await historyInput(page, 'historyUndo')
  await saved(page).toBe('say\n')
  await historyInput(page, 'historyRedo')
  await saved(page).toBe('say "\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('Undo and Redo from the menu or a gesture are the ordinary ones with the option off', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await start(page, 'one\n')
  await page.keyboard.type(' "a" --')
  await saved(page).toBe('one "a" --\n')
  await historyInput(page, 'historyUndo')
  await saved(page).toBe('one\n')
  await historyInput(page, 'historyRedo')
  await saved(page).toBe('one "a" --\n')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('a hyphen already in the note, or typed before the caret moved, stays a hyphen', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await smart(page, true)
  await start(page, 'a -\n')
  await page.keyboard.type('-')
  await saved(page).toBe('a --\n')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('-')
  await saved(page).toBe('a ---\n')
  await page.keyboard.type(' b --')
  await saved(page).toBe('a --- b –\n')
})

// A dead key, as on US International layouts, makes the quote through a composition.
test('a quote that a dead key makes follows the rules', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method',
  )
  await controlInputTimers(page)
  await openFixture()
  await smart(page, true)
  await start(page, 'say\n')
  await page.keyboard.type(' ')
  const session = await page.context().newCDPSession(page)
  for (const quote of ['"', "'"]) {
    await session.send('Input.imeSetComposition', {
      text: quote,
      selectionStart: 1,
      selectionEnd: 1,
    })
    await session.send('Input.insertText', { text: quote })
    await finishInput(page)
  }
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe('say “‘\n')
  expect((await observe(page)).diagnostics).toEqual([])
})
