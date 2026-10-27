import { test, expect, observe, operation } from './fixtures'

test('image width is keyboard editable with visible focus and reversible source changes', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  const source =
    'Before\r\n\r\n![Café 😀|120](images/native.png)   \r\n\r\nAfter\r\n'
  await page.evaluate(
    (source) => window.inkkitPlayground.replaceDocument(source, 'md'),
    source,
  )
  const handle = page.getByRole('slider', { name: 'Resize image Café 😀' })
  await expect(handle).toHaveAttribute('aria-valuenow', '120')
  await handle.focus()
  await expect(handle).toBeFocused()
  expect(
    await handle.evaluate((element) => getComputedStyle(element).opacity),
  ).toBe('1')
  await page.keyboard.press('ArrowRight')
  await expect(handle).toBeFocused()
  await expect(handle).toHaveAttribute('aria-valuenow', '130')
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('|120', '|130'),
  )
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(handle).toHaveAttribute('aria-valuenow', '129')
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('|120', '|130'),
  )
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(source)
  await operation(page, 'redo')
  await operation(page, 'reload')
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('|120', '|130'),
  )
  await operation(page, 'editable', { editable: false })
  await expect(handle).toBeHidden()
})

test('Tab and Shift+Tab pass a sandboxed PDF preview and Open works read-only', async ({
  page,
  openFixture,
  browserName,
}) => {
  await openFixture('linked-files', '&editable=false')
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('![[Document]]\n', 'md'),
  )
  const frame = page.locator('.inkkit-file iframe')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(frame).toHaveAttribute('tabindex', '-1')
  const open = page.locator('.inkkit-file-open')
  await expect(open).toBeVisible()
  await page.evaluate(() => {
    const root = document.querySelector('.inkkit-root')!
    const before = document.createElement('button')
    before.id = 'before-preview'
    before.textContent = 'Before preview'
    const after = document.createElement('button')
    after.id = 'after-preview'
    after.textContent = 'After preview'
    root.before(before)
    root.after(after)
  })
  await page.locator('#before-preview').focus()
  await page.keyboard.press('Tab')
  expect(
    await frame.evaluate((element) => element === document.activeElement),
  ).toBe(false)
  await page.keyboard.press('Shift+Tab')
  expect(
    await frame.evaluate((element) => element === document.activeElement),
  ).toBe(false)
  await page.locator('#before-preview').focus()
  // Safari uses Option+Tab to include buttons when full keyboard access is off.
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  const previous = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab'
  // The read-only surface itself can be a tab stop; the PDF must never be one.
  for (
    let count = 0;
    count < 3 &&
    !(await open.evaluate((element) => element === document.activeElement));
    count++
  ) {
    await page.keyboard.press(next)
    expect(
      await frame.evaluate((element) => element === document.activeElement),
    ).toBe(false)
  }
  await expect(open).toBeFocused()
  await page.keyboard.press('Enter')
  const events = (await operation(page, 'fileEvents')) as {
    operation: string
  }[]
  expect(events.filter((event) => event.operation === 'open')).toHaveLength(1)
  await page.keyboard.press(next)
  await expect(page.locator('#after-preview')).toBeFocused()
  await page.keyboard.press(previous)
  await expect(open).toBeFocused()
  await page.keyboard.press(previous)
  expect(
    await frame.evaluate((element) => element === document.activeElement),
  ).toBe(false)
  expect((await observe(page)).snapshot!.text).toBe('![[Document]]\n')
})
