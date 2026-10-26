import { test, expect, observe, operation } from './fixtures'

for (const ending of ['\n', '\r\n']) {
  for (const container of ['', '+ '])
    test(`continuation block markers ${JSON.stringify([ending, container])} @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      for (const marker of [
        '# ',
        '- ',
        '+ ',
        '* ',
        '1. ',
        '1) ',
        '> ',
        '```',
      ]) {
        const source =
          `__Before__ &amp;\n\n${container}two\n${container ? '  ' : ''}more α\n\nAfter&#33;\n`.replaceAll(
            '\n',
            ending,
          )
        await operation(page, 'reload', { text: source })
        const snapshot = (await observe(page)).textSnapshot!
        const from = snapshot.text.indexOf('more')
        await operation(page, 'selectTextRange', {
          range: { snapshotId: snapshot.snapshotId, from, to: from },
          options: { focus: true },
        })
        await page.keyboard.type(marker)
        const observed = await observe(page)
        expect(observed.diagnostics).toEqual([])
        expect(observed.textSnapshot!.text).toContain(marker + 'more α')
        const saved = observed.snapshot!.text
        expect(saved).toContain('__Before__ &amp;' + ending + ending)
        expect(saved).toContain(ending + ending + 'After&#33;' + ending)
        expect(await operation(page, 'undo')).toBe(true)
        expect((await observe(page)).snapshot!.text).toBe(source)
        expect(await operation(page, 'redo')).toBe(true)
        await operation(page, 'reload', { text: saved })
        expect((await observe(page)).textSnapshot!.text).toBe(
          observed.textSnapshot!.text,
        )
        expect((await observe(page)).snapshot!.text).toBe(saved)
      }
    })
  for (const pasted of [
    'x\n\n<!-- c -->',
    '<!-- c -->',
    'x\n\n---',
    'x\n\ny α',
  ])
    test(`tight list blocks ${JSON.stringify([ending, pasted])} @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const source =
        '__Before__ &amp;\n\n+ a\n+\n+ c\n\nAfter&#33;\n'.replaceAll(
          '\n',
          ending,
        )
      await operation(page, 'reload', { text: source })
      const snapshot = (await observe(page)).textSnapshot!
      const from = snapshot.text.indexOf('a\n\n') + 2
      await operation(page, 'selectTextRange', {
        range: { snapshotId: snapshot.snapshotId, from, to: from },
        options: { focus: true },
      })
      await operation(page, 'paste', {
        input: { text: pasted, markdown: pasted },
      })
      const observed = await observe(page)
      expect(observed.diagnostics).toEqual([])
      const saved = observed.snapshot!.text
      expect(saved).not.toBe(source)
      if (pasted.startsWith('x')) expect(saved).toContain('x')
      if (pasted.includes('<!--')) expect(saved).toContain('<!-- c -->')
      if (pasted.includes('---'))
        await expect(page.locator('.ProseMirror hr')).toHaveCount(1)
      if (pasted.includes('y α')) expect(saved).toContain('y α')
      expect(saved).toContain('__Before__ &amp;' + ending + ending)
      expect(saved).toContain(ending + ending + 'After&#33;' + ending)
      expect(await operation(page, 'undo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(source)
      expect(await operation(page, 'redo')).toBe(true)
      await operation(page, 'reload', { text: saved })
      expect((await observe(page)).snapshot!.text).toBe(saved)
      expect((await observe(page)).textSnapshot!.text).toBe(
        observed.textSnapshot!.text,
      )
    })
}
