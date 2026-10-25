import { test, expect, operation, observe } from './fixtures'

for (const mark of [
  '**',
  '*',
  '***',
  '~~',
  '==',
  '[label](https://example.com)',
]) {
  const wrap = (text: string) =>
    mark.startsWith('[')
      ? `[${text}](https://example.com)`
      : `${mark}${text}${mark}`
  for (const context of ['heading', 'table']) {
    test(`marked literal breaks: ${context} ${mark}`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const source = `before\r\n\r\n${context === 'heading' ? '# ' + wrap('target') : '| H |\r\n| - |\r\n| ' + wrap('target') + ' |'}\r\n\r\nafter\r\n`
      for (const text of ['α\nβ', 'α\n\nβ\n', 'α\r\n\r\nβ\r\n']) {
        let expected = ''
        for (const route of ['facade', 'clipboard', 'replace']) {
          await operation(page, 'reload', { text: source })
          await operation(page, 'find', { text: 'target' })
          if (route === 'facade') await operation(page, 'pastePlain', { text })
          else if (route === 'replace')
            await operation(page, 'replaceAll', {
              search: 'target',
              replacement: text,
            })
          else
            await page
              .getByRole('textbox', {
                name: 'Formatted Markdown editor',
                exact: true,
              })
              .evaluate((el, text) => {
                const data = new DataTransfer()
                data.setData('text/plain', text)
                data.setData('vscode-editor-data', 'invalid')
                el.dispatchEvent(
                  new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: data,
                  }),
                )
              }, text)
          const saved = (await observe(page)).snapshot!.text
          expect(saved).toContain('α')
          expect(saved).toContain('β')
          expect(saved.startsWith('before\r\n\r\n')).toBe(true)
          expect(saved.endsWith('\r\n\r\nafter\r\n')).toBe(true)
          if (route === 'facade') expected = saved
          else expect(saved).toBe(expected)
          const content = page.locator(
            context === 'heading' ? '.ProseMirror h1' : '.ProseMirror td p',
          )
          const html = await content.innerHTML()
          expect(html).toContain('<br')
          expect(html).not.toContain('&lt;br')
          await operation(page, 'undo')
          expect((await observe(page)).snapshot!.text).toBe(source)
          await operation(page, 'reload', { text: saved })
          expect(await content.innerHTML()).toBe(html)
          const snapshot = (await observe(page)).textSnapshot!
          const end = snapshot.text.indexOf('β') + 1
          await operation(page, 'selectTextRange', {
            range: { snapshotId: snapshot.snapshotId, from: end, to: end },
          })
          await operation(page, 'insertText', { text: 'X' })
          const continued = (await observe(page)).snapshot!.text
          expect(continued).toContain('X')
          const continuedHTML = await content.innerHTML()
          await operation(page, 'reload', { text: continued })
          expect(await content.innerHTML()).toBe(continuedHTML)
        }
      }
    })
  }
}
