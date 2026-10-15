import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

test('typing after inline code is switched on at a caret stays in the code until it is switched off @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run now\n' })
  await caretAfterMatch(page, 'Run')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('npm i x')
  let observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run`npm i x` now\n')
  await operation(page, 'format', { command: 'code' })
  await page.keyboard.type('yz')
  observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run`npm i x`yz now\n')
  await expect(
    page
      .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
      .locator('code'),
  ).toHaveText('npm i x')
})

test('typing after the end of an existing code span leaves it @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'Run `npm` now\n' })
  await caretAfterMatch(page, 'npm')
  await page.keyboard.type('xy')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run `npm`xy now\n')
})
