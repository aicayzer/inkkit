import { test, expect, observe, operation } from './fixtures'
import type { Page } from '@playwright/test'

const intro = 'Intro line\n\n'
const cases = [
  {
    name: 'table',
    source: `${intro}| A | B |\n| - | - |\n| 1 | 2 |\n`,
    reach: async (page: Page) => {
      const rect = (await page.locator('.ProseMirror table').boundingBox())!
      await page.mouse.click(rect.x + 2, rect.y + rect.height + 12)
    },
  },
  {
    name: 'image',
    source: `${intro}![Example](asset:example)\n`,
    // A loaded document that ends in an image already holds the gap cursor.
    reach: async (page: Page) => operation(page, 'focus'),
  },
  {
    name: 'callout',
    source: `${intro}> [!note]\n> Body\n`,
    reach: async (page: Page) => {
      await page
        .locator('.ProseMirror blockquote p', { hasText: 'Body' })
        .click()
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowDown')
    },
  },
  {
    name: 'divider',
    source: `${intro}---\n`,
    reach: async (page: Page) => {
      await operation(page, 'focus')
      await page.keyboard.press('ControlOrMeta+ArrowDown')
      await page.keyboard.press('ArrowDown')
    },
  },
  {
    // A fence at the top level holds a text caret, not a gap; one inside a callout is
    // followed by the callout's gap.
    name: 'callout with a fence',
    source: `${intro}> [!note]\n> \`\`\`js\n> const a = 1\n> \`\`\`\n`,
    reach: async (page: Page) => {
      await operation(page, 'focus')
      await page.keyboard.press('ControlOrMeta+ArrowDown')
      await page.keyboard.press('ArrowDown')
    },
  },
]

for (const { name, source, reach } of cases) {
  test(`a gap cursor after a final ${name} is a vertical caret one line tall`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await openFixture()
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      source,
    )
    await reach(page)
    const cursor = page.locator('.ProseMirror-gapcursor')
    await expect(cursor).toHaveCount(1)
    await expect(cursor).toHaveCSS('display', 'block')
    const line = await page
      .locator('.ProseMirror p')
      .first()
      .evaluate((p) => p.getBoundingClientRect().height)
    const caret = await cursor.evaluate((node) => {
      const style = getComputedStyle(node, '::after')
      return {
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        colour: style.backgroundColor,
        animation: style.animationName,
        border: style.borderTopWidth,
      }
    })
    expect(caret).toMatchObject({
      colour: 'rgb(10, 132, 255)',
      animation: 'inkkit-gapcursor-blink',
      border: '0px',
    })
    expect(caret.width).toBeGreaterThanOrEqual(1.5)
    expect(caret.width).toBeLessThanOrEqual(2)
    expect(Math.abs(caret.height - line)).toBeLessThanOrEqual(1.5)

    // Where it is drawn: measured on screen, with the blink paused on its visible half.
    await page.addStyleTag({
      content: '.ProseMirror-gapcursor::after { animation: none !important }',
    })
    await cursor.evaluate((node) =>
      node.scrollIntoView({ block: 'center', behavior: 'instant' }),
    )
    // ProseMirror scrolls the selection into view a moment later. The whole viewport is
    // captured, so its pixels and the cursor's rectangle share one origin; keep a capture
    // only if the cursor stood still while it was taken.
    const place = () =>
      cursor.evaluate((node) => {
        const { x, y } = node.getBoundingClientRect()
        return { x, y }
      })
    let origin = await place()
    let screenshot: Awaited<ReturnType<typeof page.screenshot>> | undefined
    await expect
      .poll(async () => {
        origin = await place()
        screenshot = await page.screenshot({
          path: `_local/gap-cursor-${name.replaceAll(' ', '-')}-${testInfo.project.name}.png`,
        })
        const after = await place()
        return after.x === origin.x && after.y === origin.y
      })
      .toBe(true)
    const drawn = await page.evaluate(
      async ({ origin, line, png }) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${png}`)).blob(),
        )
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        const scale = bitmap.width / innerWidth
        // The accent also draws the focus ring, so look only beside the cursor.
        const region = {
          x: Math.floor((origin.x - 4) * scale),
          y: Math.floor((origin.y - 4) * scale),
          width: Math.ceil(12 * scale),
          height: Math.ceil((line + 8) * scale),
        }
        const { data, width, height } = context.getImageData(
          region.x,
          region.y,
          region.width,
          region.height,
        )
        const box = {
          left: Infinity,
          right: -Infinity,
          top: Infinity,
          bottom: -Infinity,
        }
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            const accent =
              Math.abs(data[i]! - 10) < 40 &&
              Math.abs(data[i + 1]! - 132) < 40 &&
              data[i + 2]! > 200
            if (!accent) continue
            box.left = Math.min(box.left, x)
            box.right = Math.max(box.right, x + 1)
            box.top = Math.min(box.top, y)
            box.bottom = Math.max(box.bottom, y + 1)
          }
        return {
          width: (box.right - box.left) / scale,
          height: (box.bottom - box.top) / scale,
          top: (region.y + box.top) / scale,
        }
      },
      { origin, line, png: screenshot!.toString('base64') },
    )
    testInfo.annotations.push({
      type: 'drawn',
      description: JSON.stringify({ origin, drawn, line }),
    })
    // It sits where the next paragraph would start: below the previous block's margin.
    const above = await cursor.evaluate((node) => {
      const previous = node.previousElementSibling!
      return {
        bottom: previous.getBoundingClientRect().bottom,
        margin: parseFloat(getComputedStyle(previous).marginBottom),
      }
    })
    expect(
      Math.abs(drawn.top - above.bottom - above.margin),
    ).toBeLessThanOrEqual(3)
    expect(drawn.width).toBeGreaterThanOrEqual(1.5)
    expect(drawn.width).toBeLessThanOrEqual(3)
    expect(Math.abs(drawn.height - line)).toBeLessThanOrEqual(2)

    // Typing there starts a paragraph and leaves the bytes before it alone.
    await page.keyboard.type('X')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(`${source.replace(/\n+$/, '')}\n\nX\n`)
  })
}
