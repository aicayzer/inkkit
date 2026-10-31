// Measures structural edits in long notes for docs/maintainers/performance.md.
// Run on demand; INKKIT_MEASURE names the results folder (default _local/measure):
//
//   pnpm measure:browser --project=chromium scripts/measure-browser/structural.spec.ts
import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { generateParagraphs } from '../../playground/generate'

const out = process.env.INKKIT_MEASURE ?? '_local/measure'
const runs = Number(process.env.INKKIT_MEASURE_RUNS ?? 5)

test.setTimeout(60 * 60_000)

test('structural edits in long notes', async ({ page, browserName }) => {
  mkdirSync(out, { recursive: true })
  const results: Record<string, Array<Record<string, number>>> = {}
  const open = async (text: string) => {
    await page.goto('/?fixture=everyday&configuration=rich&observe=false')
    await page.waitForFunction(() => window.inkkitPlayground?.observe)
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md', 'measure'),
      text,
    )
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => setTimeout(r))),
    )
  }
  // A caret placed by a DOM selection, as a click places it, rather than by
  // find, which would leave a search running.
  const caret = (
    selector: string,
    label: string,
    at: 'after' | 'start' | 'end',
  ) =>
    page.evaluate(
      async ([selector, label, at]) => {
        const block = [...document.querySelectorAll(selector!)].find((node) =>
          node.textContent!.startsWith(label!),
        )
        if (!block) throw Error(`No block starts with ${label}`)
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
        const texts: Text[] = []
        while (walker.nextNode()) texts.push(walker.currentNode as Text)
        const range = document.createRange()
        if (at === 'after') range.setStart(texts[0]!, label!.length)
        else if (at === 'start') range.setStart(texts[0]!, 0)
        else range.setStart(texts.at(-1)!, texts.at(-1)!.length)
        range.collapse(true)
        ;(block.closest('[contenteditable="true"]') as HTMLElement).focus()
        const selection = window.getSelection()!
        const changed = new Promise<void>((resolve) =>
          document.addEventListener(
            'selectionchange',
            () => queueMicrotask(resolve),
            { once: true },
          ),
        )
        selection.removeAllRanges()
        selection.addRange(range)
        await changed
      },
      [selector, label, at] as const,
    )
  // From the key going down to the frame after it was handled.
  const timed = async (key: string) => {
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
  const save = () =>
    writeFileSync(
      `${out}/structural-${browserName}.json`,
      JSON.stringify(results, null, 1),
    )
  const paragraph = '.ProseMirror > p'
  const pasted = Array.from(
    { length: 500 },
    (_, i) => `Pasted paragraph ${i + 1} with some words to read.`,
  ).join('\n\n')
  for (const size of [500, 5000]) {
    const middle = Math.floor(size / 2)
    // Paragraph numbers spread as at 1,000 paragraphs, which every size has.
    const label = (n: number) =>
      `Paragraph ${middle + Math.round((n - middle) * Math.min(1, size / 1000))}:`
    const list: Array<Record<string, number>> = (results[`${size} paragraphs`] =
      [])
    for (let run = 0; run < runs; run++) {
      await open(generateParagraphs(size))
      const result: Record<string, number> = {}
      await caret(paragraph, label(middle - 93), 'after')
      result['Type a character'] = await timed('x')
      await caret(paragraph, label(middle + 7), 'after')
      result['Enter in the middle of a paragraph'] = await timed('Enter')
      await caret(paragraph, label(middle - 193), 'after')
      result['Type a character after that Enter'] = await timed('y')
      await caret(paragraph, label(middle + 57), 'end')
      result['Enter at the end of a paragraph'] = await timed('Enter')
      await caret(paragraph, label(middle + 207), 'start')
      result['Backspace at the start of a paragraph'] = await timed('Backspace')
      await caret(paragraph, label(middle + 307), 'end')
      result['Delete at the end of a paragraph'] = await timed('Delete')
      await caret(paragraph, label(middle + 407), 'end')
      result['Paste 500 paragraphs'] = await page.evaluate(async (text) => {
        const start = performance.now()
        await window.inkkitPlayground.operation('paste', { input: { text } })
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r)))
        return performance.now() - start
      }, pasted)
      list.push(result)
      save()
    }
  }
  const tasks = 5000
  const list: Array<Record<string, number>> = (results[`${tasks} tasks`] = [])
  for (let run = 0; run < runs; run++) {
    await open(
      Array.from({ length: tasks }, (_, i) => `- [ ] Task ${i + 1} to do`).join(
        '\n',
      ) + '\n',
    )
    const result: Record<string, number> = {}
    const item = '.ProseMirror li p'
    await caret(item, `Task ${tasks / 2 - 100} `, 'end')
    result['Type a character'] = await timed('x')
    await caret(item, `Task ${tasks / 2} `, 'end')
    result['Enter at the end of an item'] = await timed('Enter')
    await caret(item, `Task ${tasks / 2 - 200} `, 'end')
    result['Type a character after that Enter'] = await timed('y')
    list.push(result)
    save()
  }
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
  for (const [document, samples] of Object.entries(results))
    for (const action of Object.keys(samples[0]!))
      console.info(
        `${browserName}, ${document}, ${action}: ${median(samples.map((sample) => sample[action]!)).toFixed(0)} ms`,
      )
})
