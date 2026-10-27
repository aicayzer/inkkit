import { expect, test, type Page } from '@playwright/test'
import type { InkKitEditor } from '../../src/core'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const red = 'rgb(255, 0, 0)'
const blue = 'rgb(0, 0, 255)'

declare global {
  interface Window {
    selectionEditors: InkKitEditor[]
  }
}

/** Two editors with a paragraph and a field around them, as a host page might have. */
async function mountPage(page: Page, texts: string[]) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, texts }) => {
      const { InkKitEditor } = await import(moduleUrl)
      document.body.replaceChildren()
      document.body.style.cssText = 'margin:0;padding:10px;width:560px'
      const outside = document.createElement('p')
      outside.id = 'outside'
      outside.textContent = 'Plain page text outside the editors'
      const field = document.createElement('input')
      field.id = 'field'
      document.body.append(outside, field)
      const editors = []
      for (const [index, text] of texts.entries()) {
        const root = document.createElement('div')
        root.id = `editor-${index}`
        root.style.cssText =
          '--inkkit-selection-background:rgb(255, 0, 0);--inkkit-inactive-selection-background:rgb(0, 0, 255);padding:20px;--inkkit-reading-width:400px'
        document.body.append(root)
        const editor = await InkKitEditor.mount(root, { changed() {} })
        editor.loadDocument({
          documentId: `selection-${index}`,
          generation: 1,
          format: 'md',
          text,
        })
        editors.push(editor)
      }
      window.selectionEditors = editors
    },
    { moduleUrl, texts },
  )
}

const painted = (page: Page) =>
  page.evaluate(() =>
    Array.from(CSS.highlights.get('inkkit-selection') ?? [], (range) =>
      (range as Range).toString(),
    ),
  )

/** The editor reads the browser's selection a moment after the event, so wait for it to settle. */
const expectPainted = (page: Page, expected: string[]) =>
  expect.poll(() => painted(page)).toEqual(expected)

/** The colour the painted selection has in the first editor's text. */
const colour = (page: Page, editor = 0) =>
  page
    .locator(`#editor-${editor} .ProseMirror`)
    .evaluate(
      (node) =>
        getComputedStyle(node, '::highlight(inkkit-selection)').backgroundColor,
    )

const word = (page: Page, editor: number, paragraph = 0) =>
  page
    .locator(`#editor-${editor} .ProseMirror p`)
    .nth(paragraph)
    .dblclick({ position: { x: 8, y: 8 } })

const sentence = [
  'First paragraph with several words',
  'Second block of text',
  'Third block',
].join('\n\n')

test('native host activation preserves the range while overriding browser focus', async ({
  page,
}) => {
  await mountPage(page, [sentence])
  await word(page, 0)
  const before = await page.evaluate(() =>
    window.selectionEditors[0]!.snapshot(),
  )
  await page.evaluate(() => window.selectionEditors[0]!.setHostActive(false))
  await expectPainted(page, ['First'])
  expect(await colour(page)).toBe(blue)
  await page.evaluate(() => window.selectionEditors[0]!.setHostActive(true))
  expect(await colour(page)).toBe(red)
  await page.locator('#field').focus()
  expect(await colour(page)).toBe(blue)
  expect(
    await page.evaluate(() => window.selectionEditors[0]!.snapshot()),
  ).toEqual(before)
  await page.evaluate(() => window.selectionEditors[0]!.setHostActive(null))
})

test('read-only state is exposed on the textbox and source textarea', async ({
  page,
}, testInfo) => {
  await mountPage(page, [sentence])
  const formatted = page.getByRole('textbox', {
    name: 'Formatted Markdown editor',
  })
  await page.evaluate(() => window.selectionEditors[0]!.setEditable(false))
  await expect(formatted).toHaveAttribute('aria-readonly', 'true')
  await expect(formatted).not.toBeEditable()
  expect(await formatted.ariaSnapshot()).toContain('textbox')
  const cdp =
    testInfo.project.name === 'chromium'
      ? await page.context().newCDPSession(page)
      : undefined
  const readonly = async () => {
    const tree = await cdp!.send('Accessibility.getFullAXTree')
    return tree.nodes
      .find((node) => node.name?.value === 'Formatted Markdown editor')
      ?.properties?.find((property) => property.name === 'readonly')?.value
      .value
  }
  if (cdp) expect(await readonly()).toBe(true)
  await page.evaluate(() =>
    window.selectionEditors[0]!.setEditingMode('source'),
  )
  await expect(page.locator('#editor-0 textarea')).not.toBeEditable()
  await page.evaluate(() => {
    window.selectionEditors[0]!.setEditable(true)
    window.selectionEditors[0]!.setEditingMode('formatted')
  })
  await expect(formatted).not.toHaveAttribute('aria-readonly')
  await expect(formatted).toBeEditable()
  if (cdp) {
    expect(await readonly()).toBe(false)
    await cdp.detach()
  }
})

test('selecting in one editor and then another paints only the latest selection', async ({
  page,
}) => {
  await mountPage(page, [sentence, 'Another editor here'])
  await word(page, 0)
  await expectPainted(page, ['First'])
  await word(page, 1)
  await expectPainted(page, ['Another'])
  await word(page, 0, 1)
  await expectPainted(page, ['Second'])
  // A caret placed in an editor shows no selection at all.
  await page.locator('#editor-1 .ProseMirror p').click()
  await expectPainted(page, [])
})

test('a native selection outside the editors replaces the painted one', async ({
  page,
}) => {
  await mountPage(page, [sentence, 'Another editor here'])
  await word(page, 0)
  await expectPainted(page, ['First'])
  await page.locator('#outside').click({ clickCount: 3 })
  expect(await page.evaluate(() => getSelection()!.toString())).toContain(
    'Plain page text',
  )
  await expectPainted(page, [])
  // Clicking page text without selecting anything also leaves nothing behind.
  await word(page, 1)
  await expectPainted(page, ['Another'])
  await page.locator('#outside').click({ position: { x: 5, y: 5 } })
  await expectPainted(page, [])
})

test('focus in a host field keeps the selection, in the inactive colour', async ({
  page,
}) => {
  await mountPage(page, [sentence])
  await word(page, 0)
  expect(await colour(page)).toBe(red)
  await page.locator('#field').click()
  await expect(page.locator('#field')).toBeFocused()
  await expectPainted(page, ['First'])
  expect(await colour(page)).toBe(blue)
  await page.keyboard.type('typed in the field')
  await expectPainted(page, ['First'])
  await word(page, 0, 1)
  await expectPainted(page, ['Second'])
  expect(await colour(page)).toBe(red)
})

test('a drag, a Shift-click and a copy leave one painted selection that the next click clears', async ({
  page,
}) => {
  await mountPage(page, [sentence])
  const paragraph = page.locator('#editor-0 .ProseMirror p').first()
  const box = (await paragraph.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await painted(page)).length).toBe(1)
  const first = (await painted(page))[0]!
  await paragraph.click({ position: { x: 150, y: 8 }, modifiers: ['Shift'] })
  await expect
    .poll(async () => (await painted(page))[0]?.length)
    .toBeGreaterThan(first.length)
  const extended = await painted(page)
  expect(extended).toHaveLength(1)
  await page.keyboard.press('ControlOrMeta+c')
  await expectPainted(page, extended)
  await paragraph.click({ position: { x: 100, y: 8 } })
  await expectPainted(page, [])
  await paragraph.click({ position: { x: 150, y: 8 }, modifiers: ['Shift'] })
  await expect.poll(async () => (await painted(page)).length).toBe(1)
})

test('a host blur with the window resigning keeps the inactive selection until another is made', async ({
  page,
}) => {
  await mountPage(page, [sentence, 'Another editor here'])
  await word(page, 0)
  await page.keyboard.press('ControlOrMeta+c')
  const state = () =>
    page.evaluate(() => ({
      painted: Array.from(
        CSS.highlights.get('inkkit-selection') ?? [],
        (range) => (range as Range).toString(),
      ),
      active: Array.from(document.querySelectorAll('.inkkit-root'), (root) =>
        root.classList.contains('inkkit-selection-active'),
      ),
      domRanges: getSelection()!.rangeCount,
      kept: window.selectionEditors[0]!.textSnapshot().selection,
    }))
  await expect
    .poll(state)
    .toMatchObject({ painted: ['First'], active: [true, false] })
  const before = await state()
  // The sequence a native host runs when its window resigns: blur(), then the window events.
  await page.evaluate(() => {
    window.selectionEditors[0]!.blur()
    window.dispatchEvent(new Event('blur'))
  })
  await expect.poll(state).toMatchObject({
    painted: ['First'],
    active: [false, false],
    domRanges: 0,
    kept: before.kept,
  })
  expect(await colour(page)).toBe(blue)
  // Returning to the window activates nothing until the host focuses the editor again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(state).toMatchObject({
    painted: ['First'],
    active: [false, false],
  })
  await page.evaluate(() => window.selectionEditors[0]!.focus())
  await expect.poll(state).toMatchObject({
    painted: ['First'],
    active: [true, false],
  })
  // The user then selects in the other editor, and nothing of the first remains.
  await page.evaluate(() => {
    window.selectionEditors[0]!.blur()
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
  })
  await word(page, 1)
  await expect.poll(state).toMatchObject({
    painted: ['Another'],
    active: [false, true],
  })
})

test('the selection fills only the text, never the margins or the gaps between blocks', async ({
  page,
}) => {
  await mountPage(page, [sentence])
  await page.locator('#editor-0 .ProseMirror').click()
  await page.keyboard.press('ControlOrMeta+a')
  await expect.poll(async () => (await painted(page)).length).toBe(3)
  const surface = page.locator('#editor-0 .ProseMirror')
  // The surface's own ::selection, which a descendant rule does not reach, is clear too.
  for (const selector of ['', ' p'])
    expect(
      await page
        .locator(`#editor-0 .ProseMirror${selector}`)
        .first()
        .evaluate(
          (node) => getComputedStyle(node, '::selection').backgroundColor,
        ),
    ).toBe('rgba(0, 0, 0, 0)')
  const clip = (await surface.boundingBox())!
  const stray = await page.evaluate(
    async ({ clip, png }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${png}`)).blob(),
      )
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const { data, width, height } = context.getImageData(
        0,
        0,
        bitmap.width,
        bitmap.height,
      )
      const scale = width / clip.width
      const lines = Array.from(
        document.querySelectorAll('#editor-0 .ProseMirror p'),
        (paragraph) => {
          const range = document.createRange()
          range.selectNodeContents(paragraph)
          return Array.from(range.getClientRects())
        },
      ).flat()
      let filled = 0
      let outside = 0
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (data[i]! < 200 || data[i + 1]! > 90 || data[i + 2]! > 90) continue
          filled++
          const px = clip.x + x / scale
          const py = clip.y + y / scale
          if (
            !lines.some(
              (r) =>
                px >= r.left - 1 &&
                px <= r.right + 1 &&
                py >= r.top - 1 &&
                py <= r.bottom + 1,
            )
          )
            outside++
        }
      return { filled, outside }
    },
    { clip, png: (await page.screenshot({ clip })).toString('base64') },
  )
  expect(stray.filled).toBeGreaterThan(200)
  expect(stray.outside).toBe(0)
})

test('source and TXT surfaces take the active and inactive colours from focus', async ({
  page,
}, testInfo) => {
  await mountPage(page, ['First café 😀', 'Second paragraph'])
  const surface = (editor: number) => page.locator(`#editor-${editor} textarea`)
  const selected = (editor: number) =>
    surface(editor).evaluate(
      (node) => getComputedStyle(node, '::selection').backgroundColor,
    )
  await page.evaluate(() => {
    const [one] = window.selectionEditors
    one!.setEditingMode('source')
  })
  await surface(0).focus()
  await surface(0).evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(0, 5),
  )
  await expect(page.locator('#editor-0')).toHaveClass(/inkkit-selection-active/)
  expect(await selected(0)).toBe(red)
  await page.screenshot({
    path: `_local/selection-source-active-${testInfo.project.name}.png`,
  })
  await page.locator('#editor-1 .ProseMirror').focus()
  await expect(page.locator('#editor-0')).not.toHaveClass(
    /inkkit-selection-active/,
  )
  expect(await selected(0)).toBe(blue)
  expect(
    await surface(0).evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]),
  ).toEqual([0, 5])
  await page.screenshot({
    path: `_local/selection-source-inactive-${testInfo.project.name}.png`,
  })
  await page.evaluate(() => {
    const editor = window.selectionEditors[0]!
    editor.loadDocument({
      documentId: 'literal',
      generation: 2,
      format: 'txt',
      text: 'literal café 😀\r\nsecond',
    })
    const snapshot = editor.textSnapshot()
    editor.selectTextRange(
      { snapshotId: snapshot.snapshotId, from: 0, to: 7 },
      { focus: true },
    )
  })
  await expect(page.locator('#editor-0')).toHaveClass(/inkkit-selection-active/)
  expect(await selected(0)).toBe(red)
  await page.evaluate(async () => {
    for (const editor of window.selectionEditors) await editor.destroy()
  })
  expect(
    await page.evaluate(
      () => Array.from(CSS.highlights.get('inkkit-selection') ?? []).length,
    ),
  ).toBe(0)
})

test('selecting in a read-only editor paints in the active colour and clears when the user selects elsewhere', async ({
  page,
}) => {
  await mountPage(page, [sentence, 'Another editor here'])
  await page.evaluate(() => window.selectionEditors[0]!.setEditable(false))
  await word(page, 0)
  await expectPainted(page, ['First'])
  await expect.poll(() => colour(page)).toBe(red)
  await word(page, 1)
  await expectPainted(page, ['Another'])
  await page.locator('#outside').click({ clickCount: 3 })
  await expectPainted(page, [])
})
