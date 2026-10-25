import { test, expect, observe, operation } from './fixtures'

const cases = [
  ['final divider', 'Text\n\n---', 'TextX\n\n---'],
  ['sole divider', '---', '---\n\nX\n'],
  [
    'final image',
    'Text\n\n![Example](asset:example)',
    'Text\n\n![Example](asset:example)\n\nX\n',
  ],
  [
    'sole image',
    '![Example](asset:example)',
    '![Example](asset:example)\n\nX\n',
  ],
  ['ordinary paragraph', 'Text\n\nLast', 'Text\n\nLastX'],
  [
    'final diagram',
    'Text\n\n```mermaid\ngraph TD; A-->B\n```',
    'Text\n\n```mermaid\ngraph TD; A-->BX\n```',
  ],
  ['CRLF and Unicode', 'Café 😀\r\n\r\n***\r\n', 'Café 😀X\r\n\r\n***\r\n'],
] as const

for (const [name, source, expected] of cases) {
  for (const method of ['load', 'replace'] as const) {
    test(`${method} protects terminal blocks during typing: ${name}`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      await page.evaluate(() =>
        window.inkkitPlayground.replaceDocument('Original', 'md'),
      )
      if (method === 'load')
        await page.evaluate(
          (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
          source,
        )
      else
        expect(await operation(page, 'replaceSource', { text: source })).toBe(
          true,
        )
      expect((await observe(page)).snapshot!.text).toBe(source)
      const { selection } = (await observe(page)).textSnapshot!
      expect(selection.from).toBe(selection.to)
      await operation(page, 'focus')
      await page.keyboard.type('X')
      await expect
        .poll(async () => (await observe(page)).snapshot!.text)
        .toBe(expected)
      expect(await operation(page, 'undo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(source)
      expect(await operation(page, 'redo')).toBe(true)
      expect((await observe(page)).snapshot!.text).toBe(expected)
      if (method === 'replace') {
        expect(await operation(page, 'undo')).toBe(true)
        expect(await operation(page, 'undo')).toBe(true)
        expect((await observe(page)).snapshot!.text).toBe('Original')
        expect(await operation(page, 'redo')).toBe(true)
        expect((await observe(page)).snapshot!.text).toBe(source)
        expect(await operation(page, 'redo')).toBe(true)
        expect((await observe(page)).snapshot!.text).toBe(expected)
      }
      await page.evaluate(
        (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
        expected,
      )
      expect((await observe(page)).snapshot!.text).toBe(expected)
    })
  }
}
