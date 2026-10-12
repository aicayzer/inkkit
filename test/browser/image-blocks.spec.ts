import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const standalone = 'Before\n\n![Fixture](images/native.png)\n\nAfter\n'

async function open(page: Page, text: string, fixture = 'images') {
  await page.goto(`/?fixture=${fixture}&configuration=rich`)
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe(`fixture:${fixture}`)
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
  await expect(page.locator('.ProseMirror .image img').first()).toBeVisible()
}

const text = async (page: Page) => (await observe(page)).snapshot!.text
const selectedImage = (page: Page) =>
  page.locator('.inkkit-image-block.ProseMirror-selectednode')

/** Puts a real caret in the paragraph holding `content`, at its start or end, and waits until the
 *  editor has read it. */
async function caretIn(page: Page, content: string, side: 'start' | 'end') {
  const line = page.locator('.ProseMirror p', { hasText: content })
  const box = (await line.boundingBox())!
  await page.mouse.click(
    side === 'start' ? box.x + 1 : box.x + box.width - 1,
    box.y + box.height / 2,
  )
  await page.keyboard.press(side === 'start' ? 'Home' : 'End')
  await expect
    .poll(async () => {
      const snapshot = (await observe(page)).textSnapshot!
      const at = snapshot.text.indexOf(content)
      return snapshot.selection.from - at
    })
    .toBe(side === 'start' ? 0 : content.length)
}

async function clickBesideImage(page: Page, index = 0) {
  const card = page.locator('.inkkit-image-block > .image').nth(index)
  const row = page.locator('.inkkit-image-block').nth(index)
  const cardBox = (await card.boundingBox())!
  const rowBox = (await row.boundingBox())!
  expect(rowBox.x + rowBox.width).toBeGreaterThan(
    cardBox.x + cardBox.width + 20,
  )
  await page.mouse.click(
    cardBox.x + cardBox.width + 20,
    cardBox.y + cardBox.height / 2,
  )
}

test('typing after clicking beside an image writes a paragraph below it', async ({
  page,
}) => {
  await open(page, standalone)
  await clickBesideImage(page)
  await expect(page.locator('.ProseMirror-gapcursor')).toHaveCount(1)
  await page.keyboard.type('Typed')
  expect(await text(page)).toBe(
    'Before\n\n![Fixture](images/native.png)\n\nTyped\n\nAfter\n',
  )
  // The text lands on its own line, below the card.
  const card = (await page.locator('.inkkit-image-block').boundingBox())!
  const typed = (await page
    .locator('.ProseMirror p', { hasText: 'Typed' })
    .boundingBox())!
  expect(typed.y).toBeGreaterThanOrEqual(card.y + card.height)
  await operation(page, 'undo')
  expect(await text(page)).toBe(standalone)
  await operation(page, 'redo')
  expect(await text(page)).toBe(
    'Before\n\n![Fixture](images/native.png)\n\nTyped\n\nAfter\n',
  )
})

test('Enter beside an image opens a paragraph, and typing on a selected image keeps it', async ({
  page,
}) => {
  await open(page, standalone)
  await clickBesideImage(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Line')
  expect(await text(page)).toBe(
    'Before\n\n![Fixture](images/native.png)\n\nLine\n\nAfter\n',
  )
  await page.locator('.inkkit-image-block img').click()
  await expect(selectedImage(page)).toHaveCount(1)
  await page.keyboard.type('Z')
  expect(await text(page)).toBe(
    'Before\n\n![Fixture](images/native.png)\n\nZ\n\nLine\n\nAfter\n',
  )
})

test('arrow keys move past an image, selecting it on the way', async ({
  page,
}) => {
  await open(page, standalone)
  await caretIn(page, 'Before', 'end')
  await page.keyboard.press('ArrowDown')
  await expect(selectedImage(page)).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await expect(selectedImage(page)).toHaveCount(0)
  await page.keyboard.type('X')
  expect(await text(page)).toBe(
    'Before\n\n![Fixture](images/native.png)\n\nXAfter\n',
  )
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ArrowUp')
  await expect(selectedImage(page)).toHaveCount(1)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('End')
  await page.keyboard.type('Y')
  expect(await text(page)).toBe(
    'BeforeY\n\n![Fixture](images/native.png)\n\nAfter\n',
  )
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ArrowRight')
  await expect(selectedImage(page)).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('Z')
  expect(await text(page)).toBe(
    'Before\n\n![Fixture](images/native.png)\n\nZAfter\n',
  )
  await page.keyboard.press('Backspace')
  await page.keyboard.press('ArrowLeft')
  await expect(selectedImage(page)).toHaveCount(1)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('W')
  expect(await text(page)).toBe(
    'BeforeW\n\n![Fixture](images/native.png)\n\nAfter\n',
  )
})

test('Backspace and Delete next to an image select it first and never join text to it', async ({
  page,
}) => {
  await open(page, standalone)
  await caretIn(page, 'After', 'start')
  await page.keyboard.press('Backspace')
  await expect(selectedImage(page)).toHaveCount(1)
  expect(await text(page)).toBe(standalone)
  await page.keyboard.press('Backspace')
  expect(await text(page)).toBe('Before\n\nAfter\n')
  await operation(page, 'undo')
  expect(await text(page)).toBe(standalone)
  await caretIn(page, 'Before', 'end')
  await page.keyboard.press('Delete')
  await expect(selectedImage(page)).toHaveCount(1)
  expect(await text(page)).toBe(standalone)
  await page.keyboard.press('Delete')
  expect(await text(page)).toBe('Before\n\nAfter\n')
})

test('inserting images leaves the caret below the last one, by API and at a drop point', async ({
  page,
}) => {
  await open(page, 'Start\n\n![Fixture](images/native.png)\n')
  await caretIn(page, 'Start', 'end')
  await operation(page, 'insertImages', {
    images: [
      { path: 'images/one.png', alt: 'One' },
      { path: 'images/two.png', alt: 'Two' },
    ],
  })
  await page.keyboard.type('Typed')
  expect(await text(page)).toBe(
    'Start\n\n![One](images/one.png)\n\n![Two](images/two.png)\n\nTyped\n\n![Fixture](images/native.png)\n',
  )
  const last = (await page.locator('.inkkit-image-block').last().boundingBox())!
  await operation(page, 'insertImages', {
    images: [{ path: 'images/drop.png', alt: 'Drop' }],
    x: last.x + 10,
    y: last.y + last.height / 2,
  })
  await page.keyboard.type('End')
  expect(await text(page)).toBe(
    'Start\n\n![One](images/one.png)\n\n![Two](images/two.png)\n\nTyped\n\n![Fixture](images/native.png)\n\n![Drop](images/drop.png)\n\nEnd\n',
  )
})

test('pasting text beside an image writes a separate paragraph', async ({
  page,
}) => {
  await open(page, standalone)
  await clickBesideImage(page)
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'Pasted')
    document.querySelector('.ProseMirror.editor')!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expect
    .poll(() => text(page))
    .toBe('Before\n\n![Fixture](images/native.png)\n\nPasted\n\nAfter\n')
})

test('IME composition beside a selected image composes below it (Chromium IME emulation)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Uses the Chromium DevTools protocol')
  await open(page, standalone)
  await page.locator('.inkkit-image-block img').click()
  await expect(selectedImage(page)).toHaveCount(1)
  const client = await page.context().newCDPSession(page)
  await client.send('Input.imeSetComposition', {
    text: 'か',
    selectionStart: 1,
    selectionEnd: 1,
  })
  await client.send('Input.imeSetComposition', {
    text: 'かな',
    selectionStart: 2,
    selectionEnd: 2,
  })
  await client.send('Input.insertText', { text: '仮名' })
  await expect
    .poll(() => text(page))
    .toBe('Before\n\n![Fixture](images/native.png)\n\n仮名\n\nAfter\n')
  await expect(page.locator('.inkkit-image-block img')).toBeVisible()
})

test('a card that shares a paragraph with text sits on its own line @linked-files', async ({
  page,
}) => {
  const mixed = 'Text before ![[Photo|120]] and after.\n'
  await open(page, mixed, 'linked-files')
  const card = (await page.locator('.inkkit-file').boundingBox())!
  const paragraph = page.locator('.ProseMirror p').first()
  const lines = await paragraph.evaluate((element) => {
    const range = document.createRange()
    const rects: DOMRect[] = []
    for (const node of element.childNodes)
      if (node.nodeType === Node.TEXT_NODE) {
        range.selectNodeContents(node)
        rects.push(...range.getClientRects())
      }
    return rects.map((rect) => ({ top: rect.top, bottom: rect.bottom }))
  })
  expect(lines.length).toBeGreaterThanOrEqual(2)
  for (const line of lines)
    expect(
      line.bottom <= card.y + 1 || line.top >= card.y + card.height - 1,
    ).toBe(true)
  expect(await text(page)).toBe(mixed)
})

for (const colorScheme of ['light', 'dark'] as const)
  test(`card shows a compact open arrow after the name and a centred grip in ${colorScheme} @linked-files`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await open(page, '![[Photo|160]]\n\nAfter\n', 'linked-files')
    const card = page.locator('.inkkit-file')
    await card.hover()
    const layout = await card.evaluate((element) => {
      const box = (selector: string) =>
        element.querySelector(selector)!.getBoundingClientRect().toJSON()
      return {
        card: element.getBoundingClientRect().toJSON(),
        image: box('img'),
        footer: box('.inkkit-file-footer'),
        label: box('.inkkit-file-label'),
        open: box('.inkkit-file-open'),
        grip: box('.image-handle'),
        openText: element.querySelector('.inkkit-file-open')!.textContent,
      }
    })
    const centre = (rect: { top: number; height: number }) =>
      rect.top + rect.height / 2
    expect(Math.abs(centre(layout.grip) - centre(layout.card))).toBeLessThan(2)
    expect(layout.footer.top - layout.image.bottom).toBeLessThanOrEqual(6)
    expect(layout.open.left - layout.label.right).toBeLessThanOrEqual(6)
    expect(layout.open.left).toBeGreaterThanOrEqual(layout.label.right - 1)
    expect(layout.open.height).toBeLessThanOrEqual(24)
    expect(layout.openText).toBe('')
    await testInfo.attach(`${colorScheme}-card`, {
      body: await card.screenshot(),
      contentType: 'image/png',
    })
  })
