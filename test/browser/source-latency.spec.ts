import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const output = process.env.INKKIT_MEASURE
const runs = Number(process.env.INKKIT_MEASURE_RUNS ?? 3)
test.skip(!output, 'Set INKKIT_MEASURE to record source-key latency')
test.setTimeout(180_000)

test('large source input after replacements', async ({ page, browserName }) => {
  const samples: Record<string, number[]> = {}
  for (let run = 0; run < runs; run++) {
    await page.goto('/?fixture=everyday&configuration=minimal&observe=false')
    await page.waitForFunction(() => window.inkkitPlayground?.observe)
    await page.evaluate(async () => {
      const api = window.inkkitPlayground
      const text = Array.from(
        { length: 10_000 },
        (_, i) => `Paragraph ${i} with ordinary words and Unicode café 🧭.`,
      ).join('\n\n')
      await api.replaceDocument(text, 'md', 'source-latency')
      await api.operation('editingMode', { mode: 'source' })
      const input =
        document.querySelector<HTMLTextAreaElement>('.inkkit-plain')!
      input.focus()
      input.setSelectionRange(
        input.value.indexOf('Paragraph 5000') + 20,
        input.value.indexOf('Paragraph 5000') + 20,
      )
    })
    for (const action of ['entry', 'undo', 'redo', 'paste']) {
      if (action !== 'entry')
        await page.evaluate(async (action) => {
          if (action === 'paste')
            await window.inkkitPlayground.operation('pastePlain', {
              text: 'pasted',
            })
          else {
            if (action === 'redo')
              await window.inkkitPlayground.operation('undo', {})
            await window.inkkitPlayground.operation(action, {})
          }
        }, action)
      await page.evaluate(() => {
        const input =
          document.querySelector<HTMLTextAreaElement>('.inkkit-plain')!
        input.focus()
        const probe = window as unknown as { latency: Promise<number> }
        probe.latency = new Promise((resolve) =>
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
      await page.keyboard.press('x')
      const latency = await page.evaluate(
        () => (window as unknown as { latency: Promise<number> }).latency,
      )
      ;(samples[action] ??= []).push(latency)
      expect(
        await page
          .locator('.inkkit-plain')
          .evaluate((input) => document.activeElement === input),
      ).toBe(true)
    }
  }
  const medians = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [
      name,
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
    ]),
  )
  mkdirSync(output!, { recursive: true })
  writeFileSync(
    `${output}/source-latency-${browserName}.json`,
    JSON.stringify({ samples, medians }, null, 2),
  )
  console.info(JSON.stringify(medians))
})
