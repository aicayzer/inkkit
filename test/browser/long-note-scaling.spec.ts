import { keyToFrame } from './key-timing'
import { expect, test } from '@playwright/test'

// The second run turns on both display options, so the fold controls and line numbers are in
// the measured work. Its note also holds a code block every 500 paragraphs. The third folds every
// section but the one being edited, in a note with a heading every five blocks, so the cost of
// many folded sections is in the measured work.
for (const mode of ['plain', 'display', 'folded'] as const) {
  const display = mode !== 'plain'
  const folded = mode === 'folded'
  test(`long-note editing avoids quadratic interactive work${display ? ' with display options on' : ''}${folded ? ' and every section folded' : ''}`, async ({
    page,
  }) => {
    test.setTimeout(folded ? 300_000 : 90_000)
    const samples: Record<number, Record<string, number>[]> = {}
    for (let run = 0; run < 3; run++) {
      for (const size of [1000, 4000]) {
        await page.goto(
          '/?fixture=everyday&configuration=minimal&observe=false',
        )
        await page.waitForFunction(() => window.inkkitPlayground?.observe)
        const result = await page.evaluate(
          async ({ size, display, folded }) => {
            const api = window.inkkitPlayground
            const text =
              Array.from({ length: size }, (_, i) =>
                i % (folded ? 5 : 100) === 0
                  ? `## Heading ${i}`
                  : display && i % 500 === 50
                    ? '```js\nconst a = 1\nconst b = 2\nconst c = 3\n```'
                    : `Paragraph ${i} alpha with text to edit.`,
              ).join('\n\n') + '\n'
            await api.replaceDocument(text, 'md', 'scaling')
            if (display)
              await api.operation('display', {
                preferences: { foldHeadings: true, codeLineNumbers: true },
              })
            if (folded)
              for (const button of document.querySelectorAll<HTMLElement>(
                '[data-inkkit-heading-toggle]',
              ))
                button.click()
            // Finding the paragraph opens its section; every other section stays folded.
            const result: Record<string, number> = {}
            const timed = async (name: string, action: () => unknown) => {
              const start = performance.now()
              await action()
              result[name] = performance.now() - start
            }
            await api.operation('find', { text: 'Paragraph 501' })
            await api.operation('find', { text: '' })
            await timed('typing', () =>
              api.operation('insertText', { text: 'x' }),
            )
            await api.operation('undo', {})
            await api.operation('find', { text: 'alpha' })
            await timed('findTyping', () =>
              api.operation('insertText', { text: 'x' }),
            )
            await api.operation('undo', {})
            await api.operation('find', { text: '' })
            const snapshot = (await api.operation('textSnapshot', {})) as {
              snapshotId: string
              text: string
            }
            await timed('selectAll', () =>
              api.operation('selectTextRange', {
                range: {
                  snapshotId: snapshot.snapshotId,
                  from: 0,
                  to: snapshot.text.length,
                },
                options: { focus: false },
              }),
            )
            await api.operation('editingMode', { mode: 'source' })
            const input =
              document.querySelector<HTMLTextAreaElement>('.inkkit-plain')!
            input.setSelectionRange(
              input.value.indexOf('Paragraph 501'),
              input.value.indexOf('Paragraph 501'),
            )
            const sourceKey = (text: string) => {
              input.dispatchEvent(
                new InputEvent('beforeinput', {
                  inputType: 'insertText',
                  data: text,
                  bubbles: true,
                }),
              )
              input.setRangeText(
                text,
                input.selectionStart,
                input.selectionEnd,
                'end',
              )
              input.dispatchEvent(
                new InputEvent('input', {
                  inputType: 'insertText',
                  data: text,
                  bubbles: true,
                }),
              )
            }
            sourceKey('x')
            await timed('headings', () => api.operation('headings', {}))
            sourceKey('y')
            await timed('sourceToFormatted', () =>
              api.operation('editingMode', { mode: 'formatted' }),
            )
            return result
          },
          { size, display, folded },
        )
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
        ;(samples[size] ??= []).push(result)
      }
    }
    const median = (size: number, name: string) =>
      samples[size]!.map((sample) => sample[name]!).sort((a, b) => a - b)[1]!
    if (process.env.INKKIT_SCALING_REPORT)
      console.log(
        `${mode} ${test.info().project.name} ${JSON.stringify(
          Object.fromEntries(
            [1000, 4000].map((size) => [
              size,
              Object.fromEntries(
                Object.keys(samples[size]![0]!).map((name) => [
                  name,
                  Math.round(median(size, name) * 10) / 10,
                ]),
              ),
            ]),
          ),
        )}`,
      )
    // With every block hidden, ProseMirror itself looks at each top-level decoration for each
    // block on every update, so the cost there grows with the square of the note. That budget is
    // the square of the size ratio. `test/display-fold.test.ts` bounds the fold plugin's own reads.
    const factor = folded ? 16 : 8
    // Four times the document may cost linearly more. The small timer allowance absorbs
    // timer granularity and shared-runner noise; quadratic paths exceed this budget.
    for (const name of [
      'typing',
      'enter',
      'findTyping',
      'headings',
      'sourceToFormatted',
    ])
      expect(
        median(4000, name),
        `${name}: ${JSON.stringify(samples)}`,
      ).toBeLessThan(median(1000, name) * factor + 10)
    // Selection has a separate deterministic traversal guard. Its DOM geometry work
    // has a wider allowance on shared WebKit hosts.
    expect(median(4000, 'selectAll')).toBeLessThan(
      median(1000, 'selectAll') * factor + 20,
    )
  })
}
