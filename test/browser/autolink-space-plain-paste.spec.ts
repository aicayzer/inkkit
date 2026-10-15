import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })

async function caret(page: Page, marker: string) {
  const readable = (await operation(page, 'textSnapshot')) as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker) + marker.length
  expect(at).toBeGreaterThanOrEqual(marker.length)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

async function roundTrip(page: Page, expected: string) {
  const before = await observe(page)
  expect(before.diagnostics).toEqual([])
  expect(before.snapshot!.text).toBe(expected)
  const html = await editor(page).innerHTML()
  await operation(page, 'reload', { text: expected })
  expect((await observe(page)).snapshot!.text).toBe(expected)
  expect(await editor(page).innerHTML()).toBe(html)
}

for (const typed of ['(www.example.com)', '[a](http://x.com)'])
  test(`a trailing space after ${typed} saves and reopens @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', {
      text: typed.startsWith('[') ? 'Start \\[a](http://x.com)\n' : 'Start\n',
    })
    await caret(page, typed.startsWith('[') ? ')' : 'Start')
    if (!typed.startsWith('[')) await page.keyboard.type(` ${typed}`)
    expect((await observe(page)).diagnostics).toEqual([])
    await page.keyboard.press('Space')
    expect((await observe(page)).diagnostics).toEqual([])
    await page.keyboard.type('b')
    const saved = typed.startsWith('[') ? '\\[a](http://x.com)' : typed
    await roundTrip(page, `Start ${saved} b\n`)
  })

test('plain-text paste containing an address saves and reopens @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'Start\n' })
  await caret(page, 'Start')
  expect(
    await operation(page, 'pastePlain', { text: ' see http://x.com' }),
  ).toBe(true)
  await roundTrip(page, 'Start see http://x.com\n')
})

for (const eol of ['\n', '\r\n'])
  for (const punctuation of [')', ').'])
    for (const middle of [false, true])
      test(`space after ${punctuation}, ${middle ? 'middle' : 'end'}, ${JSON.stringify(eol)} @preservation`, async ({
        page,
        openFixture,
      }) => {
        await openFixture()
        const prefix = `# Keep &copy;${eol}${eol}`
        const suffix = `${eol}${eol}+   untouched é${eol}`
        const body = `Start (www.example.com${punctuation}`
        const tail = middle ? 'after' : ''
        const source = `${prefix}${body}${tail}${suffix}`
        await operation(page, 'reload', { text: source })
        expect((await observe(page)).snapshot!.text).toBe(source)
        await caret(page, punctuation)
        await page.keyboard.press('Space')
        expect((await observe(page)).diagnostics).toEqual([])
        const spaced = middle
          ? `${body} after`
          : `Start ([www.example.com](http://www.example.com)${punctuation}&#x20;`
        expect((await observe(page)).snapshot!.text).toBe(
          `${prefix}${spaced}${suffix}`,
        )
        await page.keyboard.type('b')
        const saved = `${prefix}${body} b${tail}${suffix}`
        expect((await observe(page)).snapshot!.text).toBe(saved)
        await page.keyboard.press('ControlOrMeta+z')
        expect((await observe(page)).snapshot!.text).toBe(source)
        await operation(page, 'redo')
        await roundTrip(page, saved)
      })

// Use the browser's actual clipboard and paste event. A host routes a literal
// paste to pasteAsPlainText because the ordinary paste command imports Markdown.
async function copyForPaste(page: Page, text: string, literal: boolean) {
  await page.evaluate(
    ({ text, literal }) => {
      const textarea = document.createElement('textarea')
      textarea.id = 'clipboard-source'
      textarea.value = text
      document.body.append(textarea)
      textarea.select()
      if (literal) {
        document
          .querySelector('[aria-label="Formatted Markdown editor"]')!
          .addEventListener(
            'paste',
            (input) => {
              const event = input as ClipboardEvent
              event.preventDefault()
              event.stopImmediatePropagation()
              document.body.dataset.trustedPaste = String(event.isTrusted)
              void window.inkkitPlayground
                .operation('pastePlain', {
                  text: event.clipboardData!.getData('text/plain'),
                })
                .then(
                  (result) => {
                    document.body.dataset.pasteResult = String(result)
                  },
                  (error) => {
                    document.body.dataset.pasteResult = String(error)
                  },
                )
            },
            { capture: true, once: true },
          )
      }
    },
    { text, literal },
  )
  await page.keyboard.press('ControlOrMeta+c')
  await page.locator('#clipboard-source').evaluate((node) => node.remove())
}

for (const literal of [false, true])
  for (const [text, saved] of [
    [' see http://x.com', ' see http://x.com'],
    [' (www.example.com).', ' (www.example.com).'],
  ])
    test(`real ${literal ? 'literal' : 'ordinary'} paste of ${text} with CRLF and undo @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      const source = 'Start\r\n\r\n+   unchanged é\r\n'
      await operation(page, 'reload', { text: source })
      await copyForPaste(page, text!, literal)
      await caret(page, 'Start')
      await page.keyboard.press('ControlOrMeta+v')
      if (literal) {
        await expect(page.locator('body')).toHaveAttribute(
          'data-paste-result',
          'true',
        )
        await expect(page.locator('body')).toHaveAttribute(
          'data-trusted-paste',
          'true',
        )
      }
      const expected = `Start${saved}\r\n\r\n+   unchanged é\r\n`
      await expect
        .poll(async () => (await observe(page)).snapshot!.text)
        .toBe(expected)
      await page.keyboard.press('ControlOrMeta+z')
      expect((await observe(page)).snapshot!.text).toBe(source)
      await operation(page, 'redo')
      await roundTrip(page, expected)
    })

for (const action of ['typing', 'paste'] as const)
  test(`${action} an address inside code stays unlinked @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: 'Code `here` end\n' })
    if (action === 'paste') await copyForPaste(page, ' http://x.com', true)
    await caret(page, 'her')
    if (action === 'typing') await page.keyboard.type(' http://x.com')
    else {
      await page.keyboard.press('ControlOrMeta+v')
      await expect(page.locator('body')).toHaveAttribute(
        'data-paste-result',
        'true',
      )
    }
    await expect(editor(page).locator('a')).toHaveCount(0)
    await roundTrip(page, 'Code `her http://x.come` end\n')
  })
