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
    const complete = note(`${formatted}\\\n${prefix ? '  ' : ''}z${tail}`)
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

for (const { name, prefix, continuation } of [
  { name: 'paragraph', prefix: '', continuation: '' },
  { name: 'list item', prefix: '+ ', continuation: '  ' },
  { name: 'quote', prefix: '> ', continuation: '> ' },
  { name: 'callout', prefix: '> [!note]\n> ', continuation: '> ' },
]) {
  for (const ending of ['\n', '\r\n']) {
    for (const kind of [
      'zz',
      '**B**',
      '`B`',
      'new comment break',
      'authored comment break',
    ]) {
      test(`deletion ${name} ${ending === '\n' ? 'LF' : 'CRLF'} ${kind} saves, reopens and undoes`, async ({
        page,
        openFixture,
      }) => {
        await openFixture()
        const comment = kind.endsWith('comment break')
        const inserted = kind === 'new comment break'
        const note = (body: string) =>
          `Untouched __before__.\n\n${prefix}${body}\n\nUntouched _after_.\n`.replaceAll(
            '\n',
            ending,
          )
        const broken = note(
          comment ? '**A**<br /><!-- c -->' : `A\\\n${continuation}\\- item`,
        )
        const withText = note(
          comment
            ? `**A**\\\n${continuation}z<!-- c -->`
            : `A\\\n${continuation}${kind}- item`,
        )
        const source = inserted ? note('**A**z<!-- c -->') : withText
        const saved = async (text: string) => {
          const state = await observe(page)
          expect(state.diagnostics).toEqual([])
          expect(state.snapshot!.text).toBe(text)
        }
        const select = async (text: string, collapsed = false) => {
          const snapshot = (await observe(page)).textSnapshot!
          const from = snapshot.text.indexOf(text)
          expect(from).toBeGreaterThanOrEqual(0)
          await operation(page, 'selectTextRange', {
            range: {
              snapshotId: snapshot.snapshotId,
              from: from + (collapsed ? text.length : 0),
              to: from + text.length,
            },
            options: { focus: true },
          })
          await operation(page, 'focus')
        }
        await page.evaluate(
          (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
          source,
        )
        await saved(source)
        if (inserted) {
          await select('A', true)
          await page.keyboard.press('Shift+Enter')
          await saved(withText)
        }
        await select(comment ? 'z' : kind === 'zz' ? 'zz' : 'B')
        await page.keyboard.press('Backspace')
        await saved(broken)
        const readable = (await observe(page)).textSnapshot!.text
        await page.keyboard.press('ControlOrMeta+z')
        await saved(withText)
        if (inserted) {
          await page.keyboard.press('ControlOrMeta+z')
          await saved(source)
        }
        await page.evaluate(
          (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
          broken,
        )
        await saved(broken)
        expect((await observe(page)).textSnapshot!.text).toBe(readable)
      })
    }
  }
}
