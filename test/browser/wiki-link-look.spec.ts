import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// The fixture draws an icon for the target `Pictured` only, in rgb(200, 30, 30).
const source = [
  '# [[Pictured]]',
  '',
  'Before [[Pictured]] and [[Plain]] and [[Missing note]] and [a link](https://example.com).',
  '',
  '| Cell |',
  '| ---- |',
  '| [[Pictured]] |',
  '',
].join('\n')

async function open(
  page: Page,
  openFixture: (fixture: string) => Promise<void>,
  text = source,
  css = '',
) {
  await openFixture('linked-files')
  if (css) await page.addStyleTag({ content: css })
  await operation(page, 'reload', { text })
  await expect(page.locator('.inkkit-wiki-link').first()).toBeVisible()
}

const look = (page: Page, name: string) =>
  page
    .getByRole('link', { name, exact: true })
    .first()
    .evaluate((link) => {
      const style = getComputedStyle(link)
      const icon = link.querySelector('.inkkit-wiki-link-icon')
      const drawn = icon && getComputedStyle(icon)
      return {
        color: style.color,
        line: style.textDecorationLine,
        lineStyle: style.textDecorationStyle,
        thickness: style.textDecorationThickness,
        offset: style.textUnderlineOffset,
        font: Number.parseFloat(style.fontSize),
        icon: icon
          ? {
              hidden: icon.getAttribute('aria-hidden'),
              text: icon.textContent,
              width: icon.getBoundingClientRect().width,
              colour: drawn!.backgroundColor,
              mask: drawn!.maskImage || drawn!.webkitMaskImage,
              display: drawn!.display,
              select: drawn!.userSelect,
            }
          : null,
      }
    })

test('the default look is unchanged, and an icon is a masked square before the text @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const pictured = await look(page, 'Pictured')
  const plain = await look(page, 'Plain')
  const missing = await look(page, 'Missing note')
  const ordinary = await look(page, 'a link')
  expect(plain.icon).toBeNull()
  expect(missing.icon).toBeNull()
  for (const link of [pictured, plain, missing]) {
    expect(link.color).toBe(ordinary.color)
    expect(link.offset).toBe('2px')
  }
  expect(plain.line).toBe('none')
  expect(pictured.line).toBe('none')
  expect(missing).toMatchObject({ line: 'underline', lineStyle: 'dashed' })
  expect(pictured.icon).toMatchObject({
    hidden: 'true',
    text: '',
    colour: 'rgb(200, 30, 30)',
    display: 'inline',
    select: 'none',
  })
  expect(pictured.icon!.mask).toContain('data:image/svg+xml')
  // 0.9em for the picture and 0.3em before the text.
  expect(pictured.icon!.width).toBeCloseTo(pictured.font * 1.2, 0)
  // The icon is not part of the link's name or text.
  await expect(
    page.getByRole('link', { name: 'Pictured', exact: true }),
  ).toHaveCount(3)
  expect((await observe(page)).snapshot!.text).toBe(source)
  // Hovering underlines it as before.
  const hovered = page
    .locator('.ProseMirror > p .inkkit-wiki-link')
    .filter({ hasText: 'Pictured' })
  await hovered.hover()
  expect((await look(page, 'Plain')).line).toBe('none')
  await expect
    .poll(() =>
      hovered.evaluate((link) => getComputedStyle(link).textDecorationLine),
    )
    .toBe('underline')
})

test('a host sets the look through variables, and can hide the icon @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(
    page,
    openFixture,
    source,
    `.inkkit-root {
      --inkkit-wiki-link-color: rgb(10, 120, 60);
      --inkkit-wiki-link-underline: underline;
      --inkkit-wiki-link-underline-thickness: 3px;
      --inkkit-wiki-link-underline-offset: 5px;
      --inkkit-wiki-link-hover-color: rgb(120, 10, 60);
      --inkkit-wiki-link-hover-underline: none;
      --inkkit-wiki-link-icon-size: 20px;
      --inkkit-wiki-link-icon-gap: 4px;
    }`,
  )
  const pictured = await look(page, 'Pictured')
  expect(pictured).toMatchObject({
    color: 'rgb(10, 120, 60)',
    line: 'underline',
    lineStyle: 'solid',
    thickness: '3px',
    offset: '5px',
  })
  expect(pictured.icon!.width).toBeCloseTo(24, 0)
  // A missing link keeps its dashed line, and takes the thickness too.
  expect(await look(page, 'Missing note')).toMatchObject({
    line: 'underline',
    lineStyle: 'dashed',
    thickness: '3px',
  })
  const link = page
    .locator('.ProseMirror > p .inkkit-wiki-link')
    .filter({ hasText: 'Plain' })
  await link.hover()
  await expect.poll(async () => (await look(page, 'Plain')).line).toBe('none')
  expect((await look(page, 'Plain')).color).toBe('rgb(120, 10, 60)')
  await page.mouse.move(0, 0)
  await page.addStyleTag({
    content: '.inkkit-root { --inkkit-wiki-link-icon-display: none }',
  })
  const hidden = await look(page, 'Pictured')
  expect(hidden.icon).toMatchObject({ display: 'none', width: 0 })
  expect(hidden.line).toBe('underline')
})

test('the icon stays on the first line of its first word, however the text wraps @linked-files', async ({
  page,
  openFixture,
}) => {
  const alias = 'Pictured|Weekend itinerary notes for the long trip home again'
  const css = '.inkkit-root { --inkkit-reading-width: 300px }'
  for (const filler of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const words = Array.from({ length: filler }, () => 'word').join(' ')
    await open(page, openFixture, `${words} [[${alias}]] end\n`, css)
    const placed = await page.locator('.inkkit-wiki-link').evaluate((link) => {
      const icon = link
        .querySelector('.inkkit-wiki-link-icon')!
        .getBoundingClientRect()
      const text = link.lastChild as Text
      const first = document.createRange()
      first.setStart(text, 0)
      first.setEnd(text, 3)
      const word = first.getBoundingClientRect()
      const all = document.createRange()
      all.selectNodeContents(text)
      return {
        iconTop: icon.top,
        iconRight: icon.right,
        wordTop: word.top,
        wordLeft: word.left,
        lines: new Set([...all.getClientRects()].map((r) => Math.round(r.top)))
          .size,
      }
    })
    expect(placed.lines, `filler ${filler}`).toBeGreaterThan(1)
    expect(
      Math.abs(placed.iconTop - placed.wordTop),
      `filler ${filler}`,
    ).toBeLessThan(8)
    expect(
      Math.abs(placed.iconRight - placed.wordLeft),
      `filler ${filler}`,
    ).toBeLessThan(1)
  }
})

test('the icon takes no caret step and leaves the drawn selection as it was @linked-files', async ({
  page,
  openFixture,
}) => {
  const walk = async (target: string) => {
    await open(page, openFixture, `Go [[${target}|Same label]] on.\n`)
    const readable = (await operation(page, 'textSnapshot')) as {
      snapshotId: string
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from: 0, to: 0 },
      options: { focus: true },
    })
    const at = async () => {
      const { from, to } = (await observe(page)).textSnapshot!.selection
      return `${from}-${to}`
    }
    await expect.poll(at).toBe('0-0')
    const stops: string[] = []
    for (let step = 0; step < 5; step++) {
      const before = stops.at(-1) ?? '0-0'
      await page.keyboard.press('ArrowRight')
      await expect.poll(at).not.toBe(before)
      stops.push(await at())
    }
    await operation(page, 'selectTextRange', {
      range: { snapshotId: readable.snapshotId, from: 0, to: 0 },
      options: { focus: true },
    })
    // Extends over the text, the link and the text after it, to the end of the line.
    for (let step = 0; step < 9; step++)
      await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(at).toBe('0-17')
    const bars = () =>
      page.evaluate(() =>
        [
          ...(document.querySelector('.inkkit-root .inkkit-selection-layer')
            ?.children ?? []),
        ].map((bar) => bar.getBoundingClientRect().width),
      )
    await expect.poll(async () => (await bars()).length).toBeGreaterThan(0)
    const widths = await bars()
    return { stops, count: widths.length, bar: widths.reduce((a, b) => a + b) }
  }
  const plain = await walk('Plain')
  const pictured = await walk('Pictured')
  expect(pictured.stops).toEqual(plain.stops)
  expect(new Set(pictured.stops).size).toBeGreaterThan(3)
  expect(pictured.count).toBe(plain.count)
  // The icon adds no text for the selection to draw, so the bars are those of a link without one.
  expect(pictured.bar).toBeCloseTo(plain.bar, 1)
  expect((await observe(page)).snapshot!.text).toBe(
    'Go [[Pictured|Same label]] on.\n',
  )
})

test('print and the pointer cue leave the icon alone @linked-files', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await page.emulateMedia({ media: 'print' })
  expect((await look(page, 'Pictured')).icon).toMatchObject({
    display: 'none',
    width: 0,
  })
  await page.emulateMedia({ media: 'screen' })
  // Held Mod makes links open on click, and the icon shows the same pointer.
  await page.evaluate(() =>
    document
      .querySelector('.inkkit-root')!
      .classList.add('inkkit-link-modifier'),
  )
  const cursors = await page
    .locator('.ProseMirror > p .inkkit-wiki-link')
    .filter({ hasText: 'Pictured' })
    .evaluate((link) => [
      getComputedStyle(link).cursor,
      getComputedStyle(link.querySelector('.inkkit-wiki-link-icon')!).cursor,
    ])
  expect(cursors).toEqual(['pointer', 'pointer'])
  // The focus ring surrounds the icon with the text.
  await page
    .locator('.ProseMirror > p .inkkit-wiki-link')
    .filter({ hasText: 'Pictured' })
    .focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const ring = await page.evaluate(() => {
    const link = document.activeElement as HTMLElement
    return {
      focused: link.classList.contains('inkkit-wiki-link'),
      style: getComputedStyle(link).outlineStyle,
      width: getComputedStyle(link).outlineWidth,
    }
  })
  expect(ring).toMatchObject({ focused: true, style: 'solid', width: '2px' })
})
