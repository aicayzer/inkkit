import type { Page } from '@playwright/test'
import type { RichTextBlock, RichTextDocument } from '../../src/core'
import { richTextFixtures } from '../../scripts/interop/consumer/fixtures'
import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

const saved = async (page: Page) => {
  const { snapshot } = await observe(page)
  expect(snapshot!.format).toBe('rtf')
  return snapshot!.document as RichTextDocument
}

/** The paragraph whose text starts with `start`. */
const paragraph = async (page: Page, start: string) =>
  (await saved(page)).blocks.find(
    (block): block is RichTextBlock & { type: 'paragraph' } =>
      block.type === 'paragraph' &&
      block.content[0]?.type === 'text' &&
      block.content[0].text.startsWith(start),
  )

test('an RTF document takes typing, a host underline key, centring and a pasted heading @rich-text', async ({
  page,
  openFixture,
}) => {
  await openFixture('rtf')
  const golden = richTextFixtures.rtf!.document
  expect(await saved(page)).toEqual(golden)
  const formatted = page.getByRole('textbox', {
    name: 'Rich text editor',
    exact: true,
  })
  await operation(page, 'keymap', { keymap: { underline: ['Mod-u'] } })

  // Typing joins the run it lands in.
  await caretAfterMatch(page, 'Plain')
  await page.keyboard.type('ly')
  await expect
    .poll(async () => (await paragraph(page, 'Plain'))?.content[0])
    .toEqual({ type: 'text', text: 'Plainly, ' })
  expect((await observe(page)).snapshot!.dirty).toBe(true)

  // The host's key underlines the selection.
  expect(await operation(page, 'find', { text: 'Plainly' })).toBe(true)
  await page.keyboard.press('ControlOrMeta+u')
  await expect
    .poll(async () => (await paragraph(page, 'Plainly'))?.content[0])
    .toEqual({ type: 'text', text: 'Plainly', marks: [{ type: 'underline' }] })
  await expect(formatted.locator('u', { hasText: 'Plainly' })).toHaveCount(1)

  // The host's toolbar centres the paragraph.
  await operation(page, 'format', { command: 'alignCenter' })
  await expect
    .poll(async () => (await paragraph(page, 'Plainly'))?.align)
    .toBe('center')
  await expect(
    formatted.locator('p[style*="text-align: center"]', {
      hasText: 'Plainly',
    }),
  ).toHaveCount(1)

  // A pasted heading arrives as a bold paragraph, and nothing becomes a heading.
  await caretAfterMatch(page, 'After.')
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'Pasted heading\ntail')
    data.setData('text/html', '<h1>Pasted heading</h1><p>tail</p>')
    document.querySelector('.ProseMirror.editor')!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expect
    .poll(async () => (await paragraph(page, 'Pasted heading'))?.content)
    .toEqual([
      { type: 'text', text: 'Pasted heading', marks: [{ type: 'bold' }] },
    ])
  expect(await paragraph(page, 'tail')).toEqual({
    type: 'paragraph',
    content: [{ type: 'text', text: 'tail' }],
  })
  await expect(formatted.locator('h1')).toHaveCount(0)

  // Markdown typed into the document stays text.
  await page.keyboard.press('Enter')
  await page.keyboard.type('# not a heading')
  await expect
    .poll(async () => (await paragraph(page, '# not'))?.content)
    .toEqual([{ type: 'text', text: '# not a heading' }])
  await expect(formatted.locator('h1')).toHaveCount(0)

  // Undo goes back through the edits to the loaded document.
  for (let step = 0; step < 20; step++) {
    if (!(await observe(page)).snapshot!.dirty) break
    await page.keyboard.press('ControlOrMeta+z')
  }
  await expect.poll(() => saved(page)).toEqual(golden)
})
