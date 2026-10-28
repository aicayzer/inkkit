import { test, expect, observe, operation } from './fixtures'

for (const [name, html, expected] of [
  [
    'parser-recognised table with metadata-like cell text',
    '<TABLE/><TR><TH>A</TH><TH>B</TH></TR>\r\n<TR><TD>data-inkkit-reference 雪</TD><TD title="data-inkkit-comment">é</TD></TR></TABLE>',
    '| A                       | B  |\n| :---------------------- | :- |\n| data-inkkit-reference 雪 | é |\n',
  ],
  [
    'unsupported image table',
    '<table><caption>雪</caption><tr><td><img/src="opaque:source" alt="é"></td><td>cell<!--private--></td></tr></table>',
    '<table><caption>雪</caption><tr><td><img/src="opaque:source" alt="é"></td><td>cell</td></tr></table>\n',
  ],
] as const)
  test(`paste and drop save and reopen the same ${name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    for (const via of ['paste', 'drop'] as const) {
      await page.evaluate(() =>
        window.inkkitPlayground.replaceDocument('', 'md'),
      )
      await page.locator('.ProseMirror.editor').click()
      await page.locator('.ProseMirror.editor').evaluate(
        (root, { html, via }) => {
          const data = new DataTransfer()
          data.setData('text/plain', 'fallback')
          data.setData('text/html', html)
          const box = root.getBoundingClientRect()
          root.dispatchEvent(
            via === 'paste'
              ? new ClipboardEvent('paste', {
                  clipboardData: data,
                  bubbles: true,
                  cancelable: true,
                })
              : new DragEvent('drop', {
                  dataTransfer: data,
                  clientX: box.left + 8,
                  clientY: box.top + 8,
                  bubbles: true,
                  cancelable: true,
                }),
          )
        },
        { html, via },
      )
      await expect
        .poll(async () => (await observe(page)).snapshot!.text)
        .toBe(expected)
      const saved = (await observe(page)).snapshot!.text
      expect(saved).toBe(expected)
      expect((await observe(page)).diagnostics).toEqual([])
      await operation(page, 'undo')
      expect((await observe(page)).snapshot!.text).toBe('')
      await operation(page, 'reload', { text: saved })
      expect((await observe(page)).snapshot!.text).toBe(saved)
    }
  })
