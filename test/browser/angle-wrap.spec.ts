import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'
import { wrapCases } from '../angle-wrap-cases'

interface Readable {
  snapshotId: string
  text: string
}

// Puts the caret at `offset` of the readable text; the edit itself uses real keys.
async function caretAt(page: Page, find: (text: string) => number) {
  const readable = (await operation(page, 'textSnapshot')) as Readable
  const offset = find(readable.text)
  expect(offset).toBeGreaterThanOrEqual(0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: offset, to: offset },
    options: { focus: true },
  })
}

const saved = async (page: Page) => (await observe(page)).snapshot!.text

async function wrap(page: Page, address: string) {
  await caretAt(page, (text) => text.indexOf(address))
  await page.keyboard.type('<')
  await caretAt(page, (text) => text.indexOf(address) + address.length)
  await page.keyboard.type('>')
}

for (const { name, source, address, first, expected } of wrapCases)
  test(`wrapping ${name} in angle brackets saves the angle link @preservation`, async ({
    page,
    openFixture,
  }, testInfo) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    expect(await saved(page)).toBe(source)
    if (first) {
      await caretAt(
        page,
        (text) => text.indexOf(first.after) + first.after.length,
      )
      await page.keyboard.type(first.typed)
      expect((await observe(page)).diagnostics).toEqual([])
    }
    await wrap(page, address)
    const before = await observe(page)
    const content = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    const result = before.snapshot!.text
    await operation(page, 'reload', { text: result })
    const reopened = (await operation(page, 'clipboard', {
      scope: 'document',
    })) as { text: string; html: string }
    const semanticHTML = (html: string) =>
      html.replace(/ data-inkkit-link-form="[^"]*"/g, '')
    await testInfo.attach('saved-bytes', {
      body: JSON.stringify({ name, result, diagnostics: before.diagnostics }),
      contentType: 'application/json',
    })
    expect(before.diagnostics).toEqual([])
    expect(result).toBe(expected)
    expect(reopened.text).toBe(content.text)
    expect(semanticHTML(reopened.html)).toBe(semanticHTML(content.html))
    expect(await saved(page)).toBe(expected)
  })

for (const key of ['Backspace', 'ControlOrMeta+z'])
  test(`${key} straight after wrapping a loaded address keeps the edit history @preservation`, async ({
    page,
    openFixture,
  }) => {
    const source = 'see https://x.com now\n'
    await openFixture()
    await operation(page, 'reload', { text: source })
    await wrap(page, 'https://x.com')
    expect(await saved(page)).toBe('see <https://x.com> now\n')
    await page.keyboard.press(key)
    if (key === 'Backspace') {
      expect(await saved(page)).toBe('see <https://x.co> now\n')
    } else {
      // The two keystrokes may be one undo step or two.
      for (let step = 0; step < 2 && (await saved(page)) !== source; step++)
        await page.keyboard.press(key)
      expect(await saved(page)).toBe(source)
      await operation(page, 'redo')
      await operation(page, 'redo')
      expect(await saved(page)).toBe('see <https://x.com> now\n')
    }
    expect((await observe(page)).diagnostics).toEqual([])
  })

// The reverse: the same address typed over a loaded angle link, or its link
// removed, saves it without the brackets.
test('typing an address over a loaded angle link saves it bare @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'see <https://x.com> now\n' })
  const readable = (await operation(page, 'textSnapshot')) as Readable
  const from = readable.text.indexOf('https://x.com')
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from, to: from + 13 },
    options: { focus: true },
  })
  await page.keyboard.type('https://x.com')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('see https://x.com now\n')
  await operation(page, 'reload', { text: observed.snapshot!.text })
  expect(await saved(page)).toBe('see https://x.com now\n')
})

test('a loaded angle link and the blocks around it keep their bytes when left alone @preservation', async ({
  page,
  openFixture,
}) => {
  const source =
    'Untouched &copy;\r\n\r\nsee <https://x.com> now\r\n\r\n+ other\r\n'
  await openFixture()
  await operation(page, 'reload', { text: source })
  expect(await saved(page)).toBe(source)
  expect((await observe(page)).diagnostics).toEqual([])
})
