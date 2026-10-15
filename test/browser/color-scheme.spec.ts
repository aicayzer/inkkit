import { test, expect, operation } from './fixtures'
import type { Page } from '@playwright/test'

const light = {
  keyword: 'rgb(166, 38, 164)',
  string: 'rgb(59, 118, 58)',
  number: 'rgb(141, 96, 1)',
  title: 'rgb(141, 97, 1)',
  attr: 'rgb(200, 44, 30)',
  comment: [0, 0, 0],
}
const dark = {
  keyword: 'rgb(199, 123, 222)',
  string: 'rgb(152, 195, 121)',
  number: 'rgb(209, 154, 102)',
  title: 'rgb(229, 192, 123)',
  attr: 'rgb(227, 121, 129)',
  comment: [255, 255, 255],
}

const source =
  '```js\n// greeting\nconst greeting = \'hello\'\nfunction greet() {\n  return 42\n}\n```\n\n```json\n{"name": 1}\n```\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```mermaid\nmindmap\nRoot\n```\n'

async function open(
  page: Page,
  openFixture: (fixture?: string) => Promise<void>,
) {
  await openFixture('mermaid')
  await operation(page, 'replaceSource', { text: source })
  await expect(
    page.locator('.inkkit-root .inkkit-hljs-attr').first(),
  ).toBeVisible()
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

const kinds = ['keyword', 'string', 'number', 'title', 'attr', 'comment']

// Each token's color, the comment as RGB and alpha, and its contrast with the
// code background composited over the page, as WCAG 2 defines it.
const codeColors = (page: Page) =>
  page.evaluate((kinds) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return [r!, g!, b!, a! / 255]
    }
    const over = (top: number[], bottom: number[]) =>
      top.slice(0, 3).map((c, i) => c * top[3]! + bottom[i]! * (1 - top[3]!))
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const result: Record<string, unknown> = {}
    for (const kind of kinds) {
      const element = document.querySelector(
        `.inkkit-root .inkkit-hljs-${kind}`,
      )!
      const color = getComputedStyle(element).color
      const layers: number[][] = []
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const layer = rgba(getComputedStyle(node).backgroundColor)
        layers.push(layer)
        if (layer[3] === 1) break
      }
      const background = layers.reduceRight(
        (below, layer) => over(layer, below),
        [255, 255, 255],
      )
      const [a, b] = [
        luminance(over(rgba(color), background)),
        luminance(background),
      ]
      result[kind] = kind === 'comment' ? rgba(color).slice(0, 3) : color
      result[`${kind}Contrast`] =
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    return result
  }, kinds)

const colorsOnly = (colors: Record<string, unknown>) =>
  Object.fromEntries(kinds.map((kind) => [kind, colors[kind]]))

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
    expect(colorsOnly(await codeColors(page))).toEqual(expected)
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
    expect(colorsOnly(await codeColors(page))).toEqual(expected)
  })

for (const scheme of ['light', 'dark'] as const)
  test(`default ${scheme} code colors meet WCAG AA contrast on the code background @color-scheme`, async ({
    page,
    openFixture,
  }) => {
    await page.emulateMedia({
      colorScheme: scheme === 'light' ? 'dark' : 'light',
    })
    await open(page, openFixture)
    await page.evaluate((scheme) => {
      document.documentElement.style.colorScheme = scheme
    }, scheme)
    await setRoot(page, '--inkkit-color-scheme', scheme)
    const colors = await codeColors(page)
    expect(colorsOnly(colors)).toEqual(scheme === 'light' ? light : dark)
    const contrast = Object.fromEntries(
      kinds.map((kind) => [kind, colors[`${kind}Contrast`] as number]),
    )
    expect(
      Object.entries(contrast).filter(([, ratio]) => ratio < 4.5),
      JSON.stringify(contrast),
    ).toEqual([])
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
