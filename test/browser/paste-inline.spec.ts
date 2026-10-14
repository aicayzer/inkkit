import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Loads `source` and puts the caret after the first `after` in its text.
async function caretAfter(page: Page, source: string, after: string) {
  await page.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.evaluate(
    (source) => window.inkkitPlayground.replaceDocument(source, 'md'),
    source,
  )
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const end = readable.text.indexOf(after) + after.length
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: end, to: end },
    options: { focus: true },
  })
}

// Dispatches a paste whose clipboard holds only `text/plain`.
async function pastePlain(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, text)
}

test('plain text pasted inside a sentence joins the paragraph', async ({
  page,
}) => {
  await caretAfter(page, 'Before after.\n', 'Before ')
  await pastePlain(page, 'word ')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('Before word after.\n')
  await page.keyboard.type('and ')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('Before word and after.\n')
})

test('pasted paragraphs join the text on either side of the caret', async ({
  page,
}) => {
  await caretAfter(page, 'Before after.\n\nLast\n', 'Before ')
  await pastePlain(page, 'one\n\ntwo ')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('Before one\n\ntwo after.\n\nLast\n')
})

test('a pasted list still splits the paragraph', async ({ page }) => {
  await caretAfter(page, 'Before after.\n', 'Before ')
  await pastePlain(page, '- one\n- two')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('Before&#x20;\n\n- one\n- two\n\nafter.\n')
})
