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
  await expect(
    page.locator('.ProseMirror .inkkit-image img').first(),
  ).toBeVisible()
}

const text = async (page: Page) => (await observe(page)).snapshot!.text
const selectedImage = (page: Page) =>
  page.locator('.inkkit-image-block.ProseMirror-selectednode')

/** Waits until the page stops scrolling. WebKit reveals a typed caret a frame or more after the
 *  keystroke, so a point measured before then is no longer over the same content when it is used. */
async function scrollSettled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let previous = NaN
        let still = 0
        const frame = () => {
          const top = document
            .querySelector('.ProseMirror')!
            .getBoundingClientRect().top
          still = top === previous ? still + 1 : 0
          previous = top
          if (still >= 3) resolve()
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }),
  )
}

/** Puts a real caret in the paragraph holding `content`, at its start or end, and waits until the
 *  editor has read it. */
async function caretIn(page: Page, content: string, side: 'start' | 'end') {
  const line = page.locator('.ProseMirror p', { hasText: content })
  await scrollSettled(page)
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
  const card = page.locator('.inkkit-image-block > .inkkit-image').nth(index)
  const row = page.locator('.inkkit-image-block').nth(index)
  await scrollSettled(page)
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
      { reference: 'images/one.png', alt: 'One' },
      { reference: 'images/two.png', alt: 'Two' },
    ],
  })
  await page.keyboard.type('Typed')
  expect(await text(page)).toBe(
    'Start\n\n![One](images/one.png)\n\n![Two](images/two.png)\n\nTyped\n\n![Fixture](images/native.png)\n',
  )
  await scrollSettled(page)
  const last = (await page.locator('.inkkit-image-block').last().boundingBox())!
  await operation(page, 'insertImages', {
    images: [{ reference: 'images/drop.png', alt: 'Drop' }],
    at: { clientX: last.x + 10, clientY: last.y + last.height / 2 },
  })
  await page.keyboard.type('End')
  expect(await text(page)).toBe(
    'Start\n\n![One](images/one.png)\n\n![Two](images/two.png)\n\nTyped\n\n![Fixture](images/native.png)\n\n![Drop](images/drop.png)\n\nEnd\n',
  )
})

test('inserting images with the caret in a table cell puts them inline in it', async ({
  page,
}) => {
  const source = '| Name | Size |\n| --- | --- |\n| one | two |\n'
  await open(page, `${source}\n![Fixture](images/native.png)\n`)
  await caretIn(page, 'two', 'end')
  await operation(page, 'insertImages', {
    images: [
      { reference: 'images/one.png', alt: 'One' },
      { reference: 'images/two.png', alt: 'Two' },
    ],
  })
  await page.keyboard.type('!')
  const saved = `| Name | Size |\n| --- | --- |\n| one | two![One](images/one.png)![Two](images/two.png)! |\n\n![Fixture](images/native.png)\n`
  expect(await text(page)).toBe(saved)
  await expect(page.locator('td .inkkit-image')).toHaveCount(2)
  await operation(page, 'undo')
  await operation(page, 'undo')
  expect(await text(page)).toBe(`${source}\n![Fixture](images/native.png)\n`)
  await operation(page, 'redo')
  await operation(page, 'redo')
  expect(await text(page)).toBe(saved)
})

test('inserting images with the caret in a code block places them after it', async ({
  page,
}) => {
  await open(page, '```\ncode\n```\n\n![Fixture](images/native.png)\n')
  const code = page.locator('.ProseMirror pre', { hasText: 'code' })
  const box = (await code.boundingBox())!
  await page.mouse.click(box.x + 20, box.y + box.height / 2)
  await expect
    .poll(async () => (await observe(page)).commandState!.caret.block.type)
    .toBe('codeBlock')
  await operation(page, 'insertImages', {
    images: [{ reference: 'images/one.png', alt: 'One' }],
  })
  expect(await text(page)).toBe(
    '```\ncode\n```\n\n![One](images/one.png)\n\n![Fixture](images/native.png)\n',
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

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a picture that loads is drawn bare with a centred grip in ${colorScheme} @linked-files`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await open(page, '![[Photo|160]]\n\nAfter\n', 'linked-files')
    const card = page.locator('.inkkit-file')
    await card.hover()
    const layout = await card.evaluate((element) => {
      const style = getComputedStyle(element)
      const image = element.querySelector('img')!
      return {
        card: element.getBoundingClientRect().toJSON(),
        image: image.getBoundingClientRect().toJSON(),
        grip: element
          .querySelector('.inkkit-image-handle')!
          .getBoundingClientRect()
          .toJSON(),
        border: style.borderTopWidth,
        padding: style.paddingTop + style.paddingLeft,
        radius: getComputedStyle(image).borderTopLeftRadius,
        title: element.getAttribute('title'),
        text: element.textContent,
        controls: element.querySelectorAll('button').length,
      }
    })
    // The card is exactly the picture: no border, padding or caption row.
    expect(layout.border).toBe('0px')
    expect(layout.padding).toBe('0px0px')
    expect(layout.radius).not.toBe('0px')
    expect(Math.abs(layout.card.height - layout.image.height)).toBeLessThan(1)
    expect(Math.abs(layout.card.width - layout.image.width)).toBeLessThan(1)
    expect(layout.title).toBe('Photo')
    expect(layout.text).toBe('')
    expect(layout.controls).toBe(0)
    const centre = (rect: { top: number; height: number }) =>
      rect.top + rect.height / 2
    expect(Math.abs(centre(layout.grip) - centre(layout.card))).toBeLessThan(2)
    expect(layout.grip.right).toBeLessThanOrEqual(layout.card.right + 1)
    await testInfo.attach(`${colorScheme}-picture`, {
      body: await card.screenshot(),
      contentType: 'image/png',
    })
  })

  test(`a file card's name and arrow are one link in ${colorScheme} @linked-files`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await open(page, '![[Archive]]\n\n![[Photo|60]]\n', 'linked-files')
    const card = page.locator('.inkkit-file[data-inkkit-file-kind="file"]')
    const link = card.getByRole('button', { name: 'Open Archive' })
    const label = link.locator('.inkkit-file-label')
    const arrow = link.locator('svg')
    const look = () =>
      link.evaluate((element) => {
        const label = element.querySelector('.inkkit-file-label')!
        const svg = element.querySelector('svg')!
        return {
          underline: getComputedStyle(label).textDecorationLine,
          labelColor: getComputedStyle(label).color,
          arrowColor: getComputedStyle(svg).color,
          arrowBackground: getComputedStyle(svg).backgroundColor,
          gap:
            svg.getBoundingClientRect().left -
            label.getBoundingClientRect().right,
        }
      })
    // The name is inside the control, and the arrow follows it closely.
    expect((await look()).gap).toBeLessThanOrEqual(8)
    const rest = await look()
    expect(rest.underline).toBe('none')
    await testInfo.attach(`${colorScheme}-file-rest`, {
      body: await card.screenshot(),
      contentType: 'image/png',
    })
    // Hovering the name marks the arrow, and hovering the arrow marks the name.
    await label.hover()
    const overName = await look()
    expect(overName.underline).toBe('underline')
    expect(overName.arrowColor).not.toBe(rest.arrowColor)
    expect(overName.arrowBackground).not.toBe(rest.arrowBackground)
    await testInfo.attach(`${colorScheme}-file-hover`, {
      body: await card.screenshot(),
      contentType: 'image/png',
    })
    await page.mouse.move(0, 0)
    await arrow.hover()
    const overArrow = await look()
    expect(overArrow.underline).toBe('underline')
    expect(overArrow.labelColor).toBe(overName.labelColor)
    // A click on the name opens, as does one on the arrow.
    await label.click()
    await arrow.click()
    const events = (await operation(page, 'fileEvents')) as {
      operation: string
      reference?: string
    }[]
    expect(
      events.filter((e) => e.operation === 'open' && e.reference === 'Archive'),
    ).toHaveLength(2)
  })
}

test('the readable range of a standalone image covers its card, not the whole row', async ({
  page,
}) => {
  await open(page, standalone)
  const snapshot = (await operation(page, 'textSnapshot')) as {
    snapshotId: string
    text: string
  }
  const from = snapshot.text.indexOf('Fixture')
  const rects = (
    (await operation(page, 'textRangesRects', {
      ranges: [{ snapshotId: snapshot.snapshotId, from, to: from + 7 }],
    })) as { left: number; width: number }[][]
  )[0]!
  const card = (await page
    .locator('.inkkit-image-block > .inkkit-image')
    .boundingBox())!
  const row = (await page.locator('.inkkit-image-block').boundingBox())!
  expect(row.width).toBeGreaterThan(card.width + 20)
  expect(rects).toHaveLength(1)
  expect(Math.abs(rects[0]!.width - card.width)).toBeLessThan(2)
  expect(Math.abs(rects[0]!.left - card.x)).toBeLessThan(2)
})
