import { test, expect, observe } from './fixtures'

const source = [
  '# Table details',
  '',
  '| Name | State | Notes |',
  '| :--- | :--- | :--- |',
  '| First | Ready | A short note |',
  '| Second | Pending | Another note |',
  '',
  '- [ ] Unchecked task',
  '- [x] Checked task',
  '',
  '[reference]: https://example.com "Reference"',
  '',
].join('\n')

for (const scheme of ['light', 'dark'] as const) {
  test(`table perimeter stays rounded with square divisions in ${scheme}`, async ({
    page,
    openFixture,
    browserName,
  }) => {
    await openFixture()
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      source,
    )
    await page.addStyleTag({
      content: `#editor { --inkkit-color-scheme: ${scheme}; background: ${scheme === 'light' ? '#fff' : '#202023'}; }`,
    })
    const table = page.locator('#editor table')
    const radius = () =>
      table.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
    expect(await radius()).toBe('4px')
    expect(
      await table.locator('tr:nth-child(2) td:nth-child(2)').evaluate((el) => {
        const style = getComputedStyle(el)
        return [
          style.borderRadius,
          style.borderRightWidth,
          style.borderBottomWidth,
        ]
      }),
    ).toEqual(['0px', '1px', '1px'])
    expect((await observe(page)).snapshot?.text).toBe(source)
    await table.locator('td').last().click()
    await page.mouse.move(0, 0)
    const column = page
      .locator('.inkkit-table-controls')
      .getByRole('button', { name: 'Move column', exact: true })
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(column).toBeFocused()
    expect(
      await column.evaluate((el) => getComputedStyle(el).outlineWidth),
    ).toBe('2px')
    await page.keyboard.press('Enter')
    await expect(page.locator('.inkkit-table-line')).toHaveCount(3)
    expect(
      await page
        .locator('.inkkit-table-line')
        .first()
        .evaluate((el) => getComputedStyle(el, '::after').backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)')
    await page.keyboard.press('Escape')
    await page.addStyleTag({
      content: '#editor { width: 190px; max-width: 190px; flex: none; }',
    })
    const scroll = page.locator('.inkkit-table-scroll')
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    )
    await scroll.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await table.locator('th').last().click()
    await expect(column).toBeVisible()
    expect((await observe(page)).snapshot?.text).toBe(source)
    await page.addStyleTag({
      content: '#editor { --inkkit-table-radius: 0px; }',
    })
    expect(await radius()).toBe('0px')
    expect(
      await table
        .locator('th')
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    ).toBe('0px')
    expect((await observe(page)).snapshot?.text).toBe(source)
  })
}

test('reference font and task checkbox border respect host tokens', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await page.addStyleTag({
    content:
      '#editor { --inkkit-monospace-font: Courier; --inkkit-checkbox-border-color: rgb(130, 50, 70); }',
  })
  expect(
    await page
      .locator('.inkkit-reference-definition')
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Courier')
  expect(
    await page
      .locator('li[data-checked="false"]')
      .evaluate((el) => getComputedStyle(el, '::before').borderColor),
  ).toBe('rgb(130, 50, 70)')
  expect(
    await page
      .locator('li[data-checked="true"]')
      .evaluate((el) => getComputedStyle(el, '::before').borderColor),
  ).not.toBe('rgb(130, 50, 70)')
})
