import { expect, test, type Page } from '@playwright/test'
import type { FileContext, InkKitEditor } from '../../src/core'

type WikiWindow = Window & { wikiEditor: InkKitEditor; wikiErrors: string[] }
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const root = (page: Page) => page.locator('#wiki-typing-editor')
const saved = (page: Page) =>
  page.evaluate(
    () => (window as unknown as WikiWindow).wikiEditor.snapshot().text,
  )
const expectSaved = (page: Page, text: string) =>
  expect.poll(() => saved(page)).toBe(text)
const links = (page: Page) =>
  root(page).locator('.inkkit-wiki-link').allTextContents()

async function mount(
  page: Page,
  options: { text?: string; wikiLinks?: 'plain' | 'suggest' | 'none' } = {},
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
      document.getElementById('wiki-typing-editor')?.remove()
      const root = document.createElement('div')
      root.id = 'wiki-typing-editor'
      root.style.cssText =
        'position:fixed;inset:20px;padding:20px;overflow:auto;background:white'
      document.body.append(root)
      const host = window as unknown as WikiWindow
      host.wikiErrors = []
      const mode = options.wikiLinks ?? 'plain'
      host.wikiEditor = await InkKitEditor.mount(
        root,
        {
          changed() {},
          error(error) {
            host.wikiErrors.push(error.code)
          },
        },
        mode === 'none'
          ? {}
          : {
              wikiLinks: {
                open() {},
                ...(mode === 'suggest'
                  ? {
                      suggest: async (query: string, _: FileContext) =>
                        ['Alpha', 'Alpine'].filter((name) =>
                          name.toLowerCase().startsWith(query.toLowerCase()),
                        ),
                    }
                  : {}),
              },
            },
      )
      host.wikiEditor.loadDocument({
        documentId: 'wiki-typing',
        generation: 1,
        format: 'md',
        text: options.text ?? '',
      })
      host.wikiEditor.focus()
    },
    { moduleUrl, options },
  )
}

async function afterTarget(page: Page) {
  await page.evaluate(() => {
    const editor = (window as unknown as WikiWindow).wikiEditor
    editor.find('TARGET')
    editor.focus()
  })
  await page.keyboard.press('ArrowRight')
  // The placeholder stays; the caret is after it.
}

for (const wikiLinks of ['plain', 'suggest'] as const)
  for (const [typed, label] of [
    ['[[Note]]', 'Note'],
    ['[[Note|alias]]', 'alias'],
    ['[[Note#Heading]]', 'Note#Heading'],
    ['[[#Heading]]', '#Heading'],
  ] as const) {
    test(`typed ${typed} is saved as typed and reopens as a link (${wikiLinks})`, async ({
      page,
    }) => {
      await mount(page, { wikiLinks })
      await page.keyboard.type(typed)
      await expectSaved(page, `${typed}\n`)
      expect(await links(page)).toEqual([label])
      await page.keyboard.type(' and more')
      await expectSaved(page, `${typed} and more\n`)
      const text = await saved(page)
      await mount(page, { text, wikiLinks })
      expect(await links(page)).toEqual([label])
      await expectSaved(page, text)
      expect(
        await page.evaluate(() => (window as unknown as WikiWindow).wikiErrors),
      ).toEqual([])
    })

    test(`typed ${typed} after existing text keeps the note around it (${wikiLinks})`, async ({
      page,
    }) => {
      await mount(page, {
        text: 'Before  \r\n\r\nTARGET\r\n\r\nAfter _untouched_.\r\n',
        wikiLinks,
      })
      await afterTarget(page)
      await page.keyboard.type(` see ${typed}`)
      await expectSaved(
        page,
        `Before  \r\n\r\nTARGET see ${typed}\r\n\r\nAfter _untouched_.\r\n`,
      )
      expect(await links(page)).toEqual([label])
    })
  }

test('typed brackets in a table cell save the cell form of the pipe', async ({
  page,
}) => {
  await mount(page, { text: '| TARGET | B |\n| - | - |\n| x | y |\n' })
  await page.evaluate(() =>
    (window as unknown as WikiWindow).wikiEditor.find('TARGET'),
  )
  await page.keyboard.type('see [[A|b]]')
  await expectSaved(page, '| see [[A\\|b]] | B |\n| - | - |\n| x | y |\n')
  expect(await links(page)).toEqual(['b'])
})

test('Undo takes back the typing and Redo restores the link', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('[[Note]]')
  await page.keyboard.press('ControlOrMeta+z')
  await expectSaved(page, '')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expectSaved(page, '[[Note]]\n')
  expect(await links(page)).toEqual(['Note'])
})

test('Backspace right after the closing brackets undoes the conversion and leaves the typed text', async ({
  page,
}) => {
  await mount(page)
  await page.keyboard.type('[[Note]]')
  await page.keyboard.press('Backspace')
  expect(await links(page)).toEqual([])
  await expectSaved(page, '\\[\\[Note]]\n')
})

test('text that is not a complete link stays text', async ({ page }) => {
  for (const [typed, text] of [
    ['![[Note]]', '!\\[\\[Note]]\n'],
    ['[[Note]', '\\[\\[Note]\n'],
    ['[[ ]]', '\\[\\[ ]]\n'],
  ] as const) {
    await mount(page)
    await page.keyboard.type(typed)
    await expectSaved(page, text)
    expect(await links(page)).toEqual([])
  }
})

test('without a WikiLinkAdapter typed brackets stay text', async ({ page }) => {
  await mount(page, { wikiLinks: 'none' })
  await page.keyboard.type('[[Note]]')
  await expectSaved(page, '\\[\\[Note]]\n')
  expect(await links(page)).toEqual([])
})
