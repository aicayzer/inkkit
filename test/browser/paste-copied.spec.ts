import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

async function load(page: Page, source: string) {
  await page.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.evaluate(
    (source) => window.inkkitPlayground.replaceDocument(source, 'md'),
    source,
  )
  await page.locator('.ProseMirror.editor').click()
}

// Dispatches a copy event and returns what the editor wrote to it.
async function copy(page: Page): Promise<{ text: string; html: string }> {
  return page.evaluate(() => {
    const data = new DataTransfer()
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
    return {
      text: data.getData('text/plain'),
      html: data.getData('text/html'),
    }
  })
}

async function transfer(
  page: Page,
  via: 'paste' | 'drop',
  clipboard: { text: string; html: string },
) {
  await page.evaluate(
    ({ via, clipboard }) => {
      const editor = document.querySelector('.ProseMirror.editor')!
      const data = new DataTransfer()
      data.setData('text/plain', clipboard.text)
      data.setData('text/html', clipboard.html)
      const box = editor.getBoundingClientRect()
      editor.dispatchEvent(
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
    { via, clipboard },
  )
}

test('a copy from the editor pastes back with its references and footnotes', async ({
  page,
}) => {
  const source =
    '[One][Ref] and [Two][Ref] with a note[^n]\n\n[Ref]: https://example.com/\n\n[^n]: Note **body**\n'
  await load(page, source)
  await page.keyboard.press('ControlOrMeta+a')
  const copied = await copy(page)
  expect(copied.html).not.toBe('')
  await load(page, '')
  await transfer(page, 'paste', copied)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(source)
})

test('a copied diagram pastes back as its source', async ({ page }) => {
  const source = 'First\n\n```mermaid\ngraph TD; A-->B\n```\n'
  await load(page, source)
  const copied = (await operation(page, 'clipboard')) as {
    text: string
    html: string
  }
  expect(copied.html).toContain('data-inkkit-mermaid')
  await load(page, '')
  await transfer(page, 'paste', copied)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(source)
})

for (const via of ['paste', 'drop'] as const)
  test(`pasted or dropped HTML saves the content it shows (${via})`, async ({
    page,
  }) => {
    await load(page, '')
    const described = [
      '[other](https://other.example/)',
      '[docs][d]',
      '[d]: https://other.example/',
      '<div>block</div>',
    ]
      .join('&#10;&#10;')
      .replace(/</g, '&lt;')
    await transfer(page, via, {
      text: 'Shown text, here.',
      html: `<p>Shown text, <span data-inkkit-markdown="${described}">here</span>.</p>`,
    })
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe('Shown text, here.\n')
  })

test('HTML comments in pasted HTML are left out', async ({ page }) => {
  await load(page, '')
  await transfer(page, 'paste', {
    text: 'Shown text',
    html: '<p>Shown<!--note--> text</p><!--note-->',
  })
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('Shown text\n')
  await page.evaluate(() =>
    window.inkkitPlayground.operation('commentsVisible', { visible: true }),
  )
  expect((await observe(page)).snapshot!.text).not.toContain('note')
})
