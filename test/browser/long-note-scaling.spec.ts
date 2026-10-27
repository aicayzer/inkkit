import { keyToFrame } from './key-timing'
import { expect, test } from '@playwright/test'

test('long-note editing avoids quadratic interactive work', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const samples: Record<number, Record<string, number>[]> = {}
  for (let run = 0; run < 3; run++) {
    for (const size of [1000, 4000]) {
      await page.goto('/?fixture=everyday&configuration=minimal&observe=false')
      await page.waitForFunction(() => window.inkkitPlayground?.observe)
      const result = await page.evaluate(async (size) => {
        const api = window.inkkitPlayground
        const text =
          Array.from({ length: size }, (_, i) =>
            i % 100 === 0
              ? `## Heading ${i}`
              : `Paragraph ${i} alpha with text to edit.`,
          ).join('\n\n') + '\n'
        await api.replaceDocument(text, 'md', 'scaling')
        const result: Record<string, number> = {}
        const timed = async (name: string, action: () => unknown) => {
          const start = performance.now()
          await action()
          result[name] = performance.now() - start
        }
        await api.operation('find', { text: 'Paragraph 501' })
        await api.operation('find', { text: '' })
        await timed('typing', () => api.operation('insertText', { text: 'x' }))
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
        await api.operation('insertText', { text: 'x' })
        await timed('headings', () => api.operation('headings', {}))
        await timed('sourceToFormatted', () =>
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
      ;(samples[size] ??= []).push(result)
    }
  }
  const median = (size: number, name: string) =>
    samples[size]!.map((sample) => sample[name]!).sort((a, b) => a - b)[1]!
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
    ).toBeLessThan(median(1000, name) * 8 + 10)
  // Selection has a separate deterministic traversal guard. Its DOM geometry work
  // has a wider allowance on shared WebKit hosts.
  expect(median(4000, 'selectAll')).toBeLessThan(
    median(1000, 'selectAll') * 8 + 20,
  )
})
