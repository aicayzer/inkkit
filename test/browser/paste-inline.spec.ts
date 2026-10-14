import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Loads `source` and selects the first `selected` after the first `after` in
// its text, or puts the caret there when `selected` is empty.
async function caretAfter(
  page: Page,
  source: string,
  after: string,
  selected = '',
) {
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
  const from = readable.text.indexOf(after) + after.length
  await operation(page, 'selectTextRange', {
    range: {
      snapshotId: readable.snapshotId,
      from,
      to: from + selected.length,
    },
    options: { focus: true },
  })
}

// Dispatches a paste whose clipboard holds only `text/plain`, or also the
// other types given.
async function pastePlain(
  page: Page,
  text: string,
  other: Record<string, string> = {},
) {
  await page.evaluate(
    ([text, other]) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      for (const [type, value] of Object.entries(other))
        data.setData(type, value)
      document.activeElement!.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    [text, other] as const,
  )
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

test('typing after a paste over a selection keeps the pasted text', async ({
  page,
}) => {
  for (const [other, saved] of [
    [{}, 'Keep that and text.\n'],
    [{ 'text/html': '<em>that</em>' }, 'Keep *that and* text.\n'],
    // Metadata that is not VS Code's pastes as plain text.
    [{ 'vscode-editor-data': 'not JSON' }, 'Keep that and text.\n'],
  ] as const) {
    await caretAfter(page, 'Keep this text.\n', 'Keep ', 'this')
    await pastePlain(page, 'that', other)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(saved.replace(' and', ''))
    await page.keyboard.type(' and')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(saved)
  }
})

test('spaces pasted beside a line break are not kept', async ({ page }) => {
  await caretAfter(page, 'a\\\nbc\n', 'a\n')
  await pastePlain(page, ' word')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('a\\\nwordbc\n')
  await page.keyboard.type('X')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('a\\\nwordXbc\n')
})
