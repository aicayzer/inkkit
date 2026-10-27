import type { Page } from '@playwright/test'

/** Trusted browser keydown through the following frame, including editor work. */
export async function keyToFrame(page: Page, key: string): Promise<number> {
  await page.evaluate(() => {
    const probe = window as unknown as { keyToFrame: Promise<number> }
    probe.keyToFrame = new Promise((resolve) =>
      document.addEventListener(
        'keydown',
        () => {
          const start = performance.now()
          requestAnimationFrame(() =>
            setTimeout(() => resolve(performance.now() - start)),
          )
        },
        { capture: true, once: true },
      ),
    )
  })
  await page.keyboard.press(key)
  return page.evaluate(
    () => (window as unknown as { keyToFrame: Promise<number> }).keyToFrame,
  )
}
