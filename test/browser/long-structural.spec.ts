import { test, expect, observe, operation } from './fixtures'
import type { Page } from '@playwright/test'
import { generateParagraphs } from '../../playground/generate'

// Loads a note as a host does and waits for it to be drawn.
async function load(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md', 'long'),
    text,
  )
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve)),
      ),
  )
}

// Puts the caret after `label` at the start of a top-level paragraph, or at
// the start or end of that paragraph.
async function caret(page: Page, label: string, at: 'after' | 'start' | 'end') {
  await page.evaluate(
    async ([label, at]) => {
      const paragraph = [...document.querySelectorAll('.ProseMirror > p')].find(
        (p) => p.textContent!.startsWith(label!),
      )
      if (!paragraph) throw Error(`No paragraph starts with ${label}`)
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      const texts: Text[] = []
      while (walker.nextNode()) texts.push(walker.currentNode as Text)
      const range = document.createRange()
      if (at === 'after') range.setStart(texts[0]!, label!.length)
      else if (at === 'start') range.setStart(texts[0]!, 0)
      else range.setStart(texts.at(-1)!, texts.at(-1)!.length)
      range.collapse(true)
      ;(paragraph.closest('[contenteditable="true"]') as HTMLElement).focus()
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      // The editor reads the caret from a selectionchange task.
      await new Promise((resolve) => setTimeout(resolve, 50))
    },
    [label, at] as const,
  )
}

// Milliseconds from the key going down to the frame after it was handled.
async function timed(page: Page, key: string): Promise<number> {
  await page.evaluate(() => {
    const probe = window as unknown as { keyToFrame?: Promise<number> }
    probe.keyToFrame = new Promise((resolve) =>
      document.addEventListener(
        'keydown',
        () => {
          const start = performance.now()
          requestAnimationFrame(() =>
            setTimeout(() => resolve(performance.now() - start)),
          )
        },
        { capture: true, once: true },
      ),
    )
  })
  await page.keyboard.press(key)
  return page.evaluate(
    () => (window as unknown as { keyToFrame: Promise<number> }).keyToFrame,
  )
}

// Pastes plain-text Markdown at the caret, as the clipboard does.
function paste(page: Page, text: string): Promise<void> {
  return page.evaluate((text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    // The caret has put focus in the editor.
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, text)
}

// Pastes through the host's call and returns the milliseconds to the frame
// after the paste is done.
function timedPaste(page: Page, text: string): Promise<number> {
  return page.evaluate(async (text) => {
    const start = performance.now()
    await window.inkkitPlayground.operation('paste', { input: { text } })
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve)),
    )
    return performance.now() - start
  }, text)
}

const pasted = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `Pasted paragraph ${i + 1} with __some__ words.`,
  ).join('\n\n')

test('Enter, Backspace, Delete and paste in a 5,000-paragraph note save exactly @preservation', async ({
  page,
  openFixture,
}) => {
  test.setTimeout(120_000)
  await openFixture()
  const source = generateParagraphs(5000)
  await load(page, source)
  await caret(page, 'Paragraph 2500', 'after')
  await page.keyboard.press('Enter')
  await caret(page, 'Paragraph 2700:', 'end')
  await page.keyboard.press('Enter')
  await page.keyboard.type('New')
  await caret(page, 'Paragraph 2900:', 'start')
  await page.keyboard.press('Backspace')
  await caret(page, 'Paragraph 3110:', 'end')
  await page.keyboard.press('Delete')
  await caret(page, 'Paragraph 3300:', 'end')
  await paste(page, pasted(3))
  await caret(page, 'Paragraph 4000:', 'after')
  await page.keyboard.type(' typed')
  const lines = source.trimEnd().split('\n\n')
  const at = (n: number) =>
    lines.findIndex((line) => line.startsWith(`Paragraph ${n}:`))
  const expected = [...lines]
  expected[at(4000)] = expected[at(4000)]!.replace(
    'Paragraph 4000:',
    'Paragraph 4000: typed',
  )
  expected.splice(
    at(3300),
    1,
    `${lines[at(3300)]}Pasted paragraph 1 with **some** words.`,
    'Pasted paragraph 2 with **some** words.',
    'Pasted paragraph 3 with **some** words.',
  )
  expected[at(3110)] = lines[at(3110)]! + lines[at(3111)]!
  expected.splice(at(3111), 1)
  expected[at(2899)] = lines[at(2899)]! + lines[at(2900)]!
  expected.splice(at(2900), 1)
  expected.splice(at(2700) + 1, 0, 'New')
  expected.splice(
    at(2500),
    1,
    'Paragraph 2500',
    lines[at(2500)]!.slice('Paragraph 2500'.length),
  )
  const saved = expected.join('\n\n') + '\n'
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe(saved)
  await operation(page, 'reload', { text: saved })
  expect((await observe(page)).snapshot?.text).toBe(saved)
  expect((await observe(page)).diagnostics).toEqual([])
})

// Timings vary with the machine, so each is the fastest of several, and each
// is compared with something measured beside it rather than with a fixed
// number of milliseconds.
test('Enter, Backspace, Delete and paste cost what they touch in a long note @preservation', async ({
  page,
  openFixture,
}, testInfo) => {
  test.setTimeout(240_000)
  await openFixture()
  const fastest = (values: number[]) => Math.min(...values)
  for (const size of [500, 5000]) {
    await load(page, generateParagraphs(size))
    const times: Record<string, number[]> = {
      type: [],
      enter: [],
      typeAfter: [],
      backspace: [],
      delete: [],
    }
    // Paragraphs away from headings, which every 50th block is.
    for (let run = 0; run < 5; run++) {
      const n = Math.floor(size / 2) + run * 20 - 40
      await caret(page, `Paragraph ${n + 2}:`, 'after')
      times.type!.push(await timed(page, 'x'))
      await caret(page, `Paragraph ${n + 3}:`, 'end')
      times.enter!.push(await timed(page, 'Enter'))
      await caret(page, `Paragraph ${n + 4}:`, 'after')
      times.typeAfter!.push(await timed(page, 'y'))
      await caret(page, `Paragraph ${n + 6}:`, 'start')
      times.backspace!.push(await timed(page, 'Backspace'))
      await caret(page, `Paragraph ${n + 8}:`, 'end')
      times.delete!.push(await timed(page, 'Delete'))
    }
    const result = Object.fromEntries(
      Object.entries(times).map(([action, values]) => [
        action,
        fastest(values),
      ]),
    )
    testInfo.annotations.push({
      type: `${size} paragraphs, fastest ms`,
      description: JSON.stringify(result),
    })
    // A structural edit costs about what typing a character does in the same
    // note; validating the whole note would cost many times more.
    for (const action of ['enter', 'typeAfter', 'backspace', 'delete'])
      expect(result[action], `${action} at ${size}`).toBeLessThan(
        3 * result.type! + 15,
      )
  }
  // A paste into the long note may cost more than one into the short note only
  // by what the frame costs, not by reading the long note again. Validating the
  // whole note costs about as much as loading it (0.9 to 1.0 times locally, in
  // Chromium and WebKit), against 0.03 times or less for a paste that reads
  // only what it pastes. The ratio of the two pastes is too unsteady to tell
  // them apart: hosted WebKit recorded 227 -> 434 ms, 240 -> 369 ms and
  // 247 -> 586 ms for the same code. So each run times the three things
  // together: a paste into the short note, a load of the long note and a
  // paste into it. A runner that slows down meanwhile slows all three, and
  // the extra cost of the long paste is set against 0.4 times that load, plus
  // 100 ms for the frame. The best run decides.
  const scores: number[] = []
  const timings: Array<Record<string, number>> = []
  for (let run = 0; run < 5; run++) {
    await load(page, generateParagraphs(500))
    await caret(page, 'Paragraph 252:', 'end')
    const short = await timedPaste(page, pasted(500))
    const loadStart = Date.now()
    await load(page, generateParagraphs(5000))
    const loadTime = Date.now() - loadStart
    await caret(page, 'Paragraph 2502:', 'end')
    const long = await timedPaste(page, pasted(500))
    timings.push({ short, load: loadTime, long })
    scores.push(long - short - 0.4 * loadTime)
  }
  testInfo.annotations.push({
    type: 'paste pairs, ms',
    description: JSON.stringify(timings.map((t) => mapValues(t, Math.round))),
  })
  expect(Math.min(...scores)).toBeLessThan(100)
})

function mapValues(
  values: Record<string, number>,
  map: (value: number) => number,
) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, map(value)]),
  )
}
