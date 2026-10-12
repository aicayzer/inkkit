import type { Page } from '@playwright/test'
import { test, expect, observe } from './fixtures'

async function openEmpty(page: Page) {
  await page.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.evaluate(() => window.inkkitPlayground.replaceDocument('', 'md'))
  await page.locator('.ProseMirror.editor').click()
}

async function pasteHTML(page: Page, html: string, text = 'plain') {
  await page.evaluate(
    ({ html, text }) => {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      data.setData('text/html', html)
      document.querySelector('.ProseMirror.editor')!.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { html, text },
  )
}

test('a copied web article pastes as Markdown rather than raw HTML', async ({
  page,
}) => {
  await openEmpty(page)
  await pasteHTML(
    page,
    `<html><head><meta charset='utf-8'><title>Article</title><style>p{color:red}</style></head><body><!--StartFragment--><h2>Notes</h2><p>H<sub>2</sub>O is <u>essential</u> on <time datetime="2026-10-01">1 October</time>.</p><figure><figcaption>A <abbr title="figure">fig</abbr> caption</figcaption></figure><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled checked> Done</li><li class="task-list-item"><input type="checkbox" disabled> To do</li></ul><dl><dt>Term</dt><dd>Meaning</dd></dl><!--EndFragment--></body></html>`,
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      '## Notes\n\nH2O is essential on 1 October.\n\nA fig caption\n\n- [x] Done\n- [ ] To do\n\n**Term**\n\nMeaning\n',
    )
  await expect(page.locator('.ProseMirror pre.literal-markdown')).toHaveCount(0)
  await expect(
    page.locator('.ProseMirror li[data-item-type="task"]'),
  ).toHaveCount(2)
})

test('elements that remain opaque are still preserved as source', async ({
  page,
}) => {
  await openEmpty(page)
  await pasteHTML(
    page,
    '<p>Before</p><custom-widget><u>kept</u></custom-widget><svg><title>Icon</title></svg><p>After</p>',
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      'Before\n\n<custom-widget><u>kept</u></custom-widget>\n\n<svg><title>Icon</title></svg>\n\nAfter\n',
    )
})

test('pretty-printed page HTML pastes without indentation entities', async ({
  page,
}) => {
  await openEmpty(page)
  await pasteHTML(
    page,
    '<article>\n  <p>\n    Indented   text\n    on two lines.\n  </p>\n  <ul>\n    <li>\n      <input type="checkbox" checked>\n      parent\n      <ul>\n        <li>\n          child\n        </li>\n      </ul>\n    </li>\n  </ul>\n  <pre><code>keep   this\n  as is</code></pre>\n</article>',
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      'Indented text on two lines.\n\n- [x] parent\n  - child\n\n```\nkeep   this\n  as is\n```\n',
    )
})

test('a table kept as source does not load the images in its cells', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('probe.invalid')) requests.push(request.url())
  })
  await openEmpty(page)
  await pasteHTML(
    page,
    '<p>Before</p><table><tr><th colspan="2">A</th></tr><tr><td><img src="https://probe.invalid/cell.png" alt="cell"></td><td>b</td></tr></table>',
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toContain('<table>')
  await page.waitForTimeout(500)
  expect(requests).toEqual([])
})

test('a table inside a literal element keeps its source in the saved document', async ({
  page,
}) => {
  await openEmpty(page)
  const details =
    '<details><summary>s</summary><table><tbody><tr><th>Name</th></tr><tr><td><u>x</u> <input type="checkbox"></td></tr></tbody></table></details>'
  await pasteHTML(page, `<p>Before</p>${details}`)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(`Before\n\n${details}\n`)
})

test('a table inside a literal element does not load the images in its cells', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('probe.invalid')) requests.push(request.url())
  })
  await openEmpty(page)
  await pasteHTML(
    page,
    '<p>Before</p><details><summary>s</summary><table><tbody><tr><th colspan="2">A</th></tr><tr><td><img src="https://probe.invalid/cell.png" alt="cell"></td><td>b</td></tr></tbody></table></details>',
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toContain('<details>')
  await page.waitForTimeout(500)
  expect(requests).toEqual([])
})

test('a checkbox in a table cell keeps its checked state', async ({ page }) => {
  await openEmpty(page)
  const table =
    '<table><tbody><tr><th>Done</th></tr><tr><td><input type="checkbox" checked=""></td></tr><tr><td><input type="checkbox"></td></tr></tbody></table>'
  await pasteHTML(page, `<p>Intro</p>${table}`)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(`Intro\n\n${table}\n`)
})
