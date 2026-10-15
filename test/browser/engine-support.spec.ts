import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

async function select(page: Page, text: string) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const from = readable.text.indexOf(text)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from, to: from + text.length },
    options: { focus: true },
  })
}

// The word's pixels, so a test can tell whether the selection shows.
async function pixels(page: Page, word: string) {
  const clip = await page
    .locator('#editor .ProseMirror p')
    .first()
    .evaluate((node, word) => {
      const text = node.firstChild!
      const range = document.createRange()
      const at = text.textContent!.indexOf(word)
      range.setStart(text, at)
      range.setEnd(text, at + word.length)
      const { x, y, width, height } = range.getBoundingClientRect()
      return { x, y, width, height }
    }, word)
  return page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
}

for (const available of [true, false])
  test(`the editor edits ${available ? 'with' : 'without'} the Custom Highlight API and shows the selection`, async ({
    page,
    openFixture,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (!available)
      await page.addInitScript(() => {
        delete (CSS as { highlights?: unknown }).highlights
        delete (window as { Highlight?: unknown }).Highlight
      })
    await openFixture()
    expect(await page.evaluate(() => 'highlights' in CSS)).toBe(available)
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      'Plain words here\n',
    )
    await select(page, 'Plain')
    const unselected = await pixels(page, 'words')
    await select(page, 'words')
    // Painted by the highlight with the API, and by the engine without it.
    // Either paints on a later frame, so the check waits for it.
    await expect
      .poll(async () => (await pixels(page, 'words')).equals(unselected))
      .toBe(false)
    // Where the engine can paint it, the highlight draws the selection, not
    // the engine, which would also fill the margins beside the text.
    expect(
      await page.evaluate(
        () => 'highlights' in CSS && CSS.highlights.has('inkkit-selection'),
      ),
    ).toBe(available)
    await page.keyboard.type('text')
    expect((await observe(page)).snapshot!.text).toBe('Plain text here\n')
    expect(errors).toEqual([])
  })
