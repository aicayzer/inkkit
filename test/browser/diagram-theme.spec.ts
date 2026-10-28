import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const authored =
  '~~~mermaid\r\npie title Categories\r\n"First" : 1\r\n"Second" : 1\r\n~~~\r\n'

const setTokens = (page: Page, tokens: Record<string, string>) =>
  page.locator('.inkkit-root').evaluate((root, tokens) => {
    for (const [name, value] of Object.entries(tokens))
      root.style.setProperty(name, value)
  }, tokens)

const preview = (page: Page) =>
  page.locator('.inkkit-mermaid-preview svg').evaluate((svg) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const slice = svg.querySelector('.pele-slice')!
    const label = svg.querySelector('.pele-slice-labels text')!
    return {
      html: svg.outerHTML,
      fill: rgb(getComputedStyle(slice).fill),
      background: rgb(getComputedStyle(svg.parentElement!).backgroundColor),
      labelFill: rgb(getComputedStyle(label).fill),
      labelOutline: rgb(getComputedStyle(label).stroke),
    }
  })

function expectRGB(actual: number[], expected: number[]) {
  for (let index = 0; index < 3; index++)
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThanOrEqual(1)
}

// Capture the actual SVG handed to the image decoder; the native URL function
// still runs, and the test reads pixels from the returned PNG as well.
const exportDiagram = (page: Page, kind: 'printable' | 'clipboard') =>
  page.evaluate(async (kind) => {
    const createURL = URL.createObjectURL.bind(URL)
    const captures: Promise<string>[] = []
    URL.createObjectURL = (object) => {
      if (object instanceof Blob && object.type === 'image/svg+xml')
        captures.push(object.text())
      return createURL(object)
    }
    try {
      const output = await window.inkkitPlayground.operation(kind, {
        scope: 'document',
      })
      const image =
        kind === 'printable'
          ? (output as import('../../src/types').PrintableDocument).assets[0]!
          : (output as import('../../src/types').ClipboardOutput).diagrams[0]!
              .image!
      const sources = await Promise.all(captures)
      const svg = new DOMParser().parseFromString(sources[0]!, 'image/svg+xml')
        .documentElement as unknown as SVGSVGElement
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      const rgb = (color: string) => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
      }
      const fill = rgb(svg.querySelector('.pele-slice')!.getAttribute('fill')!)
      const png = new Image()
      const pngURL = createURL(
        new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
      )
      try {
        await new Promise<void>((resolve, reject) => {
          png.onload = () => resolve()
          png.onerror = () => reject(new Error('The exported PNG did not load'))
          png.src = pngURL
        })
        canvas.width = png.naturalWidth
        canvas.height = png.naturalHeight
        context.drawImage(png, 0, 0)
        const corner = [...context.getImageData(0, 0, 1, 1).data]
        const center = svg
          .querySelector('.pele-slices')!
          .getAttribute('transform')!
          .match(/translate\(([\d.]+)[,\s]+([\d.]+)\)/)!
        const viewBox = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
        // The first half occupies the right side. This point is inside the
        // slice, away from its edge and percentage label.
        const x = ((Number(center[1]) + 30) * canvas.width) / viewBox[2]!
        const y = (Number(center[2]) * canvas.height) / viewBox[3]!
        const slicePixel = [
          ...context.getImageData(Math.round(x), Math.round(y), 1, 1).data,
        ].slice(0, 3)
        return {
          sources,
          fill,
          corner,
          slicePixel,
          font: svg.style.fontFamily,
          background: svg.style.background,
          viewBox: svg.getAttribute('viewBox'),
          bytes: Array.from(image.bytes),
        }
      } finally {
        URL.revokeObjectURL(pngURL)
      }
    } finally {
      URL.createObjectURL = createURL
    }
  }, kind)

test('diagram palettes update existing geometry and preserve authored bytes @diagrams @color-scheme', async ({
  page,
  openFixture,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openFixture('mermaid')
  await operation(page, 'replaceSource', { text: authored })
  await expect(page.locator('.inkkit-mermaid-preview')).toHaveAttribute(
    'data-state',
    'ready',
  )
  const saved = (await observe(page)).snapshot
  const pale = await preview(page)
  expectRGB(pale.fill, [166, 213, 255])
  expectRGB(pale.background, [255, 255, 255])

  await setTokens(page, { '--inkkit-diagram-color-strength': '75%' })
  const softer = await preview(page)
  expectRGB(softer.fill, [64, 166, 255])
  expect(softer.html).toBe(pale.html)

  await setTokens(page, { '--inkkit-color-scheme': 'dark' })
  const dark = await preview(page)
  expectRGB(dark.fill, [7, 116, 199])
  expectRGB(dark.background, [28, 28, 30])
  expectRGB(dark.labelFill, [242, 242, 247])
  expectRGB(dark.labelOutline, [28, 28, 30])
  expect(dark.html).toBe(pale.html)

  await setTokens(page, { '--inkkit-diagram-color-strength': '35%' })
  const darkPale = await preview(page)
  expectRGB(darkPale.fill, [18, 69, 109])
  expect(darkPale.html).toBe(pale.html)

  await setTokens(page, {
    '--inkkit-diagram-color-strength': '75%',
    '--inkkit-diagram-series-1': 'light-dark(#ff0000, #00ff00)',
  })
  const custom = await preview(page)
  expectRGB(custom.fill, [7, 198, 8])
  expect(custom.html).toBe(pale.html)
  expect((await observe(page)).snapshot).toEqual(saved)
  await operation(page, 'reload')
  expect((await observe(page)).snapshot?.text).toBe(authored)
})

test('clipboard and print freeze the current light palette without stale exports @diagrams @color-scheme', async ({
  page,
  openFixture,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openFixture('mermaid')
  await operation(page, 'replaceSource', { text: authored })
  await expect(page.locator('.inkkit-mermaid-preview')).toHaveAttribute(
    'data-state',
    'ready',
  )
  const saved = (await observe(page)).snapshot
  const pale = await exportDiagram(page, 'printable')
  expectRGB(pale.fill, [166, 213, 255])
  expectRGB(pale.slicePixel, [166, 213, 255])

  await setTokens(page, {
    '--inkkit-color-scheme': 'dark',
    '--inkkit-diagram-color-strength': '75%',
    '--inkkit-diagram-series-1': 'light-dark(#ff0000, #00ff00)',
  })
  expectRGB((await preview(page)).fill, [7, 198, 8])
  const stronger = await exportDiagram(page, 'printable')
  const copied = await exportDiagram(page, 'clipboard')
  for (const output of [stronger, copied]) {
    expectRGB(output.fill, [255, 64, 64])
    expectRGB(output.slicePixel, [255, 64, 64])
    expect(output.viewBox).toBe(pale.viewBox)
    expect(output.bytes).not.toEqual(pale.bytes)
  }

  await setTokens(page, { '--inkkit-diagram-color-strength': '35%' })
  const changed = await exportDiagram(page, 'printable')
  expectRGB(changed.fill, [255, 166, 166])
  expectRGB(changed.slicePixel, [255, 166, 166])
  expect(changed.bytes).not.toEqual(stronger.bytes)
  for (const output of [pale, stronger, copied, changed]) {
    expect(output.sources).toHaveLength(1)
    expect(output.sources[0]).not.toContain('var(')
    expect(output.font).toBe('Arial, sans-serif')
    expect(output.background).toBe('rgb(255, 255, 255)')
    expect(output.corner).toEqual([255, 255, 255, 255])
  }
  expect((await observe(page)).snapshot).toEqual(saved)
})
