import { nextHistoryStep } from './timing'
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
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'))
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

for (const [name, pasted] of [
  ['comment', 'x\n\n---\n\n<!-- note -->'],
  ['literal', 'x\n\nA [full][ref] literal.'],
  ['folded callout', 'x\n\n> [!NOTE]-\n> hi'],
] as const) {
  test(`typing stays visibly after a final pasted ${name}`, async ({
    page,
  }) => {
    await caretAfter(page, 'Before\n', 'Before')
    await pastePlain(page, pasted)
    const inserted = (await observe(page)).snapshot!.text
    await nextHistoryStep(page)
    await page.keyboard.type('X')
    const saved = (await observe(page)).snapshot!.text
    if (name === 'literal')
      expect(saved).toBe(inserted.replace('literal.', 'literal.X'))
    else expect(saved).toBe(`${inserted.trimEnd()}\n\nX\n`)
    expect((await observe(page)).diagnostics).toEqual([])
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(inserted)
    await operation(page, 'redo')
    expect((await observe(page)).snapshot!.text).toBe(saved)
    await operation(page, 'reload', { text: saved })
    expect((await observe(page)).snapshot!.text).toBe(saved)
  })
}
for (const [marker, toggle, label] of [
  ['+', true, 'reader folded'],
  ['-', false, 'authored folded'],
  ['-', true, 'reader opened'],
] as const) {
  test(`paste caret respects a ${label} callout`, async ({ page }) => {
    const source = `Before\n\n> [!NOTE]${marker} Title\n> hi\n\nafter\n\n*  untouched é🌻\n`
    await caretAfter(page, source, 'Before')
    if (toggle) {
      await page.locator('[data-inkkit-callout-toggle]').click()
      await expect(
        page.locator('[data-inkkit-callout-toggle]'),
      ).toHaveAttribute('aria-expanded', marker === '+' ? 'false' : 'true')
      await page.locator('.ProseMirror.editor').focus()
    }
    await pastePlain(page, 'x\n\n---')
    const inserted = (await observe(page)).snapshot!.text
    await nextHistoryStep(page)
    await page.keyboard.type('X')
    const saved = (await observe(page)).snapshot!.text
    if (label === 'reader opened') expect(saved).toContain('> Xhi')
    else {
      expect(saved).toContain('> hi')
      expect(saved).not.toContain('> Xhi')
      expect(saved).toContain('Xafter')
    }
    expect(saved).toContain('*  untouched é🌻\n')
    await expect(page.locator('[data-inkkit-callout-toggle]')).toHaveAttribute(
      'aria-expanded',
      label === 'reader opened' ? 'true' : 'false',
    )
    expect((await observe(page)).diagnostics).toEqual([])
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(inserted)
    await operation(page, 'redo')
    expect((await observe(page)).snapshot!.text).toBe(saved)
    await operation(page, 'reload', { text: saved })
    expect((await observe(page)).snapshot!.text).toBe(saved)
  })
}

for (const [name, text, html] of [
  ['HTML final rule', 'x', '<p>x</p><hr>'],
  ['CRLF Unicode final rule', 'é🌻\r\n\r\n---', ''],
] as const) {
  test(`typing follows ${name}`, async ({ page }) => {
    await caretAfter(page, 'Before\n', 'Before')
    await pastePlain(page, text, html ? { 'text/html': html } : {})
    const inserted = (await observe(page)).snapshot!.text
    await nextHistoryStep(page)
    await page.keyboard.type('X')
    expect((await observe(page)).snapshot!.text).toBe(
      `${inserted.trimEnd()}\n\nX\n`,
    )
    expect((await observe(page)).diagnostics).toEqual([])
  })
}

for (const [name, html] of [
  ['blocks', '<p>x</p><hr>'],
  ['table', '<table><tr><td>x</td></tr></table>'],
] as const) {
  test(`dropped ${name} skip a callout folded by the reader`, async ({
    page,
  }) => {
    await caretAfter(
      page,
      'Before\n\n> [!NOTE]+ Title\n> hi\n\nafter\n',
      'Before',
    )
    await page.locator('[data-inkkit-callout-toggle]').click()
    await page.locator('.ProseMirror.editor').focus()
    await page.locator('.ProseMirror.editor').evaluate((root, html) => {
      const rect = root.querySelector('p')!.getBoundingClientRect()
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/html', html)
      dataTransfer.setData('text/plain', 'x')
      root.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: rect.left + 10,
          clientY: rect.top + rect.height / 2,
        }),
      )
    }, html)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .not.toBe('Before\n\n> [!NOTE]+ Title\n> hi\n\nafter\n')
    const inserted = (await observe(page)).snapshot!.text
    await nextHistoryStep(page)
    await page.keyboard.type('X')
    const saved = (await observe(page)).snapshot!.text
    expect(saved).toBe(
      name === 'table'
        ? inserted.replace('\n\n>', '\n\nX\n\n>')
        : inserted.replace('\nafter', '\nXafter'),
    )
    await expect(page.locator('[data-inkkit-callout-toggle]')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect((await observe(page)).diagnostics).toEqual([])
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(inserted)
    await operation(page, 'redo')
    expect((await observe(page)).snapshot!.text).toBe(saved)
    await operation(page, 'reload', { text: saved })
    expect((await observe(page)).snapshot!.text).toBe(saved)
  })
}
