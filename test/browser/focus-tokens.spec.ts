import { test, expect, operation } from './fixtures'
import type { Locator } from '@playwright/test'

const source =
  '# Focus\n\nA [[Notes/Trip|Trip]] and a note.[^1]\n\n' +
  '> [!note]- Folded\n> Body\n\n```js\nconst a = 1\n```\n\n' +
  '![[Photo|140]]\n\n![[Voice#t=0,0.5]]\n\n![[Movie#t=0,0.5]]\n\n![[Document#page=1]]\n\n' +
  '[^1]: The note.\n'

const ring = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      width: style.outlineWidth,
      style: style.outlineStyle,
      color: style.outlineColor,
      offset: style.outlineOffset,
    }
  })

const red = 'rgb(255, 0, 0)'

test('focus tokens set the ring on every control InkKit draws @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await page.addStyleTag({
    content:
      '#editor { --inkkit-focus-width: 5px; --inkkit-focus-color: rgb(255, 0, 0); --inkkit-focus-offset: 3px; }',
  })
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(page.locator('video')).toHaveCount(1)
  const controls: [string, Locator][] = [
    ['Open', page.getByRole('button', { name: /^Open Photo/ })],
    ['wiki link', page.getByRole('link', { name: 'Trip', exact: true })],
    ['footnote reference', page.locator('.inkkit-footnote-reference')],
    ['audio', page.locator('audio')],
    ['video', page.locator('video')],
    ['callout toggle', page.locator('[data-inkkit-callout-toggle]')],
    ['code language', page.locator('.inkkit-code-language')],
    ['code copy', page.locator('.inkkit-copy')],
  ]
  for (const [name, locator] of controls) {
    // A key press first, so every engine treats the focus as keyboard focus.
    await page.keyboard.press('Shift')
    await locator.first().focus()
    await expect(locator.first(), name).toBeFocused()
    expect(await ring(locator.first()), name).toMatchObject({
      width: '5px',
      style: 'solid',
      color: red,
      offset: '3px',
    })
  }
})

test('the text surfaces take their own ring tokens and leave the controls alone @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await page.addStyleTag({
    content:
      '#editor { --inkkit-focus-color: rgb(255, 0, 0); --inkkit-surface-focus-width: 0px; }',
  })
  const surface = page.getByRole('textbox', {
    name: 'Formatted Markdown editor',
  })
  await page.keyboard.press('Shift')
  await surface.focus()
  await expect(surface).toBeFocused()
  expect((await ring(surface)).width).toBe('0px')
  const open = page.getByRole('button', { name: /^Open Photo/ })
  await page.keyboard.press('Shift')
  await open.focus()
  expect(await ring(open)).toMatchObject({ width: '2px', color: red })
  await operation(page, 'editingMode', { mode: 'source' })
  const plain = page.locator('.inkkit-plain')
  await page.keyboard.press('Shift')
  await plain.focus()
  expect((await ring(plain)).width).toBe('0px')
  await page.addStyleTag({
    content:
      '#editor { --inkkit-surface-focus-width: 4px; --inkkit-surface-focus-color: rgb(0, 0, 255); --inkkit-surface-focus-offset: 1px; }',
  })
  expect(await ring(plain)).toMatchObject({
    width: '4px',
    color: 'rgb(0, 0, 255)',
    offset: '1px',
  })
})
