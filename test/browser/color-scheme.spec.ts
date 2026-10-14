import { test, expect, operation } from './fixtures'
import type { Page } from '@playwright/test'

const light = { keyword: 'rgb(166, 38, 164)', string: 'rgb(80, 161, 79)' }
const dark = { keyword: 'rgb(198, 120, 221)', string: 'rgb(152, 195, 121)' }

const source =
  "```js\nconst greeting = 'hello'\n```\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```mermaid\nmindmap\nRoot\n```\n"

async function open(
  page: Page,
  openFixture: (fixture?: string) => Promise<void>,
) {
  await openFixture('mermaid')
  await operation(page, 'replaceSource', { text: source })
  await expect(page.locator('.inkkit-root .hljs-keyword').first()).toBeVisible()
  await expect(
    page.locator('.inkkit-mermaid-preview[data-state="ready"]'),
  ).toHaveCount(1)
}

const setRoot = (page: Page, name: string, value: string | null) =>
  page.evaluate(
    ({ name, value }) => {
      const root = document.querySelector<HTMLElement>('.inkkit-root')!
      if (value === null) root.style.removeProperty(name)
      else root.style.setProperty(name, value)
    },
    { name, value },
  )

const codeColors = async (page: Page) => ({
  keyword: await page
    .locator('.inkkit-root .hljs-keyword')
    .first()
    .evaluate((element) => getComputedStyle(element).color),
  string: await page
    .locator('.inkkit-root .hljs-string')
    .first()
    .evaluate((element) => getComputedStyle(element).color),
})

for (const [system, forced, expected] of [
  ['dark', 'light', light],
  ['light', 'dark', dark],
  ['dark', 'only light', light],
] as const)
  test(`code colors follow a forced ${forced} editor scheme on a ${system} system @color-scheme`, async ({
    page,
    openFixture,
  }) => {
    await page.emulateMedia({ colorScheme: system })
    await open(page, openFixture)
    await setRoot(page, '--inkkit-color-scheme', forced)
    expect(await codeColors(page)).toEqual(expected)
  })

for (const [system, expected] of [
  ['light', light],
  ['dark', dark],
] as const)
  test(`code colors follow a ${system} system with the default scheme @color-scheme`, async ({
    page,
    openFixture,
  }) => {
    await page.emulateMedia({ colorScheme: system })
    await open(page, openFixture)
    expect(await codeColors(page)).toEqual(expected)
  })

test('code color tokens override either scheme @color-scheme', async ({
  page,
  openFixture,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page, openFixture)
  await setRoot(page, '--inkkit-color-scheme', 'light')
  await setRoot(page, '--inkkit-code-keyword', '#123456')
  expect((await codeColors(page)).keyword).toBe('rgb(18, 52, 86)')
})

const previewColors = (page: Page, state: string) =>
  page
    .locator(`.inkkit-mermaid-preview[data-state="${state}"]`)
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color }
    })

for (const system of ['light', 'dark'] as const)
  test(`diagram previews keep their default colors on a ${system} system @color-scheme @diagrams`, async ({
    page,
    openFixture,
  }) => {
    await page.emulateMedia({ colorScheme: system })
    await open(page, openFixture)
    await setRoot(
      page,
      '--inkkit-color-scheme',
      system === 'light' ? 'dark' : 'light',
    )
    expect(await previewColors(page, 'ready')).toEqual({
      background: 'rgb(255, 255, 255)',
      color: 'rgb(34, 34, 34)',
    })
    expect(await previewColors(page, 'error')).toEqual({
      background: 'rgb(255, 255, 255)',
      color: 'rgb(155, 36, 36)',
    })
  })

test('diagram preview color tokens apply @color-scheme @diagrams', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await setRoot(page, '--inkkit-diagram-background', '#202020')
  await setRoot(page, '--inkkit-diagram-text-color', '#eeeeee')
  await setRoot(page, '--inkkit-diagram-error-color', '#ff8080')
  expect(await previewColors(page, 'ready')).toEqual({
    background: 'rgb(32, 32, 32)',
    color: 'rgb(238, 238, 238)',
  })
  expect(await previewColors(page, 'error')).toEqual({
    background: 'rgb(32, 32, 32)',
    color: 'rgb(255, 128, 128)',
  })
})
