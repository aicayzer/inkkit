import { expect, test, type Page } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

declare global {
  interface Window {
    cornerRuns: string[]
  }
}

const text = 'Before\n\n```sh\nnpm run build\n```\n\n![[Quotes.pdf]]\n\nAfter\n'

async function mountCorner(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, text }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const before = document.createElement('button')
      before.id = 'before-corner'
      before.textContent = 'Before'
      const root = document.createElement('div')
      root.id = 'corner-host'
      document.body.append(before, root)
      window.cornerRuns = []
      const eye =
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Ccircle cx=%228%22 cy=%228%22 r=%226%22/%3E%3C/svg%3E'
      const editor = await InkKitEditor.mount(
        root,
        { changed() {}, copy() {} },
        {
          files: {
            resolve: async (reference) => ({
              kind: 'file',
              label: reference.target,
              actions: [
                {
                  label: `Quick Look ${reference.target}`,
                  icon: eye,
                  run: (reference) =>
                    window.cornerRuns.push(`look:${reference.target}`),
                },
              ],
            }),
            open: (reference) =>
              window.cornerRuns.push(`open:${reference.target}`),
          },
        },
      )
      editor.loadDocument({
        documentId: 'corner',
        generation: 1,
        format: 'md',
        text,
      })
    },
    { moduleUrl, text },
  )
  await expect(page.locator('#corner-host .inkkit-file-actions')).toHaveCount(1)
}

const copy = (page: Page) => page.locator('#corner-host pre .inkkit-copy')
const actions = (page: Page) =>
  page.locator('#corner-host .inkkit-file-actions')
const away = (page: Page) => page.mouse.move(1, 1)

// Safari uses Option+Tab to include buttons when full keyboard access is off.
const tabKey = (browserName: string) =>
  browserName === 'webkit' ? 'Alt+Tab' : 'Tab'

test('a code block shows Copy as an icon only while the pointer or focus is in it', async ({
  page,
  browserName,
}) => {
  await mountCorner(page)
  await away(page)
  await expect(copy(page)).toHaveCSS('opacity', '0')
  // An icon with a name and no words; the language stays where it was.
  await expect(copy(page)).toHaveAttribute('aria-label', 'Copy')
  expect(await copy(page).textContent()).toBe('')
  await expect(
    page.locator('#corner-host pre .inkkit-code-language'),
  ).toBeVisible()

  await page.locator('#corner-host pre').hover()
  await expect(copy(page)).toHaveCSS('opacity', '1')

  await away(page)
  await expect(copy(page)).toHaveCSS('opacity', '0')
  // Tab reaches the hidden button, and focus shows it.
  await page.locator('#before-corner').focus()
  const reach = async () => {
    for (let count = 0; count < 6; count++) {
      await page.keyboard.press(tabKey(browserName))
      if (
        await copy(page).evaluate(
          (element) => element === document.activeElement,
        )
      )
        return
    }
  }
  await reach()
  await expect(copy(page)).toBeFocused()
  await expect(copy(page)).toHaveCSS('opacity', '1')

  // The caret in the block is focus inside it.
  await page.locator('#before-corner').focus()
  await page.locator('#corner-host pre code').click()
  await away(page)
  await expect(copy(page)).toHaveCSS('opacity', '1')
  // And it leaves again with the caret.
  await page.locator('#corner-host p', { hasText: 'After' }).click()
  await away(page)
  await expect(copy(page)).toHaveCSS('opacity', '0')
})

test('a file card shows its actions as icons in the corner, host action first, only under the pointer or focus', async ({
  page,
  browserName,
}) => {
  await mountCorner(page)
  await away(page)
  const card = page.locator('#corner-host .inkkit-file')
  await expect(actions(page)).toHaveCSS('opacity', '0')
  const buttons = actions(page).locator('button')
  await expect(buttons).toHaveCount(2)
  await expect(buttons.nth(0)).toHaveAttribute(
    'aria-label',
    'Quick Look Quotes.pdf',
  )
  await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Open Quotes.pdf')
  for (const button of await buttons.all())
    expect((await button.textContent()) ?? '').toBe('')

  await card.hover()
  await expect(actions(page)).toHaveCSS('opacity', '1')
  // The corner under the pointer: the actions end the card's first row on the right.
  const box = (await card.boundingBox())!
  const last = (await buttons.nth(1).boundingBox())!
  expect(box.x + box.width - (last.x + last.width)).toBeLessThan(16)
  expect(last.y - box.y).toBeLessThan(16)
  // The host's icon is drawn: a mask in the text color, not an empty box.
  const mask = await buttons
    .nth(0)
    .locator('.inkkit-file-icon-image')
    .evaluate((element) => getComputedStyle(element).maskImage)
  expect(mask).toContain('data:image/svg+xml')

  await buttons.nth(0).click()
  await buttons.nth(1).click()
  expect(await page.evaluate(() => window.cornerRuns)).toEqual([
    'look:Quotes.pdf',
    'open:Quotes.pdf',
  ])

  // The clicked button holds focus, which keeps the actions shown until focus leaves.
  await expect(actions(page)).toHaveCSS('opacity', '1')
  await page.locator('#before-corner').focus()
  await away(page)
  await expect(actions(page)).toHaveCSS('opacity', '0')
  for (let count = 0; count < 8; count++) {
    if (
      await buttons
        .nth(0)
        .evaluate((element) => element === document.activeElement)
    )
      break
    await page.keyboard.press(tabKey(browserName))
  }
  await expect(buttons.nth(0)).toBeFocused()
  await expect(actions(page)).toHaveCSS('opacity', '1')
  await page.keyboard.press('Enter')
  await page.keyboard.press(tabKey(browserName))
  await expect(buttons.nth(1)).toBeFocused()
  await page.keyboard.press('Space')
  expect(await page.evaluate(() => window.cornerRuns)).toEqual([
    'look:Quotes.pdf',
    'open:Quotes.pdf',
    'look:Quotes.pdf',
    'open:Quotes.pdf',
  ])
})

test.describe('a device with no hover', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('shows Copy and the file card actions always', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium reports no hover for touch emulation.',
    )
    await mountCorner(page)
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(
      true,
    )
    await expect(copy(page)).toHaveCSS('opacity', '1')
    await expect(actions(page)).toHaveCSS('opacity', '1')
  })
})
