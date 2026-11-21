import { expect, test, type Page } from '@playwright/test'
import type { EditorOptions, InkKitEditor } from '../../src/core'

/**
 * A fold hides text, and a section that a selection opened has not been seen until a frame has
 * been painted with it. No edit changes either, and each refusal reports `hidden-text`. These
 * cases drive the real input routes in the browser: keys, paste, drop, cut and formatting, and the
 * gate that lets a painted section be edited.
 */

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const source = '# One\n\nsecret phrase\n\n# Two\n'

declare global {
  interface Window {
    hiddenEditor: InkKitEditor
    hiddenGeneration: number
    hiddenErrors: string[]
    hiddenCut?: { text: string; html: string; prevented: boolean }
    pageHidden?: boolean
  }
}

async function mount(
  page: Page,
  options: EditorOptions = {},
  text = source,
): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, text, options }) => {
      const { InkKitEditor } = await import(moduleUrl)
      document.body.replaceChildren()
      document.body.style.cssText = 'margin:0;padding:10px;width:620px'
      const root = document.createElement('div')
      root.id = 'hidden-editor'
      root.style.cssText = 'padding:20px 28px;--inkkit-reading-width:520px'
      document.body.append(root)
      window.hiddenErrors = []
      const editor = await InkKitEditor.mount(
        root,
        {
          changed() {},
          error: (error: { code: string }) =>
            window.hiddenErrors.push(error.code),
        },
        { rendering: { drawnSelection: false }, ...options },
      )
      window.hiddenGeneration = 1
      editor.loadDocument({
        documentId: 'hidden',
        generation: 1,
        format: 'md',
        text,
      })
      window.hiddenEditor = editor
    },
    { moduleUrl, text, options },
  )
}

const saved = (page: Page) =>
  page.evaluate(() => window.hiddenEditor.snapshot().text)
const errors = (page: Page) => page.evaluate(() => window.hiddenErrors)
const toggle = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })

/** Two frames, which is long enough for a section that opened to have been painted and shown. */
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )

/** Stops the browser's frames reaching the page, so a section that opened stays unpainted. */
const freezeFrames = (page: Page) =>
  page.evaluate(() => {
    window.requestAnimationFrame = () => 0
  })

/** The first section folded, so `secret phrase` is hidden. */
async function folded(page: Page, options: EditorOptions = {}) {
  await mount(page, { display: { foldHeadings: true }, ...options })
  await toggle(page, 'Fold section One').click()
  await expect(page.getByText('secret phrase')).toBeHidden()
}

/** Selects `secret`, which opens the section, and returns focus to the editor. */
const selectSecret = (page: Page) =>
  page.evaluate(() => {
    const editor = window.hiddenEditor
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('secret')
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from, to: from + 6 },
      { focus: true },
    )
  })

const insertX = (page: Page) =>
  page.evaluate(() => {
    try {
      window.hiddenEditor.insertText('X', window.hiddenGeneration)
      return 'inserted'
    } catch (error) {
      return (error as { code: string }).code
    }
  })

test('an edit queued in the host`s next animation frame is refused, and the next paint allows it', async ({
  page,
}) => {
  await folded(page)
  // The editor's own frame callback runs first, then the host's, in the same frame, before it paints.
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const editor = window.hiddenEditor
        const snapshot = editor.textSnapshot()
        const from = snapshot.text.indexOf('secret')
        editor.selectTextRange({
          snapshotId: snapshot.snapshotId,
          from,
          to: from + 6,
        })
        requestAnimationFrame(() => {
          try {
            editor.insertText('X', window.hiddenGeneration)
            resolve('inserted')
          } catch (error) {
            resolve((error as { code: string }).code)
          }
        })
      }),
  )
  expect(result).toBe('hidden-text')
  expect(await saved(page)).toBe(source)
  await expect.poll(() => insertX(page)).toBe('inserted')
  expect(await saved(page)).toBe('# One\n\nX phrase\n\n# Two\n')
})

test('a page that is hidden keeps the section protected until it shows and paints', async ({
  page,
}) => {
  await folded(page)
  await page.evaluate(() => {
    window.pageHidden = true
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (window.pageHidden ? 'hidden' : 'visible'),
    })
  })
  await selectSecret(page)
  await expect(page.getByText('secret phrase')).toBeVisible()
  // No timer clears it: well past the old 100 ms, and several frames, it is still refused.
  await page.waitForTimeout(700)
  expect(await insertX(page)).toBe('hidden-text')
  expect(await saved(page)).toBe(source)
  await page.evaluate(() => {
    window.pageHidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => insertX(page)).toBe('inserted')
})

test('an editor that is not rendered keeps the section protected until it is shown and painted', async ({
  page,
}) => {
  await folded(page)
  // In the task that opens the section, so no frame has painted it before the editor is hidden.
  await page.evaluate(() => {
    const editor = window.hiddenEditor
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('secret')
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from,
      to: from + 6,
    })
    document.querySelector<HTMLElement>('#hidden-editor')!.style.display =
      'none'
  })
  await page.waitForTimeout(700)
  expect(await insertX(page)).toBe('hidden-text')
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#hidden-editor')!.style.display = ''
  })
  await expect.poll(() => insertX(page)).toBe('inserted')
})

test('a display update that leaves folding as it is keeps the section protected', async ({
  page,
}) => {
  await folded(page)
  const result = await page.evaluate(() => {
    const editor = window.hiddenEditor
    const snapshot = editor.textSnapshot()
    const from = snapshot.text.indexOf('secret')
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from,
      to: from + 6,
    })
    editor.setDisplayPreferences({ foldHeadings: true, codeLineNumbers: true })
    try {
      editor.insertText('X', window.hiddenGeneration)
      return 'inserted'
    } catch (error) {
      return (error as { code: string }).code
    }
  })
  expect(result).toBe('hidden-text')
  expect(await saved(page)).toBe(source)
})

test('turning the opened heading into a paragraph keeps its former body protected', async ({
  page,
}) => {
  await folded(page)
  const result = await page.evaluate(() => {
    const editor = window.hiddenEditor
    const snapshot = editor.textSnapshot()
    // From inside the heading to inside the hidden text, so the section opens.
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: snapshot.text.indexOf('One') + 1,
      to: snapshot.text.indexOf('secret') + 3,
    })
    editor.format('paragraph', undefined, window.hiddenGeneration)
    try {
      editor.insertText('X', window.hiddenGeneration)
      return 'inserted'
    } catch (error) {
      return (error as { code: string }).code
    }
  })
  expect(result).toBe('hidden-text')
  expect(await saved(page)).toBe('One\n\nsecret phrase\n\n# Two\n')
})

test.describe('formatting', () => {
  test('format refuses text a section that just opened has not shown', async ({
    page,
  }) => {
    await folded(page)
    const result = await page.evaluate(() => {
      const editor = window.hiddenEditor
      const snapshot = editor.textSnapshot()
      const from = snapshot.text.indexOf('secret')
      editor.selectTextRange({
        snapshotId: snapshot.snapshotId,
        from,
        to: from + 6,
      })
      try {
        editor.format('bold', undefined, window.hiddenGeneration)
        return 'formatted'
      } catch (error) {
        return (error as { code: string }).code
      }
    })
    expect(result).toBe('hidden-text')
    expect(await saved(page)).toBe(source)
    await frames(page)
    await expect.poll(() => saved(page)).toBe(source)
    expect(
      await page.evaluate(() =>
        window.hiddenEditor.format('bold', undefined, window.hiddenGeneration),
      ),
    ).toBe(true)
    expect(await saved(page)).toBe('# One\n\n**secret** phrase\n\n# Two\n')
  })

  test('a shortcut refuses text a section that just opened has not shown', async ({
    page,
  }) => {
    await folded(page, { keymap: { bold: ['Mod-b'] } })
    await freezeFrames(page)
    await selectSecret(page)
    await page.keyboard.press('ControlOrMeta+b')
    expect(await saved(page)).toBe(source)
    expect(await errors(page)).toEqual(['hidden-text'])
  })

  test('format and a shortcut refuse folded text that a select-all covers', async ({
    page,
  }) => {
    await folded(page, { keymap: { bold: ['Mod-b'] } })
    await page.evaluate(() => window.hiddenEditor.focus())
    await page.keyboard.press('ControlOrMeta+a')
    // The selection covers the folded section whole, so the section is still folded.
    await expect(page.getByText('secret phrase')).toBeHidden()
    const result = await page.evaluate(() => {
      try {
        window.hiddenEditor.format('bold', undefined, window.hiddenGeneration)
        return 'formatted'
      } catch (error) {
        return (error as { code: string }).code
      }
    })
    expect(result).toBe('hidden-text')
    expect(await saved(page)).toBe(source)
    // The refusal opened the section, so the person sees what the formatting reached.
    await expect(page.getByText('secret phrase')).toBeVisible()
    // The same holds for a section that is folded again.
    await toggle(page, 'Fold section One').click()
    await expect(page.getByText('secret phrase')).toBeHidden()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+b')
    expect(await saved(page)).toBe(source)
    expect(await errors(page)).toEqual(['hidden-text'])
  })
})

test('a refused cut writes nothing to the clipboard', async ({ page }) => {
  await folded(page)
  await freezeFrames(page)
  // A capture listener on the root, added after the editor's own, sees what its handler left.
  await page.evaluate(() => {
    document.querySelector('#hidden-editor')!.addEventListener(
      'cut',
      (event) => {
        const data = (event as ClipboardEvent).clipboardData
        window.hiddenCut = {
          text: data?.getData('text/plain') ?? '',
          html: data?.getData('text/html') ?? '',
          prevented: event.defaultPrevented,
        }
      },
      true,
    )
  })
  await selectSecret(page)
  await page.keyboard.press('ControlOrMeta+x')
  const cut = await page.evaluate(() => window.hiddenCut)
  expect(cut).toEqual({ text: '', html: '', prevented: true })
  expect(await saved(page)).toBe(source)
  expect(await errors(page)).toEqual(['hidden-text'])
})

// Every DOM input route reports the refusal through `events.error` and consumes the input.
const routes: [string, EditorOptions, (page: Page) => Promise<unknown>][] = [
  ['typing', {}, (page) => page.keyboard.type('x')],
  ['Backspace', {}, (page) => page.keyboard.press('Backspace')],
  ['Delete', {}, (page) => page.keyboard.press('Delete')],
  [
    'a plain text paste',
    {},
    (page) => dispatchPaste(page, { 'text/plain': 'pasted' }),
  ],
  [
    'an HTML paste',
    {},
    (page) =>
      dispatchPaste(page, {
        'text/plain': 'pasted',
        'text/html': '<p><strong>pasted</strong></p>',
      }),
  ],
  [
    'a Markdown paste',
    {},
    (page) => dispatchPaste(page, { 'text/plain': '**pasted** [link](x)' }),
  ],
  [
    'a paste with the plain text default',
    { textInput: { paste: 'plainText' } },
    (page) =>
      dispatchPaste(page, {
        'text/plain': 'pasted',
        'text/html': '<p>pasted</p>',
      }),
  ],
  [
    // A drag that moves the selected text deletes it from where it was, so the drop is an edit of
    // that text. A drop of other content only places blocks beside the hidden text.
    'a drop that moves the selected text',
    {},
    async (page) => {
      const secret = (await page.getByText('secret phrase').boundingBox())!
      const target = (await page
        .locator('.ProseMirror h1')
        .last()
        .boundingBox())!
      await page.evaluate(
        ({ from, to }) => {
          const transfer = new DataTransfer()
          const surface = document.querySelector('#hidden-editor .ProseMirror')!
          surface.dispatchEvent(
            new DragEvent('dragstart', {
              dataTransfer: transfer,
              clientX: from.x,
              clientY: from.y,
              bubbles: true,
              cancelable: true,
            }),
          )
          surface.dispatchEvent(
            new DragEvent('drop', {
              dataTransfer: transfer,
              clientX: to.x,
              clientY: to.y,
              bubbles: true,
              cancelable: true,
            }),
          )
        },
        {
          from: { x: secret.x + 20, y: secret.y + secret.height / 2 },
          to: { x: target.x + 10, y: target.y + target.height / 2 },
        },
      )
    },
  ],
]

const dispatchPaste = (page: Page, data: Record<string, string>) =>
  page.evaluate((data) => {
    const transfer = new DataTransfer()
    for (const [type, value] of Object.entries(data))
      transfer.setData(type, value)
    document.querySelector('#hidden-editor .ProseMirror')!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, data)

for (const [name, options, act] of routes) {
  test(`${name} on text a section that just opened has not shown is reported once and changes nothing`, async ({
    page,
  }) => {
    await folded(page, options)
    await freezeFrames(page)
    // Delete needs the caret before the text it removes, so the selection is the word's end.
    await selectSecret(page)
    await act(page)
    await expect.poll(() => errors(page)).toContain('hidden-text')
    // Wait out any report that is still on its way, then count them.
    await page.waitForTimeout(200)
    expect(await errors(page)).toEqual(['hidden-text'])
    expect(await saved(page)).toBe(source)
    await expect(page.getByText('secret phrase')).toBeVisible()
  })
}
