import { test, expect, observe, operation } from './fixtures'

test('Shift-Enter before block markers saves, reopens and undoes with real keys', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  for (const { formatted, tail, escaped, prefix, ending } of [
    {
      formatted: '**A**',
      tail: '- item',
      escaped: '\\- item',
      prefix: '',
      ending: '\n',
    },
    {
      formatted: '`A`',
      tail: '1. x',
      escaped: '1\\. x',
      prefix: '+ ',
      ending: '\r\n',
    },
    {
      formatted: '[A](https://example.com)',
      tail: '<!-- c -->',
      escaped: '<!-- c -->',
      prefix: '',
      ending: '\r\n',
    },
  ]) {
    const note = (body: string) =>
      `Untouched __before__.\n\n${prefix}${body}\n\nUntouched _after_.\n`.replaceAll(
        '\n',
        ending,
      )
    const source = note(formatted + tail)
    const comment = tail === '<!-- c -->'
    const broken = note(
      comment
        ? `${formatted}<br />${tail}`
        : `${formatted}\\\n${prefix ? '  ' : ''}${escaped}`,
    )
    const complete = note(
      comment
        ? `${formatted}<br />z${tail}`
        : `${formatted}\\\n${prefix ? '  ' : ''}z${tail}`,
    )
    const saved = async (text: string) => {
      const state = await observe(page)
      expect(state.diagnostics).toEqual([])
      expect(state.snapshot!.text).toBe(text)
    }
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      source,
    )
    await saved(source)
    const snapshot = (await observe(page)).textSnapshot!
    const at = snapshot.text.indexOf('A') + 1
    expect(at).toBeGreaterThan(0)
    await operation(page, 'selectTextRange', {
      range: { snapshotId: snapshot.snapshotId, from: at, to: at },
      options: { focus: true },
    })
    await operation(page, 'focus')
    await page.keyboard.press('Shift+Enter')
    await saved(broken)
    const brokenText = (await observe(page)).textSnapshot!.text
    if (!comment) expect(brokenText).toContain(`A\n${tail}`)
    await page.keyboard.type('z')
    await saved(complete)
    await page.keyboard.press('ControlOrMeta+z')
    await saved(broken)
    await page.keyboard.press('ControlOrMeta+z')
    await saved(source)
    await operation(page, 'redo')
    await operation(page, 'redo')
    await saved(complete)
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      complete,
    )
    await saved(complete)
    if (!comment)
      expect((await observe(page)).textSnapshot!.text).toContain(`A\nz${tail}`)
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      broken,
    )
    await saved(broken)
    expect((await observe(page)).textSnapshot!.text).toBe(brokenText)
  }
})
