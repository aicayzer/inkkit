import { test, expect, operation, observe } from './fixtures'

const html =
  '<p><b>Bold</b> and <a href="https://example.com">a link</a></p><ul><li>item</li></ul>'
const text = 'Bold and a link\n**item**'

async function pasteInto(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('textbox', { name, exact: true }).evaluate(
    (element, { html, text }) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      data.setData('text/html', html)
      data.setData('text/markdown', '# Markdown flavor')
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      )
    },
    { html, text },
  )
}

test('the plainText route makes a real paste literal in both modes', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'before\n\ntarget\n'
  const results: Record<string, string> = {}
  for (const route of ['formatted', 'plainText', 'facade'] as const) {
    await operation(page, 'reload', { text: source })
    await operation(page, 'textInput', {
      preferences: route === 'plainText' ? { paste: 'plainText' } : {},
    })
    expect(await operation(page, 'find', { text: 'target' })).toBe(true)
    if (route === 'facade') await operation(page, 'pastePlain', { text })
    else await pasteInto(page, 'Formatted Markdown editor')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .not.toBe(source)
    results[route] = (await observe(page)).snapshot!.text
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(source)
  }
  expect(results.formatted).toContain('**Bold**')
  expect(results.plainText).toBe(results.facade)
  expect(results.plainText).not.toContain('**Bold**')

  await operation(page, 'reload', { text: source })
  await operation(page, 'textInput', { preferences: { paste: 'plainText' } })
  await operation(page, 'editingMode', { mode: 'source' })
  expect(await operation(page, 'find', { text: 'target' })).toBe(true)
  await pasteInto(page, 'Markdown source editor')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(`before\n\n${text}\n`)
})
