import { keyToFrame } from './key-timing'
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { execFileSync } from 'node:child_process'

const output = process.env.INKKIT_MEASURE
test.skip(!output, 'Set INKKIT_MEASURE to record long-note measurements')
test.setTimeout(10 * 60_000)

test('long-note editing costs', async ({ page, browserName, browser }) => {
  const samples: Record<string, number[]> = {}
  for (const size of process.env.INKKIT_MEASURE_SIZE
    ? [Number(process.env.INKKIT_MEASURE_SIZE)]
    : [1000, 4000, 5000]) {
    for (
      let run = 0;
      run < Number(process.env.INKKIT_MEASURE_RUNS ?? 5);
      run++
    ) {
      await page.goto('/?fixture=everyday&configuration=minimal&observe=false')
      await page.waitForFunction(() => window.inkkitPlayground?.observe)
      const result = await page.evaluate(async (size) => {
        const api = window.inkkitPlayground
        const text =
          Array.from({ length: size }, (_, index) =>
            index % 100 === 0
              ? `## Heading ${index}`
              : `Paragraph ${index} alpha with ordinary text to edit.`,
          ).join('\n\n') + '\n'
        await api.replaceDocument(text, 'md', 'measure')
        const result: Record<string, number> = {}
        const measure = async (name: string, action: () => unknown) => {
          const start = performance.now()
          await action()
          result[name] = performance.now() - start
        }
        await api.operation('find', {
          text: `Paragraph ${Math.floor(size / 2) + 1}`,
        })
        await api.operation('find', { text: '' })
        await measure('typing', () =>
          api.operation('insertText', { text: 'x' }),
        )
        await api.operation('undo', {})
        await measure('paste', () =>
          api.operation('paste', {
            input: {
              text: Array.from(
                { length: 500 },
                (_, i) => `Pasted paragraph ${i}.`,
              ).join('\n\n'),
              markdown: Array.from(
                { length: 500 },
                (_, i) => `Pasted paragraph ${i}.`,
              ).join('\n\n'),
              html: '',
            },
          }),
        )
        await api.operation('undo', {})
        await api.operation('find', { text: 'alpha' })
        await measure('activeFindTyping', () =>
          api.operation('insertText', { text: 'x' }),
        )
        await api.operation('undo', {})
        await api.operation('find', { text: '' })
        await api.operation('editingMode', { mode: 'source' })
        await measure('headingsFirst', () => api.operation('headings', {}))
        await measure('headingsRepeated', () => api.operation('headings', {}))
        const textarea =
          document.querySelector<HTMLTextAreaElement>('.inkkit-plain')!
        textarea.focus()
        textarea.setSelectionRange(
          textarea.value.indexOf('Paragraph 501'),
          textarea.value.indexOf('Paragraph 501'),
        )
        await api.operation('insertText', { text: 'x' })
        await measure('headingsAfterEdit', () => api.operation('headings', {}))
        await measure('sourceToFormatted', () =>
          api.operation('editingMode', { mode: 'formatted' }),
        )
        return result
      }, size)
      await page.locator('.inkkit-root .ProseMirror.editor').focus()
      const beforeEnter = await page.evaluate(
        () => window.inkkitPlayground.observe().snapshot!.text,
      )
      result.enter = await keyToFrame(page, 'Enter')
      expect(
        await page.evaluate(
          () => window.inkkitPlayground.observe().snapshot!.text,
        ),
      ).not.toBe(beforeEnter)
      for (const [name, time] of Object.entries(result))
        (samples[`${size}:${name}`] ??= []).push(time)
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
    `${output}/long-note-${browserName}.json`,
    JSON.stringify(
      {
        command: process.argv,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
        machine: {
          cpu: cpus()[0]?.model,
          platform: platform(),
          release: release(),
        },
        browser: browser.version(),
        samples,
        medians,
      },
      null,
      2,
    ),
  )
  console.info(JSON.stringify(medians))
})
