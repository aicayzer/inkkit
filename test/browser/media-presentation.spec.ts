import { test, expect, observe, operation } from './fixtures'

const longName =
  'An unusually long attachment filename with spaces and an_unbroken_segment_abcdefghijklmnopqrstuvwxyz.png'

for (const colorScheme of ['light', 'dark'] as const) {
  test(`attachment footer stays readable at narrow widths in ${colorScheme} @linked-files`, async ({
    page,
    openFixture,
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme })
    await openFixture('linked-files')
    await page.evaluate(
      (name) =>
        window.inkkitPlayground.replaceDocument(`![[${name}|180]]\n`, 'md'),
      longName,
    )
    // Host typography must not collapse the attachment's own controls.
    await page.addStyleTag({
      content:
        '#editor { max-width: 240px; --inkkit-font-size: 19px; } .ProseMirror .image { line-height: 0; }',
    })
    const card = page.locator('.inkkit-file')
    await expect(card.locator('img')).toBeVisible()
    const open = card.getByRole('button', { name: `Open ${longName}` })
    await expect(open).toBeVisible()
    const layout = await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const label = element.querySelector('.inkkit-file-label')!
      const control = element.querySelector('button')!
      const grip = element.querySelector('.image-handle')!
      const image = element.querySelector('img')!
      return {
        card: bounds.toJSON(),
        label: label.getBoundingClientRect().toJSON(),
        control: control.getBoundingClientRect().toJSON(),
        image: image.getBoundingClientRect().toJSON(),
        grip: grip.getBoundingClientRect().toJSON(),
        lineHeight: parseFloat(getComputedStyle(control).lineHeight),
        visibleGripHeight: parseFloat(getComputedStyle(grip, '::after').height),
        overflow: element.scrollWidth > element.clientWidth,
      }
    })
    expect(layout.lineHeight).toBeGreaterThan(12)
    expect(layout.control.height).toBeGreaterThan(24)
    expect(layout.label.height).toBeGreaterThan(24)
    expect(layout.overflow).toBe(false)
    expect(layout.control.right).toBeLessThanOrEqual(layout.card.right)
    expect(layout.control.top).toBeGreaterThanOrEqual(layout.image.bottom)
    expect(layout.grip.bottom).toBeLessThanOrEqual(layout.image.bottom)
    expect(layout.visibleGripHeight).toBeLessThanOrEqual(24)
    await open.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    const events = (await operation(page, 'fileEvents')) as {
      operation: string
    }[]
    expect(events.filter((event) => event.operation === 'open')).toHaveLength(2)
    await card.hover()
    await testInfo.attach(`${colorScheme}-attachment`, {
      body: await card.screenshot(),
      contentType: 'image/png',
    })
    const before = (await observe(page)).snapshot!.text
    await operation(page, 'editable', { editable: false })
    await expect(card.locator('.image-handle')).toBeHidden()
    await open.click()
    expect((await observe(page)).snapshot!.text).toBe(before)
    await operation(page, 'editable', { editable: true })
    await expect(card.locator('.image-handle')).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('Retry remains keyboard operable in a read-only attachment @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files', '&editable=false')
  await operation(page, 'fileMode', { mode: 'reject' })
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('![[Photo|140]]\n', 'md'),
  )
  await expect(page.locator('[data-inkkit-file-state="failed"]')).toBeVisible()
  await operation(page, 'fileMode', { mode: 'normal' })
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.inkkit-file img')).toBeVisible()
  await expect(page.locator('.image-handle')).toBeHidden()
  expect((await observe(page)).snapshot!.text).toBe('![[Photo|140]]\n')
})

test('image-adapter handles follow read-only transitions @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&editable=false')
  const image = page.locator('.image')
  await expect(image.locator('img')).toBeVisible()
  await image.hover()
  await expect(image.locator('.image-handle')).toBeHidden()
  const before = (await observe(page)).snapshot!.text
  await operation(page, 'editable', { editable: true })
  await expect(image.locator('.image-handle')).toBeVisible()
  expect((await observe(page)).snapshot!.text).toBe(before)
})
