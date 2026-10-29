import type { Page } from '@playwright/test'
import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

const saved = async (page: Page) => (await observe(page)).snapshot!.text

const marks = [
  { name: 'underline', key: 'u', tag: 'u' },
  { name: 'superscript', key: '.', tag: 'sup' },
  { name: 'subscript', key: ',', tag: 'sub' },
] as const

for (const { name, key, tag } of marks)
  test(`the ${name} shortcut formats, unformats, takes typing and undoes with real keys @inline-marks`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    const source =
      'Keep &amp; \\*literal\\* these words here\r\n\r\nOther &amp; <u>kept</u> line\r\n'
    await operation(page, 'reload', { text: source })
    await operation(page, 'keymap', {
      keymap: {
        underline: ['Mod-u'],
        superscript: ['Mod-.'],
        subscript: ['Mod-,'],
      },
    })
    const formatted = page.getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    })
    const marked = (text: string) => formatted.locator(tag, { hasText: text })
    const applied = source.replace('words', `<${tag}>words</${tag}>`)

    expect(await operation(page, 'find', { text: 'words' })).toBe(true)
    await page.keyboard.press(`ControlOrMeta+${key}`)
    await expect.poll(() => saved(page)).toBe(applied)
    await expect(marked('words')).toHaveCount(1)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => saved(page)).toBe(source)
    await page.keyboard.press('Shift+ControlOrMeta+z')
    await expect.poll(() => saved(page)).toBe(applied)

    // The selection is still the word, so the shortcut removes the mark.
    await page.keyboard.press(`ControlOrMeta+${key}`)
    await expect.poll(() => saved(page)).toBe(source)
    await expect(marked('words')).toHaveCount(0)

    await page.keyboard.press(`ControlOrMeta+${key}`)
    await expect.poll(() => saved(page)).toBe(applied)
    await caretAfterMatch(page, 'wor')
    await page.keyboard.type('X')
    const typed = applied.replace('words', 'worXds')
    await expect.poll(() => saved(page)).toBe(typed)
    await expect(marked('worXds')).toHaveCount(1)

    // History may group the typing with the formatting just before it, so
    // undo goes back through the formatted text to the source.
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => saved(page)).not.toBe(typed)
    expect([applied, source]).toContain(await saved(page))
    if ((await saved(page)) === applied) {
      await page.keyboard.press('ControlOrMeta+z')
      await expect.poll(() => saved(page)).toBe(source)
    }
    await expect(marked('words')).toHaveCount(0)
    // The other block's tags were never rewritten.
    expect(await saved(page)).toContain('Other &amp; <u>kept</u> line\r\n')
    await operation(page, 'reload', { text: typed })
    await expect.poll(() => saved(page)).toBe(typed)
    await expect(marked('worXds')).toHaveCount(1)
  })
