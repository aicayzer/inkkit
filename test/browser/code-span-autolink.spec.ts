import { test, expect, observe, operation } from './fixtures'
import { codeSpanAutolinkCases } from '../code-span-autolink-cases'
import type { Page } from '@playwright/test'

async function open(page: Page, text: string) {
  await operation(page, 'reload', { text })
  expect((await observe(page)).snapshot!.text).toBe(text)
}

// Selects the text that first matches `marker`, with the caret in focus.
async function select(page: Page, marker: string, end = false) {
  const readable = (await operation(page, 'textSnapshot')) as {
    snapshotId: string
    text: string
  }
  const from = readable.text.indexOf(marker)
  expect(from).toBeGreaterThanOrEqual(0)
  const at = end ? from + marker.length : from
  await operation(page, 'selectTextRange', {
    range: {
      snapshotId: readable.snapshotId,
      from: marker === 'x' || !end ? from : at,
      to: marker === 'x' ? from + 1 : at,
    },
    options: { focus: true },
  })
}

// The editor reads back identically once saved and reopened.
async function reopensSame(page: Page) {
  const saved = (await observe(page)).snapshot!.text
  const before = (await operation(page, 'clipboard', {
    scope: 'document',
  })) as { text: string; html: string }
  await operation(page, 'reload', { text: saved })
  const after = (await operation(page, 'clipboard', {
    scope: 'document',
  })) as { text: string; html: string }
  const semantic = (html: string) =>
    html.replace(/ data-inkkit-link-form="[^"]*"/g, '')
  expect(after.text).toBe(before.text)
  expect(semantic(after.html)).toBe(semantic(before.html))
  expect((await observe(page)).snapshot!.text).toBe(saved)
}

for (const [name, source, typed, expected] of codeSpanAutolinkCases)
  test(`typing backticks around ${name} saves a code span and no link @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, source)
    await select(page, 'x')
    await page.keyboard.type(typed)
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(expected)
    await expect(page.locator('[contenteditable] code').first()).toBeVisible()
    await expect(page.locator('[contenteditable] a')).toHaveCount(0)
    await reopensSame(page)
  })

test('typing the opening backtick last leaves literal backticks, not a code span @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, 'x\n')
  await select(page, 'x')
  await page.keyboard.type('http://x.com`')
  await page.keyboard.press('Home')
  await page.keyboard.type('`')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  await expect(page.locator('[contenteditable] code')).toHaveCount(0)
  expect(observed.snapshot!.text).toContain('http://x.com')
  await reopensSame(page)
})

for (const key of ['Backspace', 'ControlOrMeta+z'])
  test(`${key} right after the closing backtick undoes the code span without a stray link @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, 'x\n')
    await select(page, 'x')
    await page.keyboard.type('`http://x.com`')
    expect((await observe(page)).snapshot!.text).toBe('`http://x.com`\n')
    await page.keyboard.press(key)
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    await expect(page.locator('[contenteditable] code')).toHaveCount(0)
    await reopensSame(page)
    // Typing the backtick again wraps it again, still without a link.
    await page.keyboard.type('`')
    if (key === 'ControlOrMeta+z') {
      expect((await observe(page)).snapshot!.text).toBe('`http://x.com`\n')
      await expect(page.locator('[contenteditable] a')).toHaveCount(0)
    }
    await operation(page, 'redo')
    expect((await observe(page)).diagnostics).toEqual([])
  })

for (const [name, source, typed, expected] of [
  [
    'linked code in another block',
    '[`http://x.com`](http://x.com)\n\nOther\n',
    '!',
    '[`http://x.com`](http://x.com)\n\nOther!\n',
  ],
  [
    'linked code in the same block',
    '[`http://x.com`](http://x.com) tail\n',
    '!',
    '[`http://x.com`](http://x.com) tail!\n',
  ],
  [
    'a code span in the same block',
    'Keep `http://x.com` tail\n',
    '!',
    'Keep `http://x.com` tail!\n',
  ],
] as const)
  test(`editing next to ${name} keeps its bytes @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, source)
    await page.locator('[contenteditable]').first().click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(typed)
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(expected)
  })
