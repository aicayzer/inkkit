import { test, expect, operation } from './fixtures'
import type { Page } from '@playwright/test'

const paragraph =
  'It recently came to my attention that a site of mine did not have the right stuff in place for agents. Can you look at my companies-house.uk website and ensure that it does have the right stuff in place? Also, can you make the other address redirect to it?'

interface Line {
  top: number
  bottom: number
  left: number
  right: number
}

async function open(
  page: Page,
  openFixture: (fixture?: string, query?: string) => Promise<void>,
  query = '',
  source = `${paragraph}\n\nAfter.\n`,
) {
  await openFixture('everyday', query)
  await page.addStyleTag({
    content:
      '.inkkit-root { --inkkit-line-height: 1.55; --inkkit-reading-width: 360px }',
  })
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  // Room for the whole editor, so the page never scrolls and the measured lines stay put.
  await page.setViewportSize({ width: 1280, height: 1400 })
  await page
    .locator('.inkkit-root .ProseMirror')
    .evaluate((node) =>
      node.scrollIntoView({ block: 'center', behavior: 'instant' }),
    )
}

const lines = (page: Page, selector = '.inkkit-root .ProseMirror p') =>
  page
    .locator(selector)
    .first()
    .evaluate((block): Line[] => {
      const out: Line[] = []
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        for (let i = 0; i < text.length; i++) {
          range.setStart(text, i)
          range.setEnd(text, i + 1)
          const rect = [...range.getClientRects()].find((r) => r.width > 0)
          if (!rect) continue
          const line = out.find((l) => Math.abs(l.top - rect.top) < 2)
          if (line) {
            line.left = Math.min(line.left, rect.left)
            line.right = Math.max(line.right, rect.right)
          } else out.push({ ...rect.toJSON() })
        }
      }
      return out
    })

const drawn = (page: Page) =>
  page.evaluate(() => {
    const layer = document.querySelector('.inkkit-root .inkkit-selection-layer')
    const highlight = CSS.highlights?.get('inkkit-selection')
    return {
      layer: !!layer,
      bars: [...(layer?.children ?? [])].map((bar) => {
        const rect = bar.getBoundingClientRect()
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          colour: getComputedStyle(bar).backgroundColor,
        }
      }),
      highlighted: highlight ? highlight.size : 0,
    }
  })

const lineHeight = (page: Page) =>
  page
    .locator('.inkkit-root .ProseMirror p')
    .first()
    .evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight))

const middle = (line: Line) => ({
  x: (line.left + line.right) / 2,
  y: (line.top + line.bottom) / 2,
})

async function selectAcross(page: Page, from: Line, to: Line) {
  const start = middle(from)
  const end = middle(to)
  await page.mouse.click(start.x, start.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(end.x, end.y)
  await page.keyboard.up('Shift')
}

test('a selection over wrapped lines is one bar per line, centred on its text', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const wrapped = await lines(page)
  expect(wrapped.length).toBeGreaterThanOrEqual(3)
  const height = await lineHeight(page)
  await selectAcross(page, wrapped[0]!, wrapped[2]!)
  await expect.poll(async () => (await drawn(page)).bars.length).toBe(3)
  const result = await drawn(page)
  expect(result.highlighted).toBe(0)
  for (const [index, bar] of result.bars.entries()) {
    const line = wrapped[index]!
    // As tall as the line, with the spare line height split above and below the text.
    expect(Math.abs(bar.bottom - bar.top - height)).toBeLessThanOrEqual(1)
    expect(
      Math.abs((bar.top + bar.bottom) / 2 - (line.top + line.bottom) / 2),
    ).toBeLessThanOrEqual(1)
  }
  // The bars of consecutive lines meet, with no gap and no overlap.
  expect(Math.abs(result.bars[1]!.top - result.bars[0]!.bottom)).toBeLessThan(1)
  expect(Math.abs(result.bars[2]!.top - result.bars[1]!.bottom)).toBeLessThan(1)
  // Whole lines in the middle run edge to edge; the ends stop at the selection.
  expect(Math.abs(result.bars[1]!.left - wrapped[1]!.left)).toBeLessThan(1)
  expect(result.bars[0]!.left).toBeGreaterThan(wrapped[0]!.left + 10)

  // The inactive colour after the editor loses focus, and nothing once collapsed.
  const active = result.bars[0]!.colour
  expect(result.bars.every((bar) => bar.colour === active)).toBe(true)
  await operation(page, 'blur')
  await expect
    .poll(async () => (await drawn(page)).bars[0]?.colour)
    .not.toBe(active)
  await page.mouse.click(middle(wrapped[1]!).x, middle(wrapped[1]!).y)
  await expect.poll(async () => (await drawn(page)).bars.length).toBe(0)
})

test('text behind an opaque background keeps the engine highlight', async ({
  page,
  openFixture,
}) => {
  await open(
    page,
    openFixture,
    '',
    'Before.\n\n```\nconst code = "selected text in a code block"\n```\n',
  )
  await page.addStyleTag({
    content: '.inkkit-root { --inkkit-code-background: rgb(240, 240, 240) }',
  })
  // Select the code text through the DOM; the editor reads the selection back.
  await page.locator('.inkkit-root .ProseMirror pre code').evaluate((code) => {
    // The code controls' labels sit in the same element but aren't editable text.
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('[contenteditable="false"]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    })
    const first = walker.nextNode()!
    let last = first
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      last = node
    ;(code.closest('[contenteditable="true"]') as HTMLElement).focus()
    getSelection()!.setBaseAndExtent(first, 0, last, last.textContent!.length)
  })
  await expect
    .poll(async () => (await drawn(page)).highlighted)
    .toBeGreaterThan(0)
  expect((await drawn(page)).bars).toEqual([])
})

test('rendering.drawnSelection false keeps the engine highlight', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture, '&drawnSelection=false')
  const wrapped = await lines(page)
  await selectAcross(page, wrapped[0]!, wrapped[2]!)
  await expect.poll(async () => (await drawn(page)).highlighted).toBe(1)
  expect((await drawn(page)).layer).toBe(false)
})
