import { test, expect, observe, operation } from './fixtures'

test('distant ordinary typing remains saveable, undoable and reloadable @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source =
    '__Authored__\n\n<section>unsupported</section>\n\n' +
    Array.from({ length: 1000 }, (_, index) => `Paragraph ${index}.`).join(
      '\n\n',
    ) +
    '\n'
  await operation(page, 'replaceSource', { text: source })
  const paragraphs = page.locator('#editor .ProseMirror > p')
  await paragraphs.nth(1).click()
  await paragraphs.nth(1).evaluate((paragraph) => {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(true)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
  })
  await page.keyboard.type('First ')
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toContain('First Paragraph 0.')
  await paragraphs.last().click()
  await paragraphs.last().evaluate((paragraph) => {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(false)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
  })
  await page.keyboard.type(' Last')
  const expected = source
    .replace('Paragraph 0.', 'First Paragraph 0.')
    .replace('Paragraph 999.', 'Paragraph 999. Last')
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe(expected)
  await operation(page, 'undo')
  expect((await observe(page)).snapshot?.text).toBe(
    source.replace('Paragraph 0.', 'First Paragraph 0.'),
  )
  await operation(page, 'redo')
  expect((await observe(page)).snapshot?.text).toBe(expected)
  await operation(page, 'editingMode', { mode: 'source' })
  await expect(
    page.getByRole('textbox', { name: 'Markdown source editor' }),
  ).toHaveValue(expected)
  await operation(page, 'editingMode', { mode: 'formatted' })
  await operation(page, 'reload', { text: expected })
  expect((await observe(page)).snapshot?.text).toBe(expected)
  expect((await observe(page)).diagnostics).toEqual([])
})

test('Replace All over hundreds of changed formatted blocks saves, undoes and reloads @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const kinds = [
    (i: number, w: string) => `__Kept ${i}__ [link ${i}](/k/${i}) ${w} here.`,
    (i: number, w: string) => `* first ${i} ${w}\n* second ${i}`,
    (i: number, w: string) => `> quoted ${i} ${w}`,
    (i: number, w: string) => '```ts\nconst a' + i + ` = "${w}";\n` + '```',
    (i: number, w: string) => `| A | B |\n| - | - |\n| ${w} ${i} | x |`,
    (i: number, w: string) => `Note ${i} ${w}[^n${i}]\n\n[^n${i}]: Note ${i}.`,
  ]
  const source =
    Array.from({ length: 1200 }, (_, i) =>
      kinds[i % kinds.length]!(i, i % 4 === 0 ? 'word' : 'plain'),
    ).join('\n\n') + '\n'
  const expected = source.replaceAll('word', 'term')
  await operation(page, 'replaceSource', { text: source })
  await operation(page, 'editingMode', { mode: 'formatted' })
  expect(
    await operation(page, 'replaceAll', {
      search: 'word',
      replacement: 'term',
    }),
  ).toBe(300)
  expect((await observe(page)).snapshot?.text).toBe(expected)
  await operation(page, 'undo')
  expect((await observe(page)).snapshot?.text).toBe(source)
  await operation(page, 'redo')
  expect((await observe(page)).snapshot?.text).toBe(expected)
  await operation(page, 'reload', { text: expected })
  expect((await observe(page)).snapshot?.text).toBe(expected)
  expect((await observe(page)).diagnostics).toEqual([])
})

test('rejected typing and composition restore visible DOM and leave saving and history usable @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Before\n' })
  await operation(page, 'reload')
  const before = (await observe(page)).snapshot!
  await page.evaluate(async (moduleURL) => {
    const { Preservation, PreservationError } = await import(
      /* @vite-ignore */ moduleURL
    )
    const original = Preservation.prototype.serialize
    Preservation.prototype.serialize = function (doc: { textContent: string }) {
      if (doc.textContent.includes('Rejected'))
        throw new PreservationError('Injected validation failure')
      return original.call(this, doc)
    }
  }, `/@fs${process.cwd()}/src/preserve.ts`)
  const surface = page.locator('#editor .ProseMirror')
  await surface.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('Rejected')
  await expect(surface).toHaveText('Before')
  expect((await observe(page)).snapshot).toEqual(before)
  expect((await observe(page)).diagnostics).toHaveLength(1)
  await surface.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    const text = element.querySelector('p')!.firstChild!
    text.textContent = 'BeforeRejected'
    const selection = window.getSelection()!
    selection.collapse(text, text.textContent.length)
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: 'Rejected',
        isComposing: true,
      }),
    )
  })
  await expect
    .poll(async () => (await observe(page)).diagnostics.length)
    .toBe(2)
  await expect(surface).toHaveText('Before')
  expect((await observe(page)).snapshotError?.code).toBe('composition')
  await surface.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: 'Rejected',
      }),
    )
  })
  await expect(surface).toHaveText('Before')
  expect((await observe(page)).snapshot).toEqual(before)
  await surface.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' accepted')
  expect((await observe(page)).snapshot?.text).toBe('Before accepted\n')
  await operation(page, 'undo')
  expect((await observe(page)).snapshot?.text).toBe('Before\n')
  await operation(page, 'redo')
  expect((await observe(page)).snapshot?.text).toBe('Before accepted\n')
})
