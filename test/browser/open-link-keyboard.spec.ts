import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
for (const editable of [true, false]) {
  test(`keyboard opens Markdown and authored wiki links (${editable ? 'editable' : 'read-only'})`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.inkkitPlayground))
    await page.evaluate(
      async ({ moduleUrl, editable }) => {
        const { InkKitEditor } = (await import(
          moduleUrl
        )) as typeof import('../../src/core')
        const root = document.createElement('div')
        root.id = 'keyboard-links'
        document.body.append(root)
        const opened: string[] = []
        const errors: string[] = []
        const editor = await InkKitEditor.mount(
          root,
          {
            changed() {},
            openLink: (href) => opened.push(href),
            error: (error) => errors.push(error.code),
          },
          {
            keymap: { openLink: ['Ctrl-o'] },
            wikiLinks: { open: (ref) => opened.push(ref.raw) },
          },
        )
        editor.loadDocument({
          documentId: 'links',
          generation: 1,
          format: 'md',
          text: '[Café](https://example.com) [[ Plan# section | 日本語 ]]  \r\n',
        })
        editor.setEditable(editable)
        Object.assign(window, {
          keyboardLinks: { editor, opened, errors, before: editor.snapshot() },
        })
        editor.find('Café')
        editor.focus()
      },
      { moduleUrl, editable },
    )
    await page.keyboard.press('Control+o')
    await page.evaluate(() => {
      const host = (window as any).keyboardLinks
      const projection = host.editor.textSnapshot()
      const from = projection.text.indexOf(' 日本語 ')
      host.editor.selectTextRange({
        snapshotId: projection.snapshotId,
        from,
        to: from + 5,
      })
      host.editor.focus()
    })
    await page.keyboard.press('Control+o')
    const result = await page.evaluate(async () => {
      const host = (window as any).keyboardLinks
      const result = {
        opened: host.opened,
        errors: host.errors,
        before: host.before,
        after: host.editor.snapshot(),
      }
      await host.editor.destroy()
      return result
    })
    expect(result.opened).toEqual([
      'https://example.com',
      '[[ Plan# section | 日本語 ]]',
    ])
    expect(result.errors).toEqual([])
    expect(result.after).toEqual(result.before)
  })
}
