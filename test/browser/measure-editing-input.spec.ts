import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { keyToFrame } from './key-timing'
import type { InkKitEditor } from '../../src/core'

const output = process.env.INKKIT_MEASURE
const runs = Number(process.env.INKKIT_MEASURE_RUNS ?? 5)
test.skip(!output, 'Set INKKIT_MEASURE to record editing input latency')
test.setTimeout(240_000)

declare global {
  interface Window {
    editingProbe: { editor: InkKitEditor; errors: string[] }
  }
}

async function mount(page: Page, source: string) {
  await page.goto('/?fixture=everyday&configuration=minimal&observe=false')
  await page.waitForFunction(() => window.inkkitPlayground?.observe)
  await page.evaluate(async (source) => {
    const moduleURL = '/_test/core.js'
    const { InkKitEditor } = await import(/* @vite-ignore */ moduleURL)
    const root = document.createElement('div')
    root.id = 'editing-probe'
    root.style.cssText =
      'position:fixed;inset:0;overflow:auto;background:Canvas;z-index:9999'
    document.body.append(root)
    const errors: string[] = []
    const editor = await InkKitEditor.mount(
      root,
      {
        changed() {},
        copy() {},
        openLink() {},
        error(error: Error) {
          errors.push(error.message)
        },
      },
      { rendering: { codeHighlighting: false, diagramPreview: false } },
    )
    window.editingProbe = { editor, errors }
    editor.loadDocument({
      documentId: 'editing-measurement',
      generation: 1,
      format: 'md',
      text: source,
    })
  }, source)
}

async function saveAndReopen(page: Page) {
  return page.evaluate(() => {
    const { editor, errors } = window.editingProbe
    if (errors.length) throw Error(errors.join('\n'))
    const saved = editor.snapshot().text
    editor.loadDocument({
      documentId: 'reopened',
      generation: 2,
      format: 'md',
      text: saved,
    })
    if (editor.snapshot().text !== saved) throw Error('Reopened bytes changed')
    return saved
  })
}

function record(
  name: string,
  browserName: string,
  samples: Record<string, number[]>,
  metadata: object,
) {
  const summaries = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return [
        name,
        {
          median: sorted[Math.floor(sorted.length / 2)],
          minimum: sorted[0],
          maximum: sorted.at(-1),
        },
      ]
    }),
  )
  const result = { ...metadata, samples, summaries }
  mkdirSync(output!, { recursive: true })
  writeFileSync(
    `${output}/${name}-${browserName}.json`,
    JSON.stringify(result, null, 2) + '\n',
  )
  console.info(JSON.stringify(result))
}

test('source input after entry, undo, redo and paste', async ({
  page,
  browserName,
  browser,
}) => {
  const source =
    Array.from(
      { length: 10_000 },
      (_, index) => `Paragraph ${index} café 😀 has ordinary text.`,
    ).join('\r\n\r\n') + '\r\n'
  const pasted = Array.from(
    { length: 500 },
    (_, index) => `Pasted ${index} 雪.`,
  ).join('\n\n')
  const samples: Record<string, number[]> = {}
  for (let run = 0; run < runs; run++) {
    for (const phase of ['entry', 'undo', 'redo', 'paste']) {
      await mount(page, source)
      const before = await page.evaluate(
        ({ phase, pasted }) => {
          const editor = window.editingProbe.editor
          editor.setEditingMode('source')
          const input = document.querySelector<HTMLTextAreaElement>(
            '#editing-probe textarea',
          )!
          input.focus()
          input.setSelectionRange(20, 20)
          if (phase === 'undo' || phase === 'redo') {
            editor.insertText('prepared', 1)
            editor.undo()
            if (phase === 'redo') editor.redo()
          }
          if (phase === 'paste') editor.pasteAsPlainText(pasted)
          input.focus()
          input.setSelectionRange(20, 20)
          return editor.snapshot().text
        },
        { phase, pasted },
      )
      ;(samples[phase] ??= []).push(await keyToFrame(page, 'x'))
      expect(
        await page
          .locator('#editing-probe textarea')
          .evaluate((e) => document.activeElement === e),
      ).toBe(true)
      expect(await saveAndReopen(page)).toBe(
        before.slice(0, 20) + 'x' + before.slice(20),
      )
    }
  }
  record('source-input', browserName, samples, {
    browser: browser.version(),
    paragraphs: 10000,
    bytes: Buffer.byteLength(source),
    lineEndings: 'CRLF',
    runs,
  })
})

test('task-list and paragraph input after splitting', async ({
  page,
  browserName,
  browser,
}) => {
  const samples: Record<string, number[]> = {}
  const savedHashes: Record<string, string[]> = {}
  for (let run = 0; run < runs; run++) {
    for (const kind of ['list', 'paragraphs']) {
      const source =
        Array.from(
          { length: 5000 },
          (_, index) =>
            `${kind === 'list' ? '+ [ ] ' : ''}Item ${index} café 😀 has ordinary text.`,
        ).join(kind === 'list' ? '\r\n' : '\r\n\r\n') + '\r\n'
      await mount(page, source)
      await page.evaluate(() => {
        const editor = window.editingProbe.editor
        const snapshot = editor.textSnapshot()!
        const text = 'Item 2500 café 😀 has ordinary text.'
        const from = snapshot.text.indexOf(text) + text.length
        if (from < text.length) throw Error('Measurement item missing')
        editor.selectTextRange({
          snapshotId: snapshot.snapshotId,
          from,
          to: from,
        })
        editor.focus()
      })
      ;(samples[`${kind}:enter`] ??= []).push(await keyToFrame(page, 'Enter'))
      ;(samples[`${kind}:typing`] ??= []).push(await keyToFrame(page, 'x'))
      await page.keyboard.press('ArrowLeft')
      ;(samples[`${kind}:backspace`] ??= []).push(
        await keyToFrame(page, 'Backspace'),
      )
      const saved = await saveAndReopen(page)
      const start = source.indexOf(
        `${kind === 'list' ? '+ [ ] ' : ''}Item 2500 `,
      )
      const end = source.indexOf(`${kind === 'list' ? '+ [ ] ' : ''}Item 2501 `)
      expect(saved.startsWith(source.slice(0, start))).toBe(true)
      expect(saved.endsWith(source.slice(end))).toBe(true)
      expect(saved).toContain('Item 2500 café 😀 has ordinary text.')
      ;(savedHashes[kind] ??= []).push(
        createHash('sha256').update(saved).digest('hex'),
      )
    }
  }
  record('list-input', browserName, samples, {
    browser: browser.version(),
    items: 5000,
    lineEndings: 'CRLF',
    runs,
    savedHashes,
  })
})
