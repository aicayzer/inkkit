import { test, expect, observe, operation } from './fixtures'

for (const ending of ['\n', '\r\n'])
  for (const side of ['before', 'after'] as const)
    test(`typing space ${side} soft break (${JSON.stringify(ending)}) @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const source =
        '__Before__ &amp;\n\nαlpha\nβeta\n\nAfter&#33;\n'.replaceAll(
          '\n',
          ending,
        )
      await operation(page, 'reload', { text: source })
      const snapshot = (await operation(page, 'textSnapshot')) as {
        snapshotId: string
        text: string
      }
      const from =
        side === 'before'
          ? snapshot.text.indexOf('αlpha') + 5
          : snapshot.text.indexOf('βeta')
      await operation(page, 'selectTextRange', {
        range: { snapshotId: snapshot.snapshotId, from, to: from },
        options: { focus: true },
      })
      await page.keyboard.press('Space')
      const saved =
        side === 'before'
          ? source.replace('αlpha', 'αlpha&#x20;')
          : source.replace('βeta', '&#x20;βeta')
      const observed = await observe(page)
      expect(observed.diagnostics).toEqual([])
      expect(observed.snapshot!.text).toBe(saved)
      const readable = observed.textSnapshot!.text
      expect(await operation(page, 'undo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(source)
      expect(await operation(page, 'redo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(saved)
      await operation(page, 'reload', { text: saved })
      expect((await observe(page)).snapshot!.text).toBe(saved)
      expect((await observe(page)).textSnapshot!.text).toBe(readable)
    })
