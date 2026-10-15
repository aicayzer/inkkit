import { test, expect, observe, operation } from './fixtures'

// Milkdown could not build a callout whose last paragraph is a lone HTML break, so the note loaded
// without it and the first keystroke saved over it. The callout now loads formatted; the unit
// tests in test/parse-failure.test.ts force the failure for every kind of block.
const callout = '> [!NOTE]\n> Body\n>\n> <br />\n'

for (const [name, source, at, saved] of [
  [
    'typing after it keeps it',
    `${callout}\nAfter.\n`,
    'After.',
    `${callout}\nAfter.More\n`,
  ],
  [
    'typing in it edits its source',
    callout,
    'Body',
    callout.replace('Body', 'BodyMore'),
  ],
] as const)
  test(`a block the editor cannot build: ${name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      source,
    )
    await operation(page, 'find', { text: at })
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('More')
    await expect
      .poll(async () => (await observe(page)).snapshot?.text)
      .toBe(saved)
  })
