import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Bracket pairing, list continuation and indentation through a real browser's key and input
// events, which jsdom does not reproduce.

type Mode = 'formatted' | 'source'

async function open(
  page: Page,
  source: string,
  find: string,
  mode: Mode,
  preferences: Record<string, unknown> = {},
  after = true,
) {
  await operation(page, 'textInput', { preferences })
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  if (mode === 'source') await operation(page, 'editingMode', { mode })
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(find) + (after ? find.length : 0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

const saved = (page: Page) =>
  expect.poll(async () => (await observe(page)).snapshot!.text)

test.beforeEach(async ({ openFixture }) => {
  await openFixture()
})

for (const mode of ['formatted', 'source'] as const) {
  test.describe(`pairing in ${mode} mode`, () => {
    const paired = { pairBrackets: true }

    test('typing a sequence saves the same bytes with pairing on and off', async ({
      page,
    }) => {
      const sequence = '[a](b) (c [d] {e}) "f" it\'s'
      await open(page, 'x', 'x', mode)
      await page.keyboard.type(` ${sequence}`)
      const expected = (await observe(page)).snapshot!.text
      await open(page, 'x', 'x', mode, paired)
      await page.keyboard.type(` ${sequence}`)
      await saved(page).toBe(expected)
    })

    test('an opener inserts its closer, Backspace removes an empty pair, and a selection is wrapped', async ({
      page,
    }) => {
      await open(page, 'a b', 'b', mode, paired)
      await page.keyboard.type(' (')
      await saved(page).toBe('a b ()')
      await page.keyboard.press('Backspace')
      // Markdown drops the space at the end of a formatted note.
      await saved(page).toBe(mode === 'source' ? 'a b ' : 'a b')
      await open(page, 'a bcd e', 'a ', mode, paired)
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.type('(')
      await saved(page).toBe('a (bcd) e')
    })

    test('after undo and redo the brackets are ordinary: Backspace deletes the opener and a closer is typed', async ({
      page,
    }) => {
      await open(page, 'a', 'a', mode, paired)
      await page.keyboard.type('(')
      await saved(page).toBe('a()')
      await page.keyboard.press('ControlOrMeta+z')
      await saved(page).toBe('a')
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await saved(page).toBe('a()')
      await page.keyboard.press('Backspace')
      await saved(page).toBe('a)')
      await page.keyboard.type(')')
      await saved(page).toBe('a))')
    })

    test('an opener typed before a pair is an edit outside it, so a closer typed after is not swallowed', async ({
      page,
    }) => {
      await open(page, 'a', 'a', mode, paired)
      await page.keyboard.type(' (')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.type('(')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.type(')')
      await saved(page).toBe('a (())')
    })

    test('Backspace of an inner pair keeps the pair around it', async ({
      page,
    }) => {
      await open(page, 'a', 'a', mode, paired)
      await page.keyboard.type(' ([')
      await page.keyboard.press('Backspace')
      await saved(page).toBe('a ()')
      await page.keyboard.type(')')
      await saved(page).toBe('a ()')
    })

    test('an apostrophe after a letter stays single', async ({ page }) => {
      await open(page, 'don', 'don', mode, paired)
      await page.keyboard.type("'t")
      await saved(page).toBe("don't")
    })
  })
}

test.describe('source mode', () => {
  test('Return continues a list item and an empty item loses its marker', async ({
    page,
  }) => {
    await open(page, '- a\n', 'a', 'source')
    await page.keyboard.press('Enter')
    await page.keyboard.type('b')
    await saved(page).toBe('- a\n- b\n')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await saved(page).toBe('- a\n- b\n\n')
  })

  test('Return does not continue a list when the host turned it off', async ({
    page,
  }) => {
    await open(page, '- a\n', 'a', 'source', { continueLists: false })
    await page.keyboard.press('Enter')
    await saved(page).toBe('- a\n\n')
  })

  test('Tab moves focus until the host chooses an indent, then indents', async ({
    page,
  }) => {
    await open(page, 'ab\n', 'ab', 'source')
    await page.keyboard.press('Tab')
    await saved(page).toBe('ab\n')
    await open(page, 'ab\n', 'ab', 'source', {
      indent: 'spaces',
      indentWidth: 2,
    })
    await page.keyboard.press('Tab')
    await saved(page).toBe('ab  \n')
    await page.keyboard.press('Shift+Tab')
    await saved(page).toBe('ab  \n')
    await open(page, '  ab\n', 'ab', 'source', {
      indent: 'spaces',
      indentWidth: 2,
    })
    await page.keyboard.press('Shift+Tab')
    await saved(page).toBe('ab\n')
  })

  test('Escape lets the next Tab and Shift-Tab move focus out of the source', async ({
    page,
  }) => {
    await open(page, 'ab\n', 'ab', 'source', { indentWidth: 2 })
    const focused = () =>
      page.evaluate(() =>
        document.activeElement?.classList.contains('inkkit-plain'),
      )
    await page.keyboard.press('Tab')
    await saved(page).toBe('ab\t\n')
    expect(await focused()).toBe(true)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await saved(page).toBe('ab\t\n')
    expect(await focused()).toBe(false)
    await open(page, 'ab\n', 'ab', 'source', { indentWidth: 2 })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+Tab')
    await saved(page).toBe('ab\n')
    expect(await focused()).toBe(false)
    // Back in the source, Tab indents again.
    await open(page, 'ab\n', 'ab', 'source', { indentWidth: 2 })
    await page.keyboard.press('Tab')
    await saved(page).toBe('ab\t\n')
  })

  test('Return reads the Markdown around the caret', async ({ page }) => {
    await open(page, '<pre>\n- x\n</pre>\n', '- x', 'source')
    await page.keyboard.press('Enter')
    await saved(page).toBe('<pre>\n- x\n\n</pre>\n')
    await open(page, '+++\n- x\n+++\n', '- x', 'source')
    await page.keyboard.press('Enter')
    await saved(page).toBe('+++\n- x\n\n+++\n')
    await open(page, '-', '-', 'source')
    await page.keyboard.press('Enter')
    await saved(page).toBe('')
  })

  test('Tab indents a list item line and each line of a selection', async ({
    page,
  }) => {
    const preferences = { indent: 'spaces', indentWidth: 4 }
    await open(page, '- a\n- b\n', 'b', 'source', preferences)
    await page.keyboard.press('Tab')
    await saved(page).toBe('- a\n    - b\n')
    await page.keyboard.press('ControlOrMeta+z')
    await saved(page).toBe('- a\n- b\n')
    await open(page, 'x\ny\n', 'x', 'source', preferences, false)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Tab')
    await saved(page).toBe('    x\ny\n')
  })
})

test.describe('formatted mode', () => {
  test('Return in a list item adds a paragraph in it when continueLists is off', async ({
    page,
  }) => {
    await open(page, '- a\n- c\n', 'a', 'formatted', { continueLists: false })
    await page.keyboard.press('Enter')
    await page.keyboard.type('b')
    await saved(page).toBe('- a\n\n  b\n- c\n')
    await open(page, '- a\n', 'a', 'formatted')
    await page.keyboard.press('Enter')
    await page.keyboard.type('b')
    await saved(page).toBe('- a\n- b\n')
  })
})
