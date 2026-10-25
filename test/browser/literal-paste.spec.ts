import { test, expect, operation, observe } from './fixtures'
import type { ClipboardOutput } from '../../src/core'

const contexts = [
  'before\n\n**target**\n\nafter\n',
  'before\n\n*target*\n\nafter\n',
  'before\n\n| H |\n| - |\n| target |\n\nafter\n',
  'before\n\n# target\n\nafter\n',
]
for (const [index, source] of contexts.entries())
  test(`literal clipboard lines match the facade in context ${index}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    for (const text of ['α\nβ', 'α\n\nβ\n', 'α\r\n\r\nβ\r\n']) {
      const results: { saved: string; completed: string; html: string }[] = []
      for (const route of ['facade', 'clipboard', 'replaceAll']) {
        await operation(page, 'reload', { text: source })
        expect(await operation(page, 'find', { text: 'target' })).toBe(true)
        if (route === 'facade') await operation(page, 'pastePlain', { text })
        else if (route === 'replaceAll')
          expect(
            await operation(page, 'replaceAll', {
              search: 'target',
              replacement: text,
            }),
          ).toBe(1)
        else {
          await page
            .getByRole('textbox', {
              name: 'Formatted Markdown editor',
              exact: true,
            })
            .evaluate((element, text) => {
              const data = new DataTransfer()
              data.setData('text/plain', text)
              data.setData('vscode-editor-data', 'invalid')
              element.dispatchEvent(
                new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: data,
                }),
              )
            }, text)
        }
        const saved = (await observe(page)).snapshot!.text
        expect(saved.startsWith('before\n\n')).toBe(true)
        expect(saved.endsWith('\n\nafter\n')).toBe(true)
        const html = String(
          (
            (await operation(page, 'clipboard', {
              scope: 'document',
            })) as ClipboardOutput
          ).html,
        )
        if (index < 2)
          expect(html).toContain(index === 1 ? '<em>α' : '<strong>α')
        await operation(page, 'undo')
        expect((await observe(page)).snapshot!.text).toBe(source)
        await operation(page, 'redo')
        // Collapse the replacement selection at its end before continuing to type.
        const current = (await observe(page)).textSnapshot!
        await operation(page, 'selectTextRange', {
          range: {
            snapshotId: current.snapshotId,
            from: current.selection.to,
            to: current.selection.to,
          },
        })
        await operation(page, 'insertText', { text: 'X' })
        const completed = (await observe(page)).snapshot!.text
        const clipboard = (await operation(page, 'clipboard', {
          scope: 'document',
        })) as ClipboardOutput
        await operation(page, 'reload', { text: completed })
        expect((await observe(page)).snapshot!.text).toBe(completed)
        const reopened = (await operation(page, 'clipboard', {
          scope: 'document',
        })) as ClipboardOutput
        expect(reopened.html).toBe(clipboard.html)
        expect(reopened.text).toBe(clipboard.text)
        results.push({ saved, completed, html })
      }
      expect(results[1]).toEqual(results[0])
      expect(results[2]).toEqual(results[0])
    }
  })
