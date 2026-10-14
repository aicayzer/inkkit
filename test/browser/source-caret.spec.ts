import type { Page } from '@playwright/test'
import { test, expect, operation } from './fixtures'

const distant =
  '# Start\n\n' +
  Array.from(
    { length: 250 },
    (_, index) =>
      `Line ${index}${index % 7 === 0 ? ' wrapped'.repeat(50) : ''}\n\n`,
  ).join('') +
  '## Distant\n'

// Textareas expose no caret geometry, so the caret is measured in a hidden
// copy of the text, as the native consumer does.
async function caretInView(page: Page, offset?: number) {
  return page.evaluate((offset) => {
    const target = document.querySelector('textarea.inkkit-plain')!
    const area = target as HTMLTextAreaElement
    const style = getComputedStyle(area)
    const mirror = document.createElement('div')
    for (const property of [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'tab-size',
      'padding',
      'box-sizing',
    ])
      mirror.style.setProperty(property, style.getPropertyValue(property))
    Object.assign(mirror.style, {
      position: 'absolute',
      visibility: 'hidden',
      left: '-10000px',
      top: '0',
      width: `${area.clientWidth}px`,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    })
    const at = offset ?? area.selectionStart
    mirror.append(document.createTextNode(area.value.slice(0, at)))
    const caret = document.createElement('span')
    caret.textContent = area.value.slice(at) || '​'
    mirror.append(caret)
    document.body.append(mirror)
    try {
      const rect = caret.getClientRects()[0] ?? caret.getBoundingClientRect()
      const top = rect.top - mirror.getBoundingClientRect().top
      return {
        top,
        bottom: top + rect.height,
        scrollTop: area.scrollTop,
        clientHeight: area.clientHeight,
      }
    } finally {
      mirror.remove()
    }
  }, offset)
}

// The stylesheet's own rule for the textarea outranks a plain selector, so the
// metrics are set through the properties it reads. The check is that they took.
async function setMetrics(page: Page, size: number, lineHeight: string) {
  await page.evaluate(
    ({ size, lineHeight }) => {
      const style = document.documentElement.style
      style.setProperty('--inkkit-font-size', `${size}px`)
      style.setProperty('--inkkit-line-height', lineHeight)
    },
    { size, lineHeight },
  )
  expect(
    await page.evaluate(() => {
      const style = getComputedStyle(
        document.querySelector('textarea.inkkit-plain')!,
      )
      return `${style.fontSize}/${style.lineHeight}`
    }),
  ).toBe(`${size}px/${lineHeight}`)
}

// A scroll position is a whole number of pixels, so a line height that is not
// one leaves a fraction of the caret's line to round away. These cover many
// fractions.
const metrics = Array.from({ length: 24 }, (_, index) => ({
  size: 13,
  lineHeight: `${16.5 + index * 0.0625}px`,
}))

test('the caret is fully in view after navigating to a distant heading in source mode', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    distant,
  )
  await operation(page, 'editingMode', { mode: 'source' })
  const headings = (await operation(page, 'headings')) as { value: unknown[] }
  const outline = (headings.value ?? headings) as unknown[]
  expect(outline).toHaveLength(2)
  const failures: string[] = []
  for (const { size, lineHeight } of metrics) {
    await setMetrics(page, size, lineHeight)
    for (const heading of [outline[0], outline[1]]) {
      await operation(page, 'navigateHeading', { heading })
      const caret = await caretInView(page)
      if (heading === outline[0] && caret.scrollTop !== 0)
        failures.push(`${lineHeight}: start of the document is not shown`)
      if (
        caret.top < caret.scrollTop ||
        caret.bottom > caret.scrollTop + caret.clientHeight
      )
        failures.push(
          `${size}px/${lineHeight}: caret ${caret.top}-${caret.bottom} outside ${caret.scrollTop}-${caret.scrollTop + caret.clientHeight}`,
        )
    }
  }
  expect(failures).toEqual([])
})

const sections = Array.from(
  { length: 25 },
  (_, section) =>
    `# Heading ${section}\n\n` +
    Array.from(
      { length: 9 + (section % 5) },
      (_, line) =>
        `Line ${section}.${line}${line % 4 === 0 ? ' wrapped'.repeat(30) : ''}\n\n`,
    ).join(''),
).join('')

// Which headings land on a fraction depends on the line height, so the two
// ends of the document alone can miss the rounding. These visit headings
// across the document, both down and up, at line heights that are not whole.
test('the caret is fully in view after navigating down and up between headings in source mode', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    sections,
  )
  await operation(page, 'editingMode', { mode: 'source' })
  const headings = (await operation(page, 'headings')) as { value: unknown[] }
  const outline = (headings.value ?? headings) as unknown[]
  expect(outline).toHaveLength(25)
  const failures: string[] = []
  for (const lineHeight of ['16.5px', '17.5px', '17.67px', '22.5px']) {
    await setMetrics(page, 12, lineHeight)
    for (const index of [0, 24, 12, 13, 11, 3, 23, 1, 2, 18, 10, 24, 0]) {
      await operation(page, 'navigateHeading', { heading: outline[index] })
      const caret = await caretInView(page)
      if (
        caret.top < caret.scrollTop ||
        caret.bottom > caret.scrollTop + caret.clientHeight
      )
        failures.push(
          `${lineHeight}, heading ${index}: caret ${caret.top}-${caret.bottom} outside ${caret.scrollTop}-${caret.scrollTop + caret.clientHeight}`,
        )
    }
  }
  expect(failures).toEqual([])
})

// The reveal in the formatted editor scrolls its containers and the window
// by the same whole pixels, so the selected heading must end inside the
// viewport the editor reports, at line heights that are not whole.
test('the heading is fully in view after navigating down and up between headings in formatted mode', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    sections,
  )
  const headings = (await operation(page, 'headings')) as { value: unknown[] }
  const outline = (headings.value ?? headings) as unknown[]
  expect(outline).toHaveLength(25)
  const failures: string[] = []
  for (const lineHeight of ['1.37', '1.43', '1.51', '1.6']) {
    await page.evaluate((lineHeight) => {
      const style = document.documentElement.style
      style.setProperty('--inkkit-font-size', '13.3px')
      style.setProperty('--inkkit-line-height', lineHeight)
    }, lineHeight)
    for (const index of [0, 24, 12, 13, 11, 3, 23, 1, 2, 18, 10, 24, 0]) {
      await operation(page, 'navigateHeading', { heading: outline[index] })
      const measured = await page.evaluate(() => {
        const selection = getSelection()!
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        const viewport = window.inkkitPlayground.observe().viewport!.rect
        return { top: rect.top, bottom: rect.bottom, viewport }
      })
      if (
        measured.top < measured.viewport.top ||
        measured.bottom > measured.viewport.bottom
      )
        failures.push(
          `${lineHeight}, heading ${index}: ${measured.top}-${measured.bottom} outside ${measured.viewport.top}-${measured.viewport.bottom}`,
        )
    }
  }
  expect(failures).toEqual([])
})

// A range of several lines near the end of the document must not be treated as
// one line at the bottom edge: showing the padding there would hide its start.
test('the start of a tall range stays in view when it is revealed near the end of the source', async ({
  page,
  openFixture,
}) => {
  // The whole textarea is on screen, so the editor's viewport is its own box.
  await page.setViewportSize({ width: 1280, height: 1400 })
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    sections,
  )
  await operation(page, 'editingMode', { mode: 'source' })
  const failures: string[] = []
  let tested = 0
  for (const lineHeight of ['16.5px', '17.67px', '19.25px', '22.5px']) {
    await setMetrics(page, 12, lineHeight)
    const snapshot = (await operation(page, 'textSnapshot')) as {
      value?: { snapshotId: string; text: string }
      snapshotId?: string
      text?: string
    }
    const { snapshotId, text } = (snapshot.value ?? snapshot) as {
      snapshotId: string
      text: string
    }
    const end = await caretInView(page, text.length)
    // Line starts in the last stretch of the document.
    const starts: number[] = []
    for (
      let at = text.lastIndexOf('\n', text.length - 2);
      starts.length < 80 && at > 0;
      at = text.lastIndexOf('\n', at - 1)
    )
      starts.push(at + 1)
    const tops = new Map<number, number>()
    for (const at of starts) tops.set(at, (await caretInView(page, at)).top)
    // The range ends a few lines above the end of the document, so only its
    // last lines are near the bottom edge.
    const to = starts.find((at) => {
      const distance = end.bottom - tops.get(at)!
      return distance >= 36 && distance <= 70
    })
    if (to === undefined) continue
    for (const from of starts) {
      const distance = end.bottom - tops.get(from)!
      // Fits the viewport, but not together with the padding below the last
      // line, so scrolling to the bottom edge would hide its start.
      if (distance > end.clientHeight - 8 || distance < end.clientHeight - 40)
        continue
      tested++
      await page.evaluate(() => {
        document.querySelector('textarea.inkkit-plain')!.scrollTop = 0
      })
      await operation(page, 'revealTextRange', {
        range: { snapshotId, from, to },
      })
      const start = await caretInView(page, from)
      if (
        start.top < start.scrollTop ||
        start.bottom > start.scrollTop + start.clientHeight
      )
        failures.push(
          `${lineHeight}, offset ${from}: start ${start.top}-${start.bottom} outside ${start.scrollTop}-${start.scrollTop + start.clientHeight}`,
        )
    }
  }
  expect(tested).toBeGreaterThan(0)
  expect(failures).toEqual([])
})
