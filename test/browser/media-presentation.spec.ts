import { test, expect, observe, operation } from './fixtures'

const longName =
  'An unusually long attachment filename with spaces and an_unbroken_segment_abcdefghijklmnopqrstuvwxyz.png'

for (const colorScheme of ['light', 'dark'] as const) {
  test(`file card name and arrow stay readable at narrow widths in ${colorScheme} @linked-files`, async ({
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
        window.inkkitPlayground.replaceDocument(`![${name}](Archive)\n`, 'md'),
      longName,
    )
    // Host typography must not collapse the card's own control.
    await page.addStyleTag({
      content: '#editor { max-width: 240px; --inkkit-font-size: 19px; }',
    })
    const card = page.locator('.inkkit-file')
    const open = card.getByRole('button', { name: `Open ${longName}` })
    await expect(open).toBeVisible()
    await expect(card.locator('.inkkit-file-label')).toHaveText(longName)
    await expect(open).toHaveAttribute('title', `Open ${longName}`)
    const layout = await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const label = element.querySelector('.inkkit-file-label')!
      const control = element.querySelector('button')!
      const arrow = control.querySelector('svg')!
      return {
        card: bounds.toJSON(),
        label: label.getBoundingClientRect().toJSON(),
        control: control.getBoundingClientRect().toJSON(),
        arrow: arrow.getBoundingClientRect().toJSON(),
        labelLineHeight: parseFloat(getComputedStyle(label).lineHeight),
        labelOverflow: getComputedStyle(label).textOverflow,
        overflow: element.scrollWidth > element.clientWidth,
      }
    })
    expect(layout.label.height).toBeLessThanOrEqual(layout.labelLineHeight + 1)
    expect(layout.labelOverflow).toBe('ellipsis')
    expect(layout.overflow).toBe(false)
    expect(layout.control.right).toBeLessThanOrEqual(layout.card.right)
    // The arrow stays visible after a truncated name.
    expect(layout.arrow.right).toBeLessThanOrEqual(layout.control.right + 1)
    expect(layout.arrow.left).toBeGreaterThanOrEqual(layout.label.right - 1)
    await open.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await expect(open).toBeFocused()
    expect(
      await open.evaluate((element) =>
        parseFloat(getComputedStyle(element).outlineWidth),
      ),
    ).toBeGreaterThan(0)
    const events = (await operation(page, 'fileEvents')) as {
      operation: string
    }[]
    expect(events.filter((event) => event.operation === 'open')).toHaveLength(2)
    await testInfo.attach(`${colorScheme}-attachment`, {
      body: await card.screenshot(),
      contentType: 'image/png',
    })
    const before = (await observe(page)).snapshot!.text
    await operation(page, 'editable', { editable: false })
    await open.click()
    expect((await observe(page)).snapshot!.text).toBe(before)
    expect(errors).toEqual([])
  })

  test(`a bare picture stays within a narrow column and keeps its grip in ${colorScheme} @linked-files`, async ({
    page,
    openFixture,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme })
    await openFixture('linked-files')
    await page.evaluate(
      (name) =>
        window.inkkitPlayground.replaceDocument(`![[${name}|180]]\n`, 'md'),
      longName,
    )
    await page.addStyleTag({
      content: '#editor { max-width: 240px; --inkkit-font-size: 19px; }',
    })
    const card = page.locator('.inkkit-file')
    await expect(card.locator('img')).toBeVisible()
    await expect(card).toHaveAttribute('title', longName)
    await expect(card.getByRole('button')).toHaveCount(0)
    const layout = await card.evaluate((element) => {
      const image = element.querySelector('img')!
      const grip = element.querySelector('.inkkit-image-handle')!
      return {
        card: element.getBoundingClientRect().toJSON(),
        image: image.getBoundingClientRect().toJSON(),
        grip: grip.getBoundingClientRect().toJSON(),
        column: element
          .closest('.ProseMirror')!
          .getBoundingClientRect()
          .toJSON(),
      }
    })
    expect(layout.card.right).toBeLessThanOrEqual(layout.column.right)
    expect(layout.grip.right).toBeLessThanOrEqual(layout.image.right + 1)
    expect(layout.grip.bottom).toBeLessThanOrEqual(layout.image.bottom)
    const before = (await observe(page)).snapshot!.text
    await operation(page, 'editable', { editable: false })
    await expect(card.locator('.inkkit-image-handle')).toBeHidden()
    await operation(page, 'editable', { editable: true })
    await expect(card.locator('.inkkit-image-handle')).toBeVisible()
    expect((await observe(page)).snapshot!.text).toBe(before)
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
  await expect(page.locator('.inkkit-image-handle')).toBeHidden()
  expect((await observe(page)).snapshot!.text).toBe('![[Photo|140]]\n')
})

test('image-adapter handles follow read-only transitions @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&editable=false')
  const image = page.locator('.inkkit-image')
  await expect(image.locator('img')).toBeVisible()
  await image.hover()
  await expect(image.locator('.inkkit-image-handle')).toBeHidden()
  const before = (await observe(page)).snapshot!.text
  await operation(page, 'editable', { editable: true })
  await expect(image.locator('.inkkit-image-handle')).toBeVisible()
  expect((await observe(page)).snapshot!.text).toBe(before)
})
