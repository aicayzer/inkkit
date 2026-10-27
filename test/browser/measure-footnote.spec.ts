import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
const output = process.env.INKKIT_MEASURE
test.skip(!output, 'Set INKKIT_MEASURE to record footnote-key costs')
test.setTimeout(180_000)
test('typing beside footnotes', async ({ page, browserName }) => {
  const samples: number[] = []
  for (let run = 0; run < Number(process.env.INKKIT_MEASURE_RUNS ?? 5); run++) {
    await page.goto('/?fixture=everyday&configuration=minimal&observe=false')
    await page.waitForFunction(() => window.inkkitPlayground?.observe)
    samples.push(
      await page.evaluate(async () => {
        const api = window.inkkitPlayground
        const text =
          Array.from(
            { length: 4500 },
            (_, i) => `Paragraph ${i} with a note[^n${i % 500}].`,
          ).join('\n\n') +
          '\n\n' +
          Array.from({ length: 500 }, (_, i) => `[^n${i}]: Note ${i}.`).join(
            '\n\n',
          ) +
          '\n'
        await api.replaceDocument(text, 'md', 'footnotes')
        await api.operation('find', { text: 'Paragraph 2250' })
        await api.operation('find', { text: '' })
        const start = performance.now()
        await api.operation('insertText', { text: 'x' })
        return performance.now() - start
      }),
    )
  }
  const median = [...samples].sort((a, b) => a - b)[
    Math.floor(samples.length / 2)
  ]
  mkdirSync(output!, { recursive: true })
  writeFileSync(
    `${output}/footnote-${browserName}.json`,
    JSON.stringify({ samples, median }, null, 2),
  )
  console.info(JSON.stringify({ median }))
})
