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
