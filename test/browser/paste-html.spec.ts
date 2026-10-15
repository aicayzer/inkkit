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
  await expect(
    page.locator('.ProseMirror pre.inkkit-literal-markdown'),
  ).toHaveCount(0)
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

test('a pasted table with formatted text in its cells saves plain spaces', async ({
  page,
}) => {
  await openEmpty(page)
  await pasteHTML(
    page,
    '<table><tr><th>h</th><th>i</th></tr><tr><td><b>z</b> w</td><td><code>a</code> c</td></tr><tr><td>w <b>z</b></td><td><em>z</em> w</td></tr></table>',
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      '| h       | i     |\n| :------ | :---- |\n| **z** w | `a` c |\n| w **z** | *z* w |\n',
    )
})

test('code copied from an editor keeps its indentation', async ({ page }) => {
  await openEmpty(page)
  await pasteHTML(
    page,
    '<div style="white-space: pre"><div><span>    </span><span>return</span><span> x</span></div></div><p>Run <span style="WHITE-SPACE : pre !important">  a  b</span></p>',
  )
  await expect
    .poll(async () =>
      (await observe(page)).snapshot!.text.replace(/&#x20;/g, ' '),
    )
    .toBe('    return x\n\nRun   a  b\n')
})

test('HTML from WebKit pastes its converted spaces as ordinary spaces', async ({
  page,
}) => {
  await openEmpty(page)
  const style =
    'style="caret-color: rgb(0, 0, 0); font-family: Times; white-space: normal;"'
  const space = '<span class="Apple-converted-space">&nbsp;</span>'
  await pasteHTML(
    page,
    `<meta charset='utf-8'><a href="https://example.com" ${style}>The quote</a><span ${style}>${space}for the record. See${space}</span><a href="https://example.com/b" ${style}>this</a><span ${style}>${space}and <code>a${space}b</code>, but keep&nbsp;this.</span>`,
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      '[The quote](https://example.com) for the record. See [this](https://example.com/b) and `a b`, but keep this.\n',
    )
})

test('text copied from a page pastes with ordinary spaces beside links', async ({
  page,
}) => {
  await openEmpty(page)
  // The browser itself writes the clipboard HTML here, so WebKit's own
  // rewrite of the spaces reaches the editor.
  await page.evaluate(() => {
    const source = document.createElement('div')
    source.id = 'copy-source'
    source.innerHTML =
      '<p><a href="https://example.com/a">The quote</a> for the record</p><p>See <a href="https://example.com/b">the quote</a> now</p><p>Run <code>pnpm check</code> first</p>'
    document.body.append(source)
    // A person's click elsewhere blurs the editor. A focused editor can write
    // its own selection back over this one before the copy key arrives.
    ;(document.activeElement as HTMLElement | null)?.blur()
    const range = document.createRange()
    range.selectNodeContents(source)
    const selection = getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.press('ControlOrMeta+C')
  await page.locator('.ProseMirror.editor').click()
  await page.keyboard.press('ControlOrMeta+V')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      '[The quote](https://example.com/a) for the record\n\nSee [the quote](https://example.com/b) now\n\nRun `pnpm check` first\n',
    )
})

test('pasted links with a script scheme keep their text without the link', async ({
  page,
}) => {
  await openEmpty(page)
  await pasteHTML(
    page,
    '<p>Do <a href="javascript:void(0)">not run</a>, <a href="&#106;avascript:void(0)">not this</a>, <a href="data:text/html,x">or data</a>, but <a href="https://example.com/">open</a> and <a href="mailto:ada@example.com">write</a>.</p>',
  )
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(
      'Do not run, not this, or data, but [open](https://example.com/) and [write](mailto:ada@example.com).\n',
    )
  await expect(page.locator('.ProseMirror a')).toHaveCount(2)
})

async function dropHTML(page: Page, html: string) {
  await page.evaluate((html) => {
    const editor = document.querySelector('.ProseMirror.editor')!
    const box = editor.getBoundingClientRect()
    const data = new DataTransfer()
    data.setData('text/plain', 'plain')
    data.setData('text/html', html)
    editor.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: data,
        clientX: box.left + 8,
        clientY: box.top + 8,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, html)
}

for (const via of ['paste', 'drop'] as const)
  test(`pasted or dropped HTML saves only structure that reads back the same (${via})`, async ({
    page,
  }) => {
    await openEmpty(page)
    const html =
      '<p>a</p><pre class="inkkit-literal-markdown">&lt;b&gt;x&lt;/b&gt; [l](javascript:void(0))</pre><p>b<span data-inkkit-comment="obsidian">see [l](javascript:void(0))</span></p><p>Visit https://example.com/ now</p>'
    if (via === 'paste') await pasteHTML(page, html)
    else await dropHTML(page, html)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(
        'a\n\n```\n<b>x</b> [l](javascript:void(0))\n```\n\nbsee \\[l]\\(javascript:void(0))\n\nVisit https://example.com/ now\n',
      )
    await expect(
      page.locator('.ProseMirror pre.inkkit-literal-markdown'),
    ).toHaveCount(0)
  })

test('a drop and a paste of the same HTML save the same Markdown', async ({
  page,
}) => {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  for (const html of [
    '<p>Read <a href="https://example.com/">the notes</a> and <a href="javascript:void(0)">this</a>.</p>',
    `<p>Before</p><p><img src="${pixel}" alt="Pixel"></p><p>After</p>`,
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    '<p>Before</p><x-widget title="t">kept</x-widget><p>After</p>',
    '<ol><li>a</li></ol><ol start="5"><li>b</li></ol>',
    '<ol><li>a<ol><li>b</li></ol></li></ol>',
    '<p>a</p><pre><code></code></pre><p>b</p>',
  ]) {
    await openEmpty(page)
    await pasteHTML(page, html)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text, { message: html })
      .not.toBe('')
    const pasted = (await observe(page)).snapshot!.text
    await openEmpty(page)
    await dropHTML(page, html)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text, { message: html })
      .toBe(pasted)
  }
})

// Drops HTML with the pointer at a fraction of the height of the element the
// selector names, inside the editor.
async function dropHTMLOn(
  page: Page,
  html: string,
  selector: string,
  fraction: number,
) {
  await page.evaluate(
    ({ html, selector, fraction }) => {
      const editor = document.querySelector('.ProseMirror.editor')!
      const box = editor.querySelector(selector)!.getBoundingClientRect()
      const data = new DataTransfer()
      data.setData('text/plain', 'Dropped')
      data.setData('text/html', html)
      editor.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: data,
          clientX: box.left + Math.min(40, box.width / 2),
          clientY: box.top + box.height * fraction,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { html, selector, fraction },
  )
}

for (const [name, source, selector, fraction, kept] of [
  ['beside a rule', 'First\n\n---\n\nLast\n', 'hr', 0.5, '---'],
  ['above a rule', 'First\n\n---\n\nLast\n', 'hr', 0, '---'],
  [
    'beside an image',
    'First\n\n![Photo](images/photo.png)\n\nLast\n',
    '.inkkit-image-block',
    0.5,
    '![Photo](images/photo.png)',
  ],
  [
    'on a code block',
    'First\n\n```\nlet x = 1\n```\n\nLast\n',
    'pre',
    0.5,
    '```\nlet x = 1\n```',
  ],
  [
    'on the top edge of a table',
    'First\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nLast\n',
    'table',
    0.05,
    '| A | B |',
  ],
  [
    'in the middle of a paragraph',
    'First words here\n\nLast\n',
    'p',
    0.5,
    'First words here',
  ],
  ['beside an empty heading', 'First\n\n#\n\nLast\n', 'h1', 0.5, '\n#\n'],
  [
    'beside an empty code block',
    'First\n\n```\n```\n\nLast\n',
    'pre',
    0.5,
    '```\n```',
  ],
] as const)
  test(`a drop ${name} inserts blocks without changing what is there`, async ({
    page,
  }) => {
    await openEmpty(page)
    await page.evaluate(
      (source) => window.inkkitPlayground.replaceDocument(source, 'md'),
      source,
    )
    await dropHTMLOn(page, '<p>Dropped <b>here</b></p>', selector, fraction)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toContain('Dropped **here**')
    const text = (await observe(page)).snapshot!.text
    expect(text).toContain(kept)
    expect(text).toContain('First')
    expect(text).toContain('Last')
    expect(text).toMatch(/^Dropped \*\*here\*\*$/m)
  })

for (const html of [
  '<span>end of para</span><p>next para</p>',
  'Lead text<ul><li>a</li></ul>',
  '<b>x</b><p>p</p>',
])
  test(`a drop of inline content followed by a block keeps both: ${html}`, async ({
    page,
  }) => {
    await openEmpty(page)
    await page.evaluate(() =>
      window.inkkitPlayground.replaceDocument('First\n\nLast\n', 'md'),
    )
    await pasteHTML(page, html)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .not.toBe('First\n\nLast\n')
    await page.evaluate(() =>
      window.inkkitPlayground.replaceDocument('First\n\nLast\n', 'md'),
    )
    await dropHTMLOn(page, html, 'p', 0.5)
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toMatch(html.includes('<ul>') ? /Lead text\n\n- a/ : /end of para|x\*\*/)
    const text = (await observe(page)).snapshot!.text
    expect(text).toMatch(/^First$/m)
    expect(text).toMatch(/^Last$/m)
  })

test('typing after a drop continues after the dropped content', async ({
  page,
}) => {
  await openEmpty(page)
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument('First\n\nLast\n', 'md'),
  )
  await dropHTMLOn(page, '<p>Dropped</p>', 'p', 0.5)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toContain('Dropped')
  await page.keyboard.type(' typed')
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe('First\n\nDropped typed\n\nLast\n')
})

for (const via of ['paste', 'drop'] as const)
  for (const [html, kept] of [
    ['<p>a</p><hr>', /^a\n\n---\n/],
    [
      '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>',
      /\| A +\|[\s\S]*\| 1 +\|/,
    ],
  ] as const)
    test(`typing after a ${via} of ${html} keeps what was inserted`, async ({
      page,
    }) => {
      await openEmpty(page)
      if (via === 'paste') await pasteHTML(page, html)
      else await dropHTML(page, html)
      await expect
        .poll(async () => (await observe(page)).snapshot!.text)
        .toMatch(kept)
      await page.keyboard.type('Z')
      await expect
        .poll(async () => (await observe(page)).snapshot!.text)
        .toContain('Z')
      expect((await observe(page)).snapshot!.text).toMatch(kept)
    })
