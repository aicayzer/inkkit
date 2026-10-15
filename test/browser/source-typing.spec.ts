import type { Page } from '@playwright/test'
import { test, expect, observe, operation, focusSettled } from './fixtures'

const original =
  Array.from(
    { length: 600 },
    (_, index) =>
      `Paragraph ${index} has enough words to wrap over a line or two in the source editor.`,
  ).join('\n\n') + '\n'

// Control-Up moves by paragraph outside macOS, so it is not a document start.
const documentStart =
  process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'

// Source typing groups keystrokes by the time between them (500 ms). The page
// clock is fixed so that a slow runner cannot split a run of keys into steps,
// and `pass` moves it by an exact amount to test the grouping rule itself.
const clockStart = new Date('2026-01-01T00:00:00Z')

async function pass(page: Page, milliseconds: number) {
  const now = await page.evaluate(() => Date.now())
  await page.clock.setFixedTime(now + milliseconds)
}

async function openSource(page: Page, at: number) {
  await page.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.clock.setFixedTime(clockStart)
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    original,
  )
  await operation(page, 'editingMode', { mode: 'source' })
  const area = page.locator('textarea.inkkit-plain')
  await area.focus()
  await area.evaluate((element, at) => {
    const area = element as HTMLTextAreaElement
    area.setSelectionRange(at, at)
    const added: string[] = []
    ;(window as unknown as { added: string[] }).added = added
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement)
            added.push(node.outerHTML.slice(0, 80))
    }).observe(document.body, { childList: true })
  }, at)
  return area
}

test('source typing reaches the snapshot at once and later reaches the formatted view', async ({
  page,
}) => {
  const area = await openSource(page, 20)
  await page.keyboard.type('typed words')
  const expected = original.slice(0, 20) + 'typed words' + original.slice(20)
  await expect(area).toHaveValue(expected)
  expect((await observe(page)).snapshot!.text).toBe(expected)
  // No measuring copy of the text is added to the page while typing.
  expect(
    await page.evaluate(() => (window as unknown as { added: string[] }).added),
  ).toEqual([])
  await operation(page, 'editingMode', { mode: 'formatted' })
  expect((await observe(page)).snapshot!.text).toBe(expected)
  await expect(page.locator('.ProseMirror.editor')).toContainText(
    'enoutyped wordsgh words',
  )
})

test('source typing is undone as one step and redone', async ({ page }) => {
  const area = await openSource(page, 20)
  await page.keyboard.type('typed words')
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(original)
  expect((await observe(page)).snapshot!.text).toBe(original)
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(area).toHaveValue(
    original.slice(0, 20) + 'typed words' + original.slice(20),
  )
})

test('source typing pauses of up to 500 ms stay one undo step and longer ones start another', async ({
  page,
}) => {
  const area = await openSource(page, 20)
  const at = (typed: string) =>
    original.slice(0, 20) + typed + original.slice(20)
  await page.keyboard.type('a')
  await pass(page, 500)
  await page.keyboard.type('b')
  await pass(page, 501)
  await page.keyboard.type('c')
  await expect(area).toHaveValue(at('abc'))
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(at('ab'))
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(original)
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(area).toHaveValue(at('ab'))
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(area).toHaveValue(at('abc'))
})

test('a paste after typing is its own undo step and typing is not merged', async ({
  page,
}) => {
  const area = await openSource(page, 20)
  await page.keyboard.type('abc')
  await pass(page, 700)
  await page.keyboard.type('def')
  await operation(page, 'pastePlain', { text: 'PASTE' })
  const typed = original.slice(0, 20) + 'abcdef' + original.slice(20)
  const pasted = typed.slice(0, 26) + 'PASTE' + typed.slice(26)
  expect((await observe(page)).snapshot!.text).toBe(pasted)
  await area.focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(typed)
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(
    original.slice(0, 20) + 'abc' + original.slice(20),
  )
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(original)
})

test('redo from source mode does not carry its steps into the formatted view', async ({
  page,
}) => {
  const area = await openSource(page, 20)
  await page.keyboard.type('a1')
  await operation(page, 'undo')
  await expect(area).toHaveValue(original)
  await operation(page, 'editingMode', { mode: 'formatted' })
  expect(await operation(page, 'redo')).toBe(false)
  const editor = page.locator('.ProseMirror.editor')
  await editor.click()
  await focusSettled(page)
  await page.keyboard.press(documentStart)
  await page.keyboard.type('Q')
  const text = (await observe(page)).snapshot!.text
  expect(text).toContain('QParagraph 0')
  expect(text).not.toContain('a1')
  await operation(page, 'editingMode', { mode: 'source' })
  expect(await area.inputValue()).toBe(text)
})

test('undo and redo cross between formatted history and source steps in order', async ({
  page,
}) => {
  await page.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    original,
  )
  const editor = page.locator('.ProseMirror.editor')
  await editor.click()
  await focusSettled(page)
  await page.keyboard.press(documentStart)
  await page.keyboard.type('X')
  await page.waitForTimeout(700)
  await operation(page, 'editingMode', { mode: 'source' })
  const area = page.locator('textarea.inkkit-plain')
  await area.focus()
  await area.evaluate((element) => {
    const area = element as HTMLTextAreaElement
    area.setSelectionRange(area.value.length, area.value.length)
  })
  await page.keyboard.type('Y')
  const withY = await area.inputValue()
  const withX = withY.slice(0, -1)
  expect(withX.startsWith('XParagraph 0')).toBe(true)
  expect(await operation(page, 'undo')).toBe(true)
  await expect(area).toHaveValue(withX)
  expect(await operation(page, 'undo')).toBe(true)
  await expect(area).toHaveValue(original)
  expect(await operation(page, 'redo')).toBe(true)
  await expect(area).toHaveValue(withX)
  expect(await operation(page, 'redo')).toBe(true)
  await expect(area).toHaveValue(withY)
  expect(await operation(page, 'redo')).toBe(false)
})
