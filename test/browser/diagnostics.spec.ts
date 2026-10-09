import { test, expect, observe } from './fixtures'

test('actionable controlled assertion failure @intentional-failure', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  expect(
    (await observe(page)).snapshot!.text,
    'Intentional failure: observations, screenshot and trace must identify the actual fixture',
  ).toBe('Intentionally incorrect expected source')
})
