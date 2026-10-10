import { test, expect, observe, operation } from './fixtures'

test('actionable controlled assertion failure @intentional-failure', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await operation(page, 'find', { text: 'bold' })
  expect(
    (await observe(page)).snapshot!.text,
    'Intentional failure: observations, screenshot and trace must identify the actual fixture',
  ).toBe('Intentionally incorrect expected source')
})
