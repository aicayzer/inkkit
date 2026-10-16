import { expect, test, type Page } from '@playwright/test'
import type { FileContext, InkKitEditor } from '../../src/core'

type WikiWindow = Window & {
  wikiEditor: InkKitEditor
  wikiErrors: string[]
  wikiRequests: Array<{
    query: string
    context: FileContext
    resolve(names: readonly string[]): void
  }>
}
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const root = (page: Page) => page.locator('#wiki-suggestion-editor')
const menu = (page: Page) => page.getByRole('listbox', { name: 'Suggestions' })
const option = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true })
const saved = (page: Page) =>
  page.evaluate(
    () => (window as unknown as WikiWindow).wikiEditor.snapshot().text,
  )
const expectSaved = (page: Page, text: string) =>
  expect.poll(() => saved(page)).toBe(text)
const readable = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as WikiWindow).wikiEditor.textSnapshot().text.trim(),
  )

async function mount(
  page: Page,
  options: {
    text?: string
    names?: string[]
    manual?: boolean
    suggest?: boolean
    slash?: boolean
    format?: 'md' | 'txt'
  } = {},
) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, options }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      for (const child of Array.from(document.body.children))
        if (child instanceof HTMLElement) child.style.display = 'none'
      const root = document.createElement('div')
      root.id = 'wiki-suggestion-editor'
      root.style.cssText =
        'position:fixed;inset:20px 20px 70px;padding:20px;overflow:auto;background:white'
      const outside = document.createElement('button')
      outside.textContent = 'Outside the editor'
      outside.style.cssText = 'position:fixed;bottom:15px;left:20px'
      document.body.append(root, outside)
      const host = window as unknown as WikiWindow
      host.wikiRequests = []
      host.wikiErrors = []
      const names = options.names ?? ['Alpha', 'Alpine', 'Beta']
      const wikiLinks = {
        open() {},
        ...(options.suggest === false
          ? {}
          : {
              suggest(
                query: string,
                context: FileContext,
              ): Promise<readonly string[]> {
                return new Promise((resolve) => {
                  host.wikiRequests.push({ query, context, resolve })
                  if (!options.manual)
                    resolve(
                      names.filter((name) =>
                        name.toLowerCase().startsWith(query.toLowerCase()),
                      ),
                    )
                })
              },
            }),
      }
      host.wikiEditor = await InkKitEditor.mount(
        root,
        {
          changed() {},
          error(error) {
            host.wikiErrors.push(error.code)
          },
        },
        {
          wikiLinks,
          ...(options.slash ? { slashMenu: { enabled: true } } : {}),
        },
      )
      host.wikiEditor.loadDocument({
        documentId: 'wiki-suggestions',
        generation: 1,
        format: options.format ?? 'md',
        text: options.text ?? '',
      })
      host.wikiEditor.focus()
    },
    { moduleUrl, options },
  )
}

async function resolve(page: Page, query: string, names: string[]) {
  await expect
    .poll(() =>
      page.evaluate(
        (query) =>
          (window as unknown as WikiWindow).wikiRequests.some(
            (request) => request.query === query,
          ),
        query,
      ),
    )
    .toBe(true)
  await page.evaluate(
    ({ query, names }) => {
      const request = [...(window as unknown as WikiWindow).wikiRequests]
        .reverse()
        .find((request) => request.query === query)!
      request.resolve(names)
    },
    { query, names },
  )
}

async function target(page: Page) {
  await page.evaluate(() => {
    const editor = (window as unknown as WikiWindow).wikiEditor
    editor.find('TARGET')
    editor.focus()
  })
  await page.keyboard.press('ArrowRight')
}

test('wiki suggestions opt in through the adapter without enabling slash commands', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('[[')
  await expect(menu(page)).toBeVisible()
  await expect(menu(page).getByRole('option')).toHaveText([
    'Alpha',
    'Alpine',
    'Beta',
  ])
  await page.keyboard.press('Escape')
  await mount(page, { suggest: false })
  await page.keyboard.type('[[Al')
  await expect(menu(page)).toHaveCount(0)
  expect(await readable(page)).toBe('[[Al')
})

test('host filtering updates options and accessible highlight with real keys', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('[[aL')
  await expect(menu(page).getByRole('option')).toHaveText(['Alpha', 'Alpine'])
  const combo = root(page).getByRole('combobox')
  await expect(combo).toHaveAttribute('aria-expanded', 'true')
  await expect(combo).toHaveAttribute('aria-autocomplete', 'list')
  await expect(combo).toHaveAttribute(
    'aria-controls',
    (await menu(page).getAttribute('id'))!,
  )
  await expect(option(page, 'Alpha')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(option(page, 'Alpine')).toHaveAttribute('aria-selected', 'true')
  await expect(combo).toHaveAttribute(
    'aria-activedescendant',
    (await option(page, 'Alpine').getAttribute('id'))!,
  )
  await page.keyboard.press('ArrowUp')
  await expect(option(page, 'Alpha')).toHaveAttribute('aria-selected', 'true')
  expect(
    await page.evaluate(() =>
      (window as unknown as WikiWindow).wikiRequests.map(
        (request) => request.query,
      ),
    ),
  ).toContain('aL')
})

for (const key of ['Enter', 'Tab']) {
  test(`${key} inserts a note and undo restores the typed query as one isolated step`, async ({
    page,
  }) => {
    await mount(page, {
      text: 'Before  \r\n\r\nTARGET\r\n\r\nAfter _untouched_.\r\n',
    })
    await target(page)
    await page.keyboard.type('[[Al')
    await expect(option(page, 'Alpha')).toBeVisible()
    const typed = await saved(page)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press(key)
    await expect(menu(page)).toHaveCount(0)
    const inserted = await saved(page)
    expect(inserted).toBe(typed.replace(/\\?\[\\?\[Al/, '[[Alpine]]'))
    expect(inserted).toContain('Before  \r\n')
    expect(inserted).toContain('After _untouched_.\r\n')
    expect(inserted.replaceAll('\r\n', '')).not.toContain('\n')
    await page.keyboard.press('ControlOrMeta+z')
    await expectSaved(page, typed)
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expectSaved(page, inserted)
    await expect(menu(page)).toHaveCount(0)
  })
}

test('pointer choice inserts the selected note and leaves text focus in the editor', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('[[Al')
  await option(page, 'Alpine').click()
  await expectSaved(page, '[[Alpine]]\n')
  await expect(
    root(page).getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    }),
  ).toBeFocused()
  await page.keyboard.type(' follows')
  await expectSaved(page, '[[Alpine]] follows\n')
})

for (const close of ['Escape', 'brackets', 'outside', 'delete'] as const) {
  test(`${close} dismisses wiki suggestions without replacing the typed text`, async ({
    page,
  }) => {
    await mount(page)
    await page.keyboard.type('[[Al')
    await expect(menu(page)).toBeVisible()
    const typed = await saved(page)
    if (close === 'Escape') await page.keyboard.press('Escape')
    if (close === 'brackets') await page.keyboard.type(']]')
    if (close === 'outside')
      await page.getByRole('button', { name: 'Outside the editor' }).click()
    if (close === 'delete') {
      for (let count = 0; count < 3; count++)
        await page.keyboard.press('Backspace')
    }
    await expect(menu(page)).toHaveCount(0)
    expect(await readable(page)).toBe(
      close === 'brackets' ? '[[Al]]' : close === 'delete' ? '[' : '[[Al',
    )
    if (close === 'Escape' || close === 'outside')
      await expectSaved(page, typed)
    if (close === 'brackets') {
      const dismissed = await saved(page)
      await mount(page, { suggest: false })
      await page.keyboard.type('[[Al]]')
      await expectSaved(page, dismissed)
    }
    if (close === 'Escape') {
      await page.keyboard.type('pha')
      await expect(menu(page)).toHaveCount(0)
      expect(await readable(page)).toBe('[[Alpha')
    }
  })
}

test('no matches appears briefly then closes while preserving the query', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('[[zz')
  const typed = await saved(page)
  await expect(
    menu(page).getByText('No matches', { exact: true }),
  ).toBeVisible()
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, typed)
})

test('slow lookup does not block typing and stale answers cannot replace current results', async ({
  page,
}) => {
  await mount(page, { manual: true })
  await page.keyboard.type('[[Alpha')
  expect(await readable(page)).toBe('[[Alpha')
  await resolve(page, 'Alpha', ['Alpha latest'])
  await expect(menu(page).getByRole('option')).toHaveText(['Alpha latest'])
  await resolve(page, '', ['Old empty query'])
  await resolve(page, 'A', ['Old A query'])
  await expect(menu(page).getByRole('option')).toHaveText(['Alpha latest'])
  const requests = await page.evaluate(() =>
    (window as unknown as WikiWindow).wikiRequests.map(
      ({ query, context }) => ({
        query,
        aborted: context.signal.aborted,
        documentId: context.documentId,
        generation: context.generation,
      }),
    ),
  )
  expect(requests.find((request) => request.query === '')).toMatchObject({
    aborted: true,
    documentId: 'wiki-suggestions',
    generation: 1,
  })
  expect(requests.find((request) => request.query === 'Alpha')).toMatchObject({
    aborted: false,
  })
  await page.keyboard.press('Escape')
  expect(
    await page.evaluate(
      () =>
        (window as unknown as WikiWindow).wikiRequests.at(-1)!.context.signal
          .aborted,
    ),
  ).toBe(true)
})

for (const change of ['mode', 'load', 'read-only', 'destroy'] as const) {
  test(`late lookup cannot reopen after ${change}`, async ({ page }) => {
    await mount(page, { manual: true })
    await page.keyboard.type('[[Al')
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as WikiWindow).wikiRequests.some(
            (request) => request.query === 'Al',
          ),
        ),
      )
      .toBe(true)
    await page.evaluate(async (change) => {
      const editor = (window as unknown as WikiWindow).wikiEditor
      if (change === 'mode') editor.setEditingMode('source')
      if (change === 'load')
        editor.loadDocument({
          documentId: 'replacement',
          generation: 2,
          format: 'md',
          text: 'Replacement\r\n',
        })
      if (change === 'read-only') editor.setEditable(false)
      if (change === 'destroy') await editor.destroy()
    }, change)
    const before = change === 'destroy' ? undefined : await saved(page)
    await resolve(page, 'Al', ['Late note'])
    await expect(menu(page)).toHaveCount(0)
    expect(
      await page.evaluate(
        () =>
          (window as unknown as WikiWindow).wikiRequests.at(-1)!.context.signal
            .aborted,
      ),
    ).toBe(true)
    if (before !== undefined) await expectSaved(page, before)
    expect(
      await page.evaluate(() => (window as unknown as WikiWindow).wikiErrors),
    ).toEqual([])
  })
}

for (const [context, text] of [
  ['paragraph', 'Before TARGET after'],
  ['heading', '# TARGET'],
  ['list', '* TARGET'],
  ['quote', '> TARGET'],
  ['callout', '> [!NOTE]\n> TARGET'],
  ['table', '| TARGET | b |\n| --- | --- |\n| c | d |'],
] as const) {
  test(`wiki suggestions open inside ${context} text and preserve surrounding bytes`, async ({
    page,
  }) => {
    await mount(page, { text })
    await target(page)
    await page.keyboard.type('[[Al')
    await expect(option(page, 'Alpha')).toBeVisible()
    const typed = await saved(page)
    await page.keyboard.press('Enter')
    await expectSaved(page, typed.replace(/\\?\[\\?\[Al/, '[[Alpha]]'))
    expect(
      await page.evaluate(() => (window as unknown as WikiWindow).wikiErrors),
    ).toEqual([])
  })
}

for (const context of [
  'code block',
  'inline code',
  'preserved literal',
  'front matter',
  'source',
  'TXT',
  'read-only',
  'composition',
] as const) {
  test(`wiki suggestions never open in ${context}`, async ({ page }) => {
    const text =
      context === 'code block'
        ? '```\nTARGET\n```'
        : context === 'preserved literal'
          ? 'Hello <b>TARGET</b>'
          : context === 'inline code'
            ? '`TARGET`'
            : context === 'front matter'
              ? '---\ntitle: TARGET\n---\n\nBody'
              : 'TARGET'
    await mount(page, { text, format: context === 'TXT' ? 'txt' : 'md' })
    if (context === 'source' || context === 'front matter')
      await page.evaluate(() =>
        (window as unknown as WikiWindow).wikiEditor.setEditingMode('source'),
      )
    if (context === 'read-only')
      await page.evaluate(() =>
        (window as unknown as WikiWindow).wikiEditor.setEditable(false),
      )
    if (
      context === 'code block' ||
      context === 'inline code' ||
      context === 'preserved literal'
    ) {
      await target(page)
      await page.keyboard.press('ArrowLeft')
    } else
      await page.evaluate(() =>
        (window as unknown as WikiWindow).wikiEditor.focus(),
      )
    const surface = root(page).locator('[contenteditable=true]')
    if (context === 'composition')
      await surface.dispatchEvent('compositionstart', { data: '' })
    await page.keyboard.type('[[')
    await expect(menu(page)).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as unknown as WikiWindow).wikiRequests),
    ).toHaveLength(0)
    if (context === 'composition')
      await surface.dispatchEvent('compositionend', { data: '[[' })
  })
}

test('a new lookup clears old selectable rows while the host is still working', async ({
  page,
}) => {
  await mount(page, { manual: true })
  await page.keyboard.type('[[')
  await resolve(page, '', ['Alpha'])
  await expect(option(page, 'Alpha')).toBeVisible()
  await page.keyboard.type('B')
  await expect(menu(page)).toHaveAttribute('aria-busy', 'true')
  await expect(menu(page).getByRole('option')).toHaveCount(0)
  expect(await readable(page)).toBe('[[B')
  await resolve(page, 'B', ['Beta'])
  await expect(menu(page)).not.toHaveAttribute('aria-busy', 'true')
  await expect(menu(page).getByRole('option')).toHaveText(['Beta'])
  await page.keyboard.press('Enter')
  await expectSaved(page, '[[Beta]]\n')
})

test('scrolling away closes wiki suggestions and aborts the outstanding lookup', async ({
  page,
}) => {
  await mount(page, {
    text: Array.from({ length: 70 }, (_, index) => `Paragraph ${index}`).join(
      '\n\n',
    ),
    manual: true,
  })
  await page.evaluate(() => {
    const editor = (window as unknown as WikiWindow).wikiEditor
    const snapshot = editor.textSnapshot()
    editor.selectTextRange(
      {
        snapshotId: snapshot.snapshotId,
        from: snapshot.text.length,
        to: snapshot.text.length,
      },
      { focus: true, reveal: true },
    )
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await page.keyboard.type('[[Al')
  await expect(menu(page)).toBeVisible()
  const typed = await saved(page)
  await root(page).hover()
  await page.mouse.wheel(0, -400)
  await expect(menu(page)).toHaveCount(0)
  await resolve(page, 'Al', ['Alpha late'])
  await expect(menu(page)).toHaveCount(0)
  await expectSaved(page, typed)
  expect(
    await page.evaluate(
      () =>
        (window as unknown as WikiWindow).wikiRequests.at(-1)!.context.signal
          .aborted,
    ),
  ).toBe(true)
})

test('Unicode and wiki punctuation in names round-trip as one safe wiki link', async ({
  page,
}) => {
  const name = 'Café 😀 [draft] #part | alias \\ notes'
  await mount(page, { names: [name] })
  await page.keyboard.type('[[')
  await option(page, name).click()
  const inserted = await saved(page)
  const escaped = name.replace(/[\\[\]|#]/g, '\\$&')
  expect(inserted).toBe(`[[${escaped}]]\n`)
  await page.evaluate((text) => {
    ;(window as unknown as WikiWindow).wikiEditor.loadDocument({
      documentId: 'reopened',
      generation: 2,
      format: 'md',
      text,
    })
  }, inserted)
  await expectSaved(page, inserted)
  expect(
    await page.evaluate(() =>
      (window as unknown as WikiWindow).wikiEditor.textSnapshot().text.trim(),
    ),
  ).toBe(name)
  expect(
    await page.evaluate(() => (window as unknown as WikiWindow).wikiErrors),
  ).toEqual([])
})

test('slash and wiki providers reuse one popup and restore editor semantics on close', async ({
  page,
}) => {
  await mount(page, { slash: true })
  await page.keyboard.type('/')
  await expect(option(page, 'Heading 1')).toBeVisible()
  const id = await menu(page).getAttribute('id')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('[[')
  await expect(option(page, 'Alpha')).toBeVisible()
  await expect(menu(page)).toHaveCount(1)
  await expect(menu(page)).toHaveAttribute('id', id!)
  await page.keyboard.press('Escape')
  await expect(
    root(page).getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    }),
  ).toBeVisible()
  await expect(root(page).getByRole('combobox')).toHaveCount(0)
})
