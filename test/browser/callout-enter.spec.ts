import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })

// Places the caret before or after `marker` in the readable text.
async function caret(page: Page, marker: string, after: boolean) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker) + (after ? marker.length : 0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

// The block outline of the document, with each callout's paragraphs inside it.
const outline = (page: Page) =>
  editor(page).evaluate((root) => {
    const describe = (element: Element): string => {
      const own =
        element.getAttribute('data-inkkit-callout') ??
        element.tagName.toLowerCase()
      const body = element.matches('[data-inkkit-callout]')
        ? element.querySelector(':scope > .inkkit-callout-body')!
        : element
      const children = [...body.children].filter((child) =>
        /^(P|BLOCKQUOTE|UL|OL|LI)$/.test(child.tagName),
      )
      return children.length
        ? `${own}(${children.map(describe).join(' ')})`
        : own
    }
    return [...root.children].map(describe).join(' ')
  })

// [what, source, caret marker, caret after it, keys, saved, outline]
const edits: [string, string, string, boolean, string[], string, string][] = [
  [
    'Enter at the end of an untitled callout',
    '> [!NOTE]\n> b two\n',
    'two',
    true,
    ['Enter'],
    '> [!NOTE]\n> b two\n>\n> <br />\n',
    'NOTE(p p)',
  ],
  [
    'Enter and typing at the end of an untitled callout',
    '> [!NOTE]\n> b two\n',
    'two',
    true,
    ['Enter', 'next'],
    '> [!NOTE]\n> b two\n>\n> next\n',
    'NOTE(p p)',
  ],
  [
    'Enter in the middle of a callout',
    '> [!NOTE]\n> first second\n>\n> after\n',
    'second',
    false,
    ['Enter'],
    '> [!NOTE]\n> first&#x20;\n>\n> second\n>\n> after\n',
    'NOTE(p p p)',
  ],
  [
    'Enter twice at the end of a callout',
    '> [!NOTE]\n> b two\n',
    'two',
    true,
    ['Enter', 'Enter'],
    '> [!NOTE]\n> b two\n\n<br />\n',
    'NOTE(p) p',
  ],
  [
    'Enter twice and typing at the end of a callout',
    '> [!NOTE]\n> b two\n\nlast\n',
    'two',
    true,
    ['Enter', 'Enter', 'next'],
    '> [!NOTE]\n> b two\n\nnext\n\nlast\n',
    'NOTE(p) p p',
  ],
  [
    'Enter twice at the end of a CRLF callout',
    '> [!NOTE]\r\n> b two\r\n',
    'two',
    true,
    ['Enter', 'next', 'Enter', 'Enter', 'after'],
    '> [!NOTE]\r\n> b two\r\n>\r\n> next\r\n\r\nafter\r\n',
    'NOTE(p p) p',
  ],
  [
    'Enter twice in the middle of a callout, which splits it as it splits a quote',
    '> [!NOTE] Title\n> a\n>\n> b\n',
    'a',
    true,
    ['Enter', 'Enter'],
    '> [!NOTE] Title\n> a\n\n> [!NOTE] Title\n> <br />\n>\n> b\n',
    'NOTE(p) NOTE(p p)',
  ],
  [
    'Enter at the end of a titled callout',
    '> [!TIP] Tips &amp; tricks\n> b two\n',
    'two',
    true,
    ['Enter', 'next'],
    '> [!TIP] Tips &amp; tricks\n> b two\n>\n> next\n',
    'TIP(p p)',
  ],
  [
    'Enter twice at the end of a titled callout',
    '> [!tip] Custom title\n> b two\n',
    'two',
    true,
    ['Enter', 'Enter', 'next'],
    '> [!tip] Custom title\n> b two\n\nnext\n',
    'TIP(p) p',
  ],
  [
    'Enter at the end of an expanded foldable callout',
    '> [!WARNING]+ Folded\n> b two\n',
    'two',
    true,
    ['Enter', 'next'],
    '> [!WARNING]+ Folded\n> b two\n>\n> next\n',
    'WARNING(p p)',
  ],
  [
    'Enter in a callout list item',
    '> [!NOTE]\n> - one\n> - two\n',
    'two',
    true,
    ['Enter', 'three'],
    '> [!NOTE]\n> - one\n> - two\n> - three\n',
    'NOTE(ul(li(p) li(p) li(p)))',
  ],
  [
    'Enter twice in a callout list item',
    '> [!NOTE]\n> - one\n> - two\n',
    'two',
    true,
    ['Enter', 'Enter', 'next'],
    '> [!NOTE]\n> - one\n> - two\n>\n> next\n',
    'NOTE(ul(li(p) li(p)) p)',
  ],
  [
    'Enter three times in a callout list item',
    '> [!NOTE]\n> - one\n> - two\n',
    'two',
    true,
    ['Enter', 'Enter', 'Enter', 'next'],
    '> [!NOTE]\n> - one\n> - two\n\nnext\n',
    'NOTE(ul(li(p) li(p))) p',
  ],
  [
    'Enter in a quote inside a callout',
    '> [!NOTE]\n> > inner\n',
    'inner',
    true,
    ['Enter', 'next'],
    '> [!NOTE]\n> > inner\n> >\n> > next\n',
    'NOTE(blockquote(p p))',
  ],
  [
    'Enter twice in a quote inside a callout',
    '> [!NOTE]\n> > inner\n',
    'inner',
    true,
    ['Enter', 'Enter', 'next'],
    '> [!NOTE]\n> > inner\n>\n> next\n',
    'NOTE(blockquote(p) p)',
  ],
  [
    'Enter in a callout inside a quote',
    '> > [!NOTE]\n> > b two\n',
    'two',
    true,
    ['Enter', 'next'],
    '> > [!NOTE]\n> > b two\n> >\n> > next\n',
    'blockquote(NOTE(p p))',
  ],
  [
    'Enter twice in a callout inside a quote',
    '> > [!NOTE]\n> > b two\n',
    'two',
    true,
    ['Enter', 'Enter', 'next'],
    '> > [!NOTE]\n> > b two\n>\n> next\n',
    'blockquote(NOTE(p) p)',
  ],
]

for (const [what, source, marker, after, keys, saved, shape] of edits)
  test(`${what} saves text that reopens identically @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, marker, after)
    for (const key of keys)
      if (key === 'Enter') await page.keyboard.press(key)
      else await page.keyboard.type(key)
    let observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(saved)
    expect(await outline(page)).toBe(shape)
    await operation(page, 'reload', { text: saved })
    observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(saved)
    expect(await outline(page)).toBe(shape)
  })

test('Enter in a folded callout opened by its button stays inside it @preservation', async ({
  page,
  openFixture,
}) => {
  const source = '> [!CAUTION]- Folded\n> b two\n'
  await openFixture()
  await operation(page, 'reload', { text: source })
  const toggle = editor(page).locator('[data-inkkit-callout-toggle]')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await caret(page, 'two', true)
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  const saved = '> [!CAUTION]- Folded\n> b two\n>\n> next\n'
  expect(observed.snapshot!.text).toBe(saved)
  expect(await outline(page)).toBe('CAUTION(p p)')
  await operation(page, 'reload', { text: saved })
  expect((await observe(page)).snapshot!.text).toBe(saved)
  expect(await outline(page)).toBe('CAUTION(p p)')
})

// [what, source, caret before, saved, outline]
const backspaces: [string, string, string, string, string][] = [
  [
    'lifts the first paragraph out of a callout below a paragraph',
    'Before\n\n> [!NOTE]\n> a\n>\n> b\n',
    'a',
    'Before\n\na\n\n> [!NOTE]\n> b\n',
    'p p NOTE(p)',
  ],
  [
    'keeps the title and fold marker of the callout it lifts a paragraph from',
    'Before\n\n> [!tip]+ Tips &amp; tricks\n> a\n>\n> b\n',
    'a',
    'Before\n\na\n\n> [!tip]+ Tips &amp; tricks\n> b\n',
    'p p TIP(p)',
  ],
  [
    'lifts the first paragraph out of a callout that opens the document',
    '> [!NOTE]\n> a\n>\n> b\n',
    'a',
    'a\n\n> [!NOTE]\n> b\n',
    'p NOTE(p)',
  ],
  [
    'lifts the first paragraph out of a callout inside a quote',
    '> Before\n>\n> > [!NOTE]\n> > a\n> >\n> > b\n',
    'a',
    '> Before\n>\n> a\n>\n> > [!NOTE]\n> > b\n',
    'blockquote(p p NOTE(p))',
  ],
  [
    'does nothing in the only paragraph of a callout, which would lose its title',
    'Before\n\n> [!NOTE] Title\n> a\n',
    'a',
    'Before\n\n> [!NOTE] Title\n> a\n',
    'p NOTE(p)',
  ],
]

for (const [what, source, marker, saved, shape] of backspaces)
  test(`Backspace at the start of a callout ${what} @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, marker, false)
    await page.keyboard.press('Backspace')
    let observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(saved)
    expect(await outline(page)).toBe(shape)
    if (saved === source) {
      expect(observed.snapshot!.dirty).toBe(false)
      return
    }
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await observe(page)).snapshot)
      .toMatchObject({ text: source, dirty: false })
    await operation(page, 'reload', { text: saved })
    observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(saved)
    expect(await outline(page)).toBe(shape)
  })
