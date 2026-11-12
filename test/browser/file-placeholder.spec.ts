import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

declare global {
  interface Window {
    placeholderOpened: string[]
    placeholderText(): string
  }
}

test('a placeholder button is reached by Tab, is named by its text and label, and Return and Space open that file alone', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  const text = '![[first.png]]\n\n![[second.png]]\n'
  const saved = await page.evaluate(
    async ({ moduleUrl, text }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const before = document.createElement('button')
      before.id = 'before-placeholder'
      before.textContent = 'Before'
      const root = document.createElement('div')
      root.id = 'placeholder-host'
      document.body.append(before, root)
      window.placeholderOpened = []
      const editor = await InkKitEditor.mount(
        root,
        { changed() {} },
        {
          files: {
            resolve: async (reference) => ({
              kind: 'file',
              label: reference.target,
              appearance: 'placeholder',
              action: 'Load',
            }),
            open: (reference) =>
              window.placeholderOpened.push(reference.target),
          },
        },
      )
      editor.loadDocument({
        documentId: 'placeholder',
        generation: 1,
        format: 'md',
        text,
      })
      window.placeholderText = () => editor.snapshot().text
      return editor.snapshot().text
    },
    { moduleUrl, text },
  )
  expect(saved).toBe(text)
  const buttons = page.locator('#placeholder-host .inkkit-file-action')
  await expect(buttons).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Load second.png' }),
  ).toHaveCount(1)
  // The line itself is not a control.
  await expect(
    page.locator('#placeholder-host .inkkit-file[tabindex]'),
  ).toHaveCount(0)
  // Safari uses Option+Tab to include buttons when full keyboard access is off.
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  const previous = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab'
  // The editing surface can be a tab stop of its own, so allow it before the button.
  const reach = async (key: string, index: number) => {
    for (
      let count = 0;
      count < 3 &&
      !(await buttons
        .nth(index)
        .evaluate((element) => element === document.activeElement));
      count++
    )
      await page.keyboard.press(key)
    await expect(buttons.nth(index)).toBeFocused()
  }
  await page.locator('#before-placeholder').focus()
  await reach(next, 0)
  await reach(next, 1)
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.placeholderOpened)).toEqual([
    'second.png',
  ])
  await page.keyboard.press('Space')
  expect(await page.evaluate(() => window.placeholderOpened)).toEqual([
    'second.png',
    'second.png',
  ])
  await reach(previous, 0)
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.placeholderOpened)).toEqual([
    'second.png',
    'second.png',
    'first.png',
  ])
  // Return and Space belong to the button: neither changed the document.
  expect(await page.evaluate(() => window.placeholderText())).toBe(text)
  await expect(buttons).toHaveCount(2)
})
