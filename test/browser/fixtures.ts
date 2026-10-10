import {
  test as base,
  expect,
  type ConsoleMessage,
  type Page,
} from '@playwright/test'
import type { Playground } from '../../playground/controller'

export const test = base.extend<{
  openFixture: (fixture?: string, query?: string) => Promise<void>
  failureEvidence: void
}>({
  failureEvidence: [
    async ({ page }, use, testInfo) => {
      const errors: { kind: string; message: string; location?: unknown }[] = []
      let droppedErrors = 0
      const record = (entry: (typeof errors)[number]) => {
        if (errors.length === 200) {
          errors.shift()
          droppedErrors++
        }
        errors.push(entry)
      }
      const pageError = (error: Error) =>
        record({ kind: 'pageerror', message: error.stack ?? error.message })
      const consoleError = (message: ConsoleMessage) => {
        if (message.type() === 'error')
          record({
            kind: 'console',
            message: message.text(),
            location: message.location(),
          })
      }
      page.on('pageerror', pageError)
      page.on('console', consoleError)
      await use()
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('browser-context', {
          body: JSON.stringify(
            { url: page.url(), errors, droppedErrors },
            null,
            2,
          ),
          contentType: 'application/json',
        })
        for (const [name, capture] of [
          ['observations', () => observe(page)],
          [
            'playground-evidence',
            () =>
              page.evaluate(() => window.inkkitPlayground.captureEvidence()),
          ],
        ] as const) {
          try {
            await testInfo.attach(name, {
              body: JSON.stringify(await capture(), null, 2),
              contentType: 'application/json',
            })
          } catch (error) {
            await testInfo.attach(`${name}-error`, {
              body: String(error),
              contentType: 'text/plain',
            })
          }
        }
      }
      page.off('pageerror', pageError)
      page.off('console', consoleError)
    },
    { auto: true },
  ],
  openFixture: async ({ page }, use) => {
    await use(async (fixture = 'everyday', query = '') => {
      await page.goto(`/?fixture=${fixture}&configuration=rich${query}`)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const state = window.inkkitPlayground?.observe()
            return {
              lifecycle: state?.lifecycle,
              documentId: state?.snapshot?.documentId,
            }
          }),
        )
        .toEqual({ lifecycle: 'ready', documentId: `fixture:${fixture}` })
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
