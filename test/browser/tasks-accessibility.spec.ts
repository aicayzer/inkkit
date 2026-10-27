import { test, expect, observe, operation } from './fixtures'

test('task checkboxes announce state and toggle with the keyboard without losing focus', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = '* [ ] Café 🐈\r\n* [x] Other\r\n'
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  const checkbox = page.getByRole('checkbox', { name: 'Café 🐈' })
  await expect(checkbox).not.toBeChecked()
  await checkbox.focus()
  await expect(checkbox).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeFocused()
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('[ ]', '[x]'),
  )
  await page.keyboard.press('Enter')
  await expect(checkbox).not.toBeChecked()
  await expect(checkbox).toBeFocused()
  expect((await observe(page)).snapshot!.text).toBe(source)
  await operation(page, 'editable', { editable: false })
  await expect(checkbox).toHaveAttribute('aria-readonly', 'true')
  await page.keyboard.press('Space')
  expect((await observe(page)).snapshot!.text).toBe(source)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('checkbox', { name: 'Other' })).toBeFocused()
})

test('task command works with a configured key at the writing caret', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('- [ ] Café\n', 'md'),
  )
  await operation(page, 'keymap', { keymap: { toggleTask: ['Ctrl-Enter'] } })
  await operation(page, 'focus')
  await page.keyboard.press('Control+Enter')
  expect((await observe(page)).snapshot!.text).toBe('- [x] Café\n')
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe('- [ ] Café\n')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`default link, footnote and task colors contrast in ${scheme}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.evaluate(() =>
      window.inkkitPlayground.replaceDocument(
        '[Link](https://example.com) and note[^n].\n\n- [ ] Task\n\n[^n]: Note\n',
        'md',
      ),
    )
    const values = await page
      .locator('.inkkit-root')
      .evaluate((root, scheme) => {
        root.style.setProperty('--inkkit-color-scheme', scheme)
        root.style.backgroundColor = 'Canvas'
        const background = getComputedStyle(root).backgroundColor
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        const luminance = (color: string) => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = background
          context.fillRect(0, 0, 1, 1)
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          const channels = [...context.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((c) => {
              const s = c / 255
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
            })
          return (
            channels[0]! * 0.2126 +
            channels[1]! * 0.7152 +
            channels[2]! * 0.0722
          )
        }
        const contrast = (color: string) => {
          const values = [luminance(background), luminance(color)].sort(
            (a, b) => b - a,
          )
          return (values[0]! + 0.05) / (values[1]! + 0.05)
        }
        return {
          link: contrast(getComputedStyle(root.querySelector('a')!).color),
          footnote: contrast(
            getComputedStyle(root.querySelector('.inkkit-footnote-reference')!)
              .color,
          ),
          task: contrast(
            getComputedStyle(root.querySelector('li')!, '::before')
              .borderTopColor,
          ),
        }
      }, scheme)
    expect(values.link).toBeGreaterThanOrEqual(4.5)
    expect(values.footnote).toBeGreaterThanOrEqual(4.5)
    expect(values.task).toBeGreaterThanOrEqual(3)
    await page
      .locator('.inkkit-root')
      .evaluate((root) =>
        root.style.setProperty('--inkkit-accent-color', '#a000a0'),
      )
    await expect(page.locator('.inkkit-root a').first()).toHaveCSS(
      'color',
      'rgb(160, 0, 160)',
    )
  })
}

test('forced-colors retains a contrasting tick only on checked tasks', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit does not emulate forced-colors.',
  )
  await page.emulateMedia({ forcedColors: 'active' })
  await openFixture()
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('- [ ] Open\n- [x] Done\n', 'md'),
  )
  const markers = await page
    .locator('li[data-item-type="task"]')
    .evaluateAll((items) =>
      items.map((item) => ({
        tick: getComputedStyle(item, '::after').content,
        tickColor: getComputedStyle(item, '::after').borderTopColor,
        fill: getComputedStyle(item, '::before').backgroundColor,
      })),
    )
  expect(markers[0]!.tick).toBe('none')
  expect(markers[1]!.tick).toBe('""')
  expect(markers[1]!.tickColor).not.toBe(markers[1]!.fill)
})
