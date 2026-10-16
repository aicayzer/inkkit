import { test, expect, type Page } from '@playwright/test'
import type { EditorOptions, InkKitEditor } from '../../src/core'

type SuggestionWindow = Window & {
  suggestionEditor: InkKitEditor
  suggestionErrors: string[]
  finishCommand?: (markdown: string) => void
}
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

async function mount(
  page: Page,
  text = '',
  options: EditorOptions = { slashMenu: { enabled: true } },
  format: 'md' | 'txt' = 'md',
  hostCommand?: {
    name: string
    keywords: string[]
    markdown: string
    mode?: 'hold' | 'throw'
  },
) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ text, options, format, moduleUrl, hostCommand }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      for (const child of Array.from(document.body.children))
        if (child instanceof HTMLElement) child.style.display = 'none'
      const root = document.createElement('div')
      root.id = 'suggestion-editor'
      root.style.cssText =
        'position:fixed;inset:20px 20px 70px;padding:20px;overflow:auto;background:white'
      const outside = document.createElement('button')
      outside.textContent = 'Outside the editor'
      outside.style.cssText = 'position:fixed;bottom:15px;left:20px'
      document.body.append(root, outside)
      if (hostCommand)
        options.slashMenu = {
          enabled: true,
          commands: [],
          customCommands: [
            {
              name: hostCommand.name,
              keywords: hostCommand.keywords,
              action: () => {
                if (hostCommand.mode === 'throw') throw new Error('Host failed')
                if (hostCommand.mode === 'hold')
                  return new Promise<string>((resolve) => {
                    ;(window as unknown as SuggestionWindow).finishCommand =
                      resolve
                  })
                return hostCommand.markdown
              },
            },
          ],
        }
      ;(window as unknown as SuggestionWindow).suggestionErrors = []
      const editor = await InkKitEditor.mount(
        root,
        {
          changed() {},
          error(error) {
            ;(window as unknown as SuggestionWindow).suggestionErrors.push(
              error.code,
            )
          },
        },
        options,
      )
      ;(window as unknown as SuggestionWindow).suggestionEditor = editor
      editor.loadDocument({
        documentId: 'suggestions',
        generation: 1,
        format,
        text,
      })
      editor.focus()
    },
    { text, options, format, moduleUrl, hostCommand },
  )
}

const root = (page: Page) => page.locator('#suggestion-editor')
const menu = (page: Page) => page.getByRole('listbox', { name: 'Suggestions' })
const option = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true })
const saved = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as SuggestionWindow).suggestionEditor.snapshot().text,
  )
const expectSaved = async (page: Page, text: string) =>
  expect.poll(() => saved(page)).toBe(text)

async function caretAtEnd(page: Page) {
  await page.evaluate(() => {
    const editor = (window as unknown as SuggestionWindow).suggestionEditor
    const snapshot = editor.textSnapshot()
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: snapshot.text.length,
      to: snapshot.text.length,
    })
    editor.focus()
  })
}

test('slash menu is opt-in and ignores slashes in ordinary text', async ({
  page,
}) => {
  await mount(page, '', {})
  await page.keyboard.type('/')
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '/\n')
  for (const text of [
    'and/or',
    '24/7',
    '15/10',
    'path/to/file',
    'https://example.com',
  ]) {
    await mount(page)
    await page.keyboard.type(text)
    await expect(menu(page)).toHaveCount(0)
    await expectSaved(page, `${text}\n`)
  }
})

test('slash opens ordered suggestions with a selected first row and combobox semantics', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/')
  await expect(menu(page)).toBeVisible()
  await expect(menu(page).getByRole('option')).toHaveText([
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Bulleted List',
    'Numbered List',
    'Checklist',
    'Quote',
    'Code Block',
    'Table',
    'Callout',
    'Divider',
    'Diagram',
  ])
  await expect(option(page, 'Heading 1')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const combo = root(page).getByRole('combobox')
  await expect(combo).toHaveAttribute('aria-expanded', 'true')
  await expect(combo).toHaveAttribute('aria-autocomplete', 'list')
  await expect(combo).toHaveAttribute(
    'aria-controls',
    (await menu(page).getAttribute('id'))!,
  )
  await expect(combo).toHaveAttribute(
    'aria-activedescendant',
    (await option(page, 'Heading 1').getAttribute('id'))!,
  )
  await page.keyboard.press('ArrowDown')
  await expect(option(page, 'Heading 2')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(combo).toHaveAttribute(
    'aria-activedescendant',
    (await option(page, 'Heading 2').getAttribute('id'))!,
  )
  await page.keyboard.press('ArrowUp')
  await expect(option(page, 'Heading 1')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(
    root(page).getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    }),
  ).toBeVisible()
})

test('filtering matches names and keyword prefixes ignoring case', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/HeA')
  await expect(menu(page).getByRole('option')).toHaveText([
    'Heading 1',
    'Heading 2',
    'Heading 3',
  ])
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('TiT')
  await expect(menu(page).getByRole('option')).toHaveText(['Heading 1'])
  await page.keyboard.press('Enter')
  await expect(menu(page)).toHaveCount(0)
  await expect(root(page).locator('h1')).toBeVisible()
  expect(await saved(page)).not.toContain('/TiT')
})

for (const key of ['Enter', 'Tab']) {
  test(`${key} chooses the highlighted block and one undo restores pre-slash bytes`, async ({
    page,
  }) => {
    const original = 'Untidy   text\r\n\r\n'
    await mount(page, original)
    await caretAtEnd(page)
    // A real Enter creates the empty line; retain its exact snapshot as the undo target.
    await page.keyboard.press('Enter')
    const before = await saved(page)
    await page.keyboard.type('/h')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press(key)
    await expect(root(page).locator('h2')).toBeVisible()
    const inserted = await saved(page)
    expect(inserted).toContain('Untidy   text')
    expect(inserted).not.toContain('/h')
    await page.keyboard.press('ControlOrMeta+z')
    await expectSaved(page, before)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expectSaved(page, inserted)
    await expect(menu(page)).toHaveCount(0)
  })
}

test('pointer selection replaces the filter and retains editor focus', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/h3')
  await option(page, 'Heading 3').click()
  await expect(root(page).locator('h3')).toBeVisible()
  await expect(
    root(page).getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    }),
  ).toBeFocused()
  await page.keyboard.type('A heading')
  await expectSaved(page, '### A heading\n')
})

test('Escape keeps the filter and does not reopen while it is extended', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/hea')
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '/hea\n')
  await page.keyboard.type('ding')
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '/heading\n')
})

test('deleting the slash closes the menu', async ({ page }) => {
  await mount(page)
  await page.keyboard.type('/')
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Backspace')
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '')
})

test('no matches appears briefly and closes without changing the typed text', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/zzzz')
  await expect(
    menu(page).getByText('No matches', { exact: true }),
  ).toBeVisible()
  await expect(menu(page)).toHaveCount(0, { timeout: 5_000 })
  await expectSaved(page, '/zzzz\n')
})

test('clicking outside closes the menu and keeps the text', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/hea')
  await expect(menu(page)).toBeVisible()
  await page.getByRole('button', { name: 'Outside the editor' }).click()
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '/hea\n')
})

test('scrolling the editor closes the menu and keeps the text', async ({
  page,
}) => {
  await mount(
    page,
    Array.from({ length: 70 }, (_, index) => `Paragraph ${index}`).join('\n\n'),
  )
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await page.keyboard.type('/')
  await expect(menu(page)).toBeVisible()
  const before = await saved(page)
  await root(page).hover()
  await page.mouse.wheel(0, -400)
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, before)
})

for (const [name, text] of [
  ['list item', '- first'],
  ['quote', '> first'],
  ['callout', '> [!NOTE]\n> first'],
] as const) {
  test(`slash opens in an empty paragraph inside a ${name}`, async ({
    page,
  }) => {
    await mount(page, text)
    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('/h2')
    await expect(option(page, 'Heading 2')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(root(page).locator('h2')).toBeVisible()
    const inserted = await saved(page)
    expect(inserted).not.toContain('/h2')
    expect(inserted).toContain(name === 'list item' ? '- ' : '> ')
  })
}

for (const [name, text, format, source] of [
  ['TXT', '', 'txt', false],
  ['source view', '', 'md', true],
  ['code block', '```\n\n```', 'md', false],
  ['table cell', '| | b |\n| - | - |\n| c | d |', 'md', false],
  ['front matter', '---\ntitle: Example\n---\n\nBody', 'md', false],
] as const) {
  test(`slash does not open in ${name}`, async ({ page }) => {
    await mount(page, text, { slashMenu: { enabled: true } }, format)
    if (source)
      await page.evaluate(() =>
        (window as unknown as SuggestionWindow).suggestionEditor.setEditingMode(
          'source',
        ),
      )
    if (name === 'code block') await root(page).locator('pre').click()
    if (name === 'table cell') await root(page).locator('th').first().click()
    if (name === 'front matter') {
      // Front matter is preserved source; editing it uses the source surface.
      await page.evaluate(() =>
        (window as unknown as SuggestionWindow).suggestionEditor.setEditingMode(
          'source',
        ),
      )
      await root(page)
        .getByRole('textbox', { name: 'Markdown source editor' })
        .press('ControlOrMeta+Home')
    }
    await page.keyboard.type('/')
    await expect(menu(page)).toHaveCount(0)
  })
}

test('read-only and composing editors never open the menu', async ({
  page,
}) => {
  await mount(page, '', { slashMenu: { enabled: true }, editable: false })
  await root(page)
    .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
    .click()
  await page.keyboard.type('/')
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '')
  await page.evaluate(() =>
    (window as unknown as SuggestionWindow).suggestionEditor.setEditable(true),
  )
  const editor = root(page).getByRole('textbox', {
    name: 'Formatted Markdown editor',
    exact: true,
  })
  await editor.focus()
  await editor.dispatchEvent('compositionstart', { data: '' })
  await page.keyboard.type('/')
  await expect(menu(page)).toHaveCount(0)
  await editor.dispatchEvent('compositionend', { data: '/' })
})

test('hosts choose built-ins and labels, and disabling previews hides Diagram', async ({
  page,
}) => {
  await mount(page, '', {
    slashMenu: { enabled: true, commands: ['heading1', 'diagram'] },
    labels: { slashHeading1: 'Titre principal' },
    rendering: { diagramPreview: false },
  })
  await page.keyboard.type('/')
  await expect(menu(page).getByRole('option')).toHaveText(['Titre principal'])
  await page.keyboard.type('tit')
  await expect(option(page, 'Titre principal')).toBeVisible()
})

test('callout selection asks for its type and inserts that callout', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/call')
  await page.keyboard.press('Enter')
  await expect(menu(page).getByRole('option')).toHaveText([
    'Note',
    'Tip',
    'Important',
    'Warning',
    'Caution',
  ])
  await option(page, 'Warning').click()
  await expect(menu(page)).toHaveCount(0)
  expect(await saved(page)).toContain('[!WARNING]')
  await page.keyboard.press('ControlOrMeta+z')
  await expectSaved(page, '')
})

test('menu shows at most eight rows and scrolling its list keeps it open', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('/')
  await expect(menu(page)).toBeVisible()
  const bounds = await menu(page).boundingBox()
  const rows = await menu(page)
    .getByRole('option')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        top: node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
      })),
    )
  expect(bounds).not.toBeNull()
  expect(
    rows.filter(
      (row) =>
        row.top >= bounds!.y && row.bottom <= bounds!.y + bounds!.height + 1,
    ).length,
  ).toBeLessThanOrEqual(8)
  await menu(page).hover()
  await page.mouse.wheel(0, 300)
  await expect(menu(page)).toBeVisible()
  await expect(option(page, 'Diagram')).toBeInViewport()
})

test('host commands filter by keywords and insert Markdown in one undo step', async ({
  page,
}) => {
  await mount(page, '', {}, 'md', {
    name: 'Link to Note',
    keywords: ['note', 'reference'],
    markdown: '[A note](note:one)',
  })
  await page.keyboard.type('/REF')
  await expect(menu(page).getByRole('option')).toHaveText(['Link to Note'])
  await page.keyboard.press('Enter')
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, '[A note](note:one)\n')
  await page.keyboard.press('ControlOrMeta+z')
  await expectSaved(page, '')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expectSaved(page, '[A note](note:one)\n')
})

test('menu opens above a caret near the bottom of the viewport', async ({
  page,
}) => {
  await mount(page)
  await root(page).evaluate((element) => {
    element.style.top = `${window.innerHeight - 110}px`
    element.style.bottom = '20px'
    element.style.overflow = 'visible'
  })
  await page.keyboard.type('/')
  await expect(menu(page)).toBeVisible()
  const popup = await menu(page).boundingBox()
  const line = await root(page).locator('p').first().boundingBox()
  expect(popup).not.toBeNull()
  expect(line).not.toBeNull()
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(line!.y + 2)
})

for (const change of ['typing', 'replacement', 'read-only'] as const) {
  test(`a delayed host command cannot overwrite ${change}`, async ({
    page,
  }) => {
    await mount(page, '', {}, 'md', {
      name: 'Host command',
      keywords: ['host'],
      markdown: '',
      mode: 'hold',
    })
    await page.keyboard.type('/host')
    await page.keyboard.press('Enter')
    await expect(menu(page)).toHaveCount(0)
    if (change === 'typing') await page.keyboard.type(' more')
    if (change === 'replacement')
      await page.evaluate(() =>
        (window as unknown as SuggestionWindow).suggestionEditor.loadDocument({
          documentId: 'replacement',
          generation: 2,
          format: 'md',
          text: 'Replacement bytes\r\n',
        }),
      )
    if (change === 'read-only')
      await page.evaluate(() =>
        (window as unknown as SuggestionWindow).suggestionEditor.setEditable(
          false,
        ),
      )
    const before = await saved(page)
    await page.evaluate(() =>
      (window as unknown as SuggestionWindow).finishCommand!('# Too late'),
    )
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as SuggestionWindow).suggestionErrors,
        ),
      )
      .toContain('stale-document')
    await expectSaved(page, before)
  })
}

test('a failed host command keeps document bytes, revision and undo history', async ({
  page,
}) => {
  await mount(page, '', {}, 'md', {
    name: 'Host command',
    keywords: ['host'],
    markdown: '',
    mode: 'throw',
  })
  await page.keyboard.type('/host')
  const before = await page.evaluate(() =>
    (window as unknown as SuggestionWindow).suggestionEditor.snapshot(),
  )
  await page.keyboard.press('Enter')
  await expect(menu(page)).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      (window as unknown as SuggestionWindow).suggestionEditor.snapshot(),
    ),
  ).toEqual(before)
  expect(
    await page.evaluate(
      () => (window as unknown as SuggestionWindow).suggestionErrors,
    ),
  ).toContain('internal')
  await page.keyboard.press('ControlOrMeta+z')
  await expectSaved(page, '')
})
