import type { Page } from '@playwright/test'

// Date-only control separates history steps without delaying native input or
// replacing the browser's timers and selection handling.
export async function nextHistoryStep(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  await page.clock.setFixedTime(now + 501)
}

// Install before navigation: existing timers must not cross clock ownership.
export async function controlInputTimers(page: Page): Promise<void> {
  await page.clock.install()
}

// ProseMirror schedules composition/DOM reconciliation at 20 ms and selection
// suppression at 50 ms. Run those callbacks before checking a negative result.
export async function finishInput(page: Page): Promise<void> {
  await page.clock.runFor(50)
}
