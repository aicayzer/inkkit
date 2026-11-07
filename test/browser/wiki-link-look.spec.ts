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
      // The icon is generated content before the first character of the lead element.
      const lead = link.querySelector('.inkkit-wiki-link-lead')
      const drawn = lead && getComputedStyle(lead, '::before')
      const first = lead && document.createRange()
      first?.selectNodeContents(lead!.firstChild!)
      return {
        color: style.color,
        line: style.textDecorationLine,
        lineStyle: style.textDecorationStyle,
        thickness: style.textDecorationThickness,
        offset: style.textUnderlineOffset,
        font: Number.parseFloat(style.fontSize),
        icon: lead
          ? {
              text: lead.textContent,
              width: Number.parseFloat(drawn!.width),
              height: Number.parseFloat(drawn!.height),
              // From the link's edge to its first character: the icon and the gap.
              advance:
                first!.getClientRects()[0]!.left -
                lead.getBoundingClientRect().left,
              colour: drawn!.backgroundColor,
              mask: drawn!.maskImage || drawn!.webkitMaskImage,
              display: drawn!.display,
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
    // The first character sits in the element that draws the icon.
    text: 'P',
    colour: 'rgb(200, 30, 30)',
    display: 'inline-block',
  })
  expect(pictured.icon!.mask).toContain('data:image/svg+xml')
  // The picture is 0.9em square, with 0.3em before the text.
  expect(pictured.icon!.width).toBeCloseTo(pictured.font * 0.9, 0)
  expect(pictured.icon!.height).toBeCloseTo(pictured.font * 0.9, 0)
  expect(pictured.icon!.advance).toBeCloseTo(pictured.font * 1.2, 0)
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
  expect(pictured.icon!.width).toBeCloseTo(20, 0)
  expect(pictured.icon!.advance).toBeCloseTo(24, 0)
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
  expect(hidden.icon).toMatchObject({ display: 'none' })
  expect(hidden.icon!.advance).toBeCloseTo(0, 0)
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
      const lead = link.querySelector('.inkkit-wiki-link-lead')!
      const rest = lead.nextSibling as Text
      const range = (node: Node, from: number, to: number) => {
        const r = document.createRange()
        r.setStart(node, from)
        r.setEnd(node, to)
        return r.getBoundingClientRect()
      }
      const first = range(lead.firstChild!, 0, 1)
      const second = range(rest, 0, 1)
      const all = document.createRange()
      all.selectNodeContents(link)
      return {
        // One box means the icon and the first character are on one line.
        leadBoxes: lead.getClientRects().length,
        iconToCharacter: first.left - lead.getBoundingClientRect().left,
        firstTop: first.top,
        secondTop: second.top,
        wordText: lead.textContent! + rest.data.split(' ')[0],
        lines: new Set([...all.getClientRects()].map((r) => Math.round(r.top)))
          .size,
      }
    })
    const font = await page
      .locator('.inkkit-wiki-link')
      .evaluate((link) => Number.parseFloat(getComputedStyle(link).fontSize))
    expect(placed.wordText, `filler ${filler}`).toBe('Weekend')
    expect(placed.lines, `filler ${filler}`).toBeGreaterThan(1)
    expect(placed.leadBoxes, `filler ${filler}`).toBe(1)
    expect(placed.iconToCharacter, `filler ${filler}`).toBeCloseTo(
      font * 1.2,
      0,
    )
    // The word is not split after its first character.
    expect(
      Math.abs(placed.firstTop - placed.secondTop),
      `filler ${filler}`,
    ).toBeLessThan(2)
  }
})

test('the icon paints its shape, not the box it is drawn in @linked-files', async ({
  page,
  openFixture,
}) => {
  // The fixture's icon is a square at the middle of its box, half its width and height. An engine
  // that ignores the mask paints the whole box, and WebKit does that for an inline element.
  await open(
    page,
    openFixture,
    'Go [[Pictured]] on.\n',
    `.inkkit-root {
      --inkkit-wiki-link-icon-size: 40px;
      --inkkit-wiki-link-icon-gap: 20px;
    }`,
  )
  const lead = page.locator('.inkkit-wiki-link-lead')
  await lead.scrollIntoViewIfNeeded()
  const box = (await lead.boundingBox())!
  const clip = {
    x: Math.floor(box.x) - 4,
    y: Math.floor(box.y) - 20,
    width: 100,
    height: Math.ceil(box.height) + 40,
  }
  const shot = await page.screenshot({ clip, scale: 'css' })
  const painted = await page.evaluate(
    async ([base64, width, height]) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${base64}`)).blob(),
      )
      const canvas = document.createElement('canvas')
      canvas.width = width as number
      canvas.height = height as number
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let [left, top, right, bottom] = [Infinity, Infinity, -1, -1]
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const at = (y * canvas.width + x) * 4
          if (data[at]! > 150 && data[at + 1]! < 90 && data[at + 2]! < 90) {
            left = Math.min(left, x)
            top = Math.min(top, y)
            right = Math.max(right, x + 1)
            bottom = Math.max(bottom, y + 1)
          }
        }
      return { left, top, right, bottom }
    },
    [shot.toString('base64'), clip.width, clip.height] as const,
  )
  // The square is 20px, 10px inside the 40px box, and nothing is painted in the gap after it.
  expect(painted.right - painted.left).toBeGreaterThanOrEqual(19)
  expect(painted.right - painted.left).toBeLessThanOrEqual(21)
  expect(painted.bottom - painted.top).toBeGreaterThanOrEqual(19)
  expect(painted.bottom - painted.top).toBeLessThanOrEqual(21)
  expect(painted.left - (box.x - clip.x)).toBeGreaterThanOrEqual(9)
  expect(painted.left - (box.x - clip.x)).toBeLessThanOrEqual(11)
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
  const printed = (await look(page, 'Pictured')).icon
  expect(printed).toMatchObject({ display: 'none' })
  expect(printed!.advance).toBeCloseTo(0, 0)
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
      getComputedStyle(
        link.querySelector('.inkkit-wiki-link-lead')!,
        '::before',
      ).cursor,
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
