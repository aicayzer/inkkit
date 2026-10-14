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
async function caretInView(page: Page) {
  return page.evaluate(() => {
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
    mirror.append(
      document.createTextNode(area.value.slice(0, area.selectionStart)),
    )
    const caret = document.createElement('span')
    caret.textContent = area.value.slice(area.selectionStart) || '​'
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
  })
}

// A scroll position is a whole number of pixels, so a line height that is not
// one leaves a fraction of the caret's line to round away. These cover many
// fractions.
const metrics = Array.from({ length: 24 }, (_, index) => ({
  size: 13,
  lineHeight: `${(16.5 + index * 0.0625).toFixed(4)}px`,
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
    await page.addStyleTag({
      content: `textarea.inkkit-plain { font-size: ${size}px; line-height: ${lineHeight}; }`,
    })
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
