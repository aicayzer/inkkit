import { test as base, expect, type Page } from '@playwright/test'
import type { playground } from '../../playground/main'

type Playground = typeof playground
export const test = base.extend<{
  openFixture: (fixture?: string, query?: string) => Promise<void>
}>({
  openFixture: async ({ page }, use) => {
    await use(async (fixture = 'everyday', query = '') => {
      await page.goto(`/?fixture=${fixture}&configuration=rich${query}`)
      await expect
        .poll(() =>
          page.evaluate(
            () => window.inkkitPlayground?.observe().snapshot?.documentId,
          ),
        )
        .toBe(`fixture:${fixture}`)
    })
  },
})
export { expect }
export const observe = (page: Page) =>
  page.evaluate(() => window.inkkitPlayground.observe())
export const operation = (
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
) =>
  page.evaluate(
    async ({ name, args }) => window.inkkitPlayground.operation(name, args),
    { name, args },
  )
// Call after a click or other focus that is not a playground operation, before
// a key that only moves the caret; operations that focus the editor already
// wait. The playground explains why.
export const focusSettled = (page: Page) =>
  page.evaluate(() => window.inkkitPlayground.focusSettled())
// Puts the caret at the end of the next match of `text`.
export async function caretAfterMatch(page: Page, text: string) {
  expect(await operation(page, 'find', { text })).toBe(true)
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => {
      const { selection } = (await observe(page)).textSnapshot!
      return selection.to - selection.from
    })
    .toBe(0)
}
export const reset = (page: Page, fixture?: string) =>
  page.evaluate(
    async (fixture) => window.inkkitPlayground.reset(fixture),
    fixture,
  )

declare global {
  interface Window {
    inkkitPlayground: Playground
  }
}
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    try {
      await testInfo.attach('observations', {
        body: JSON.stringify(await observe(page), null, 2),
        contentType: 'application/json',
      })
    } catch (error) {
      await testInfo.attach('observation-error', {
        body: String(error),
        contentType: 'text/plain',
      })
    }
  }
})
