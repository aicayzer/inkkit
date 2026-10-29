import { test, expect, observe, operation } from './fixtures'

test('unknown preview choices fall back to usable default styles @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday', '&theme=nope&appearance=sepia')
  await expect(page.getByRole('alert')).toContainText('Unknown theme "nope"')
  await expect(page.getByRole('alert')).toContainText(
    'Unknown appearance "sepia"',
  )
  await expect(
    page.getByRole('combobox', { name: 'Theme', exact: true }),
  ).toHaveValue('default')
  await expect(
    page.getByRole('combobox', { name: 'Appearance', exact: true }),
  ).toHaveValue('system')
  expect((await observe(page)).snapshot!.dirty).toBe(false)
})

test('development theme controls preserve bytes, revision and history @playground-tools', async ({
  page,
  openFixture,
}) => {
  await openFixture('untidy', '&editors=2')
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await source.press('ControlOrMeta+End')
  await source.pressSequentially('A theme edit.')
  const before = await observe(page)
  for (const theme of ['standard', 'calm', 'essential']) {
    await page
      .getByRole('combobox', { name: 'Theme', exact: true })
      .selectOption(theme)
    await page
      .getByRole('combobox', { name: 'Appearance', exact: true })
      .selectOption('dark')
    expect((await observe(page)).snapshot).toEqual(before.snapshot)
    expect((await observe(page)).snapshot!.generation).toBe(
      before.snapshot!.generation,
    )
    expect((await observe(page)).commandState).toEqual(before.commandState)
    await expect(page.locator('#editors')).toHaveAttribute(
      'data-inkkit-theme',
      theme,
    )
    for (const id of ['editor', 'second-editor'])
      expect(
        await page
          .locator(`#${id}`)
          .evaluate((root) => getComputedStyle(root).colorScheme),
      ).toBe('dark')
  }
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).not.toContain('A theme edit.')
  await operation(page, 'redo')
  expect((await observe(page)).snapshot!.text).toBe(before.snapshot!.text)
  const shared = page.url()
  await page.goto(shared)
  await expect(
    page.getByRole('combobox', { name: 'Theme', exact: true }),
  ).toHaveValue('essential')
  await expect(
    page.getByRole('combobox', { name: 'Appearance', exact: true }),
  ).toHaveValue('dark')
})
