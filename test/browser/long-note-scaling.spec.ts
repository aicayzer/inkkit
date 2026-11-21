import { keyToFrame } from './key-timing'
import { expect, test } from '@playwright/test'

// The second run turns on both display options, so the fold controls and line numbers are in
// the measured work. Its note also holds a code block every 500 paragraphs. The third folds every
// section but the one being edited, in a note with a heading every five blocks, so the cost of
// many folded sections is in the measured work. That one measures a note a quarter the size of
// the others, because its cost is quadratic (issue #516) and a hosted WebKit runner would
// otherwise take minutes to measure the larger note. The ratio between its two sizes is the same.
for (const mode of ['plain', 'display', 'folded'] as const) {
  const display = mode !== 'plain'
  const folded = mode === 'folded'
  const [small, large] = folded ? [500, 2000] : [1000, 4000]
  // A paragraph both notes hold, well inside the smaller one.
  const target = folded ? 'Paragraph 251' : 'Paragraph 501'
  test(`long-note editing avoids quadratic interactive work${display ? ' with display options on' : ''}${folded ? ' and every section folded' : ''}`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const samples: Record<number, Record<string, number>[]> = {}
    for (let run = 0; run < 3; run++) {
      for (const size of [small, large]) {
        await page.goto(
          '/?fixture=everyday&configuration=minimal&observe=false',
        )
        await page.waitForFunction(() => window.inkkitPlayground?.observe)
        const result = await page.evaluate(
          async ({ size, display, folded, target }) => {
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
            // A section that a find opens has not been seen until the browser paints it, and no
            // edit changes it before then.
            const painted = () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              )
            await api.operation('find', { text: target })
            await api.operation('find', { text: '' })
            await painted()
            await timed('typing', () =>
              api.operation('insertText', { text: 'x' }),
            )
            await api.operation('undo', {})
            await api.operation('find', { text: 'alpha' })
            await painted()
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
              input.value.indexOf(target),
              input.value.indexOf(target),
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
          { size, display, folded, target },
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
            [small, large].map((size) => [
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
    // block on every update, so the cost there grows with the square of the note (issue #516, which
    // this guard does not fix). That budget is the square of the size ratio.
    // `test/display-fold.test.ts` bounds the fold plugin's own reads.
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
        median(large, name),
        `${name}: ${JSON.stringify(samples)}`,
      ).toBeLessThan(median(small, name) * factor + 10)
    // Selection has a separate deterministic traversal guard. Its DOM geometry work
    // has a wider allowance on shared WebKit hosts.
    expect(median(large, 'selectAll')).toBeLessThan(
      median(small, 'selectAll') * factor + 20,
    )
  })
}
