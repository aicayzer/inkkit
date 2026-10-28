import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const pixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

test('appendImages adds images below a long document without moving focus, scroll or the selection', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  const result = await page.evaluate(
    async ({ moduleUrl, pixel }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const button = document.createElement('button')
      button.textContent = 'Elsewhere'
      const root = document.createElement('div')
      root.style.cssText = 'height:240px;overflow:auto;width:480px'
      document.body.append(button, root)
      const editor = await InkKitEditor.mount(
        root,
        { changed() {} },
        {
          images: {
            presentation: () => ({ url: pixel }),
            importImage: async () => ({ reference: 'x.png' }),
            exportImage: async () => ({
              bytes: new Uint8Array(),
              mimeType: 'image/png',
            }),
          },
        },
      )
      const filler = Array.from({ length: 30 }, (_, i) => `Line ${i}\n`).join(
        '\n',
      )
      editor.loadDocument({
        documentId: 'note',
        generation: 1,
        format: 'md',
        text: `${filler}\n| A | B |\n| - | - |\n| c | d |\n`,
      })
      const drawn = async () => {
        await Promise.all(
          [...root.querySelectorAll('img')].map((image) => image.decode()),
        )
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve)),
        )
      }
      await drawn()
      const measure = () => {
        const selection = getSelection()!
        return {
          active: document.activeElement === button ? 'button' : 'other',
          scroll: root.scrollTop,
          selection: `${selection.anchorNode?.textContent}:${selection.anchorOffset}`,
        }
      }
      // The person is working in the top of the document.
      editor.find('Line 3')
      editor.focus()
      root.scrollTop = 120
      await drawn()
      const typing = measure()
      const first = editor.appendImages([{ reference: 'a.png', alt: 'A' }])
      await drawn()
      const whileEditing = measure()
      // Focus is on another control: appending must not take it.
      button.focus()
      const second = editor.appendImages([{ reference: 'b.png', alt: 'B' }])
      await drawn()
      const away = measure()
      const images = root.querySelectorAll('.inkkit-image img').length
      const text = editor.snapshot().text
      await editor.destroy()
      return { first, second, typing, whileEditing, away, images, text }
    },
    { moduleUrl, pixel },
  )
  expect(result.first).toBe(true)
  expect(result.second).toBe(true)
  expect(result.whileEditing.scroll).toBe(result.typing.scroll)
  expect(result.whileEditing.active).toBe(result.typing.active)
  expect(result.whileEditing.selection).toBe(result.typing.selection)
  expect(result.away.active).toBe('button')
  expect(result.away.scroll).toBe(result.typing.scroll)
  expect(result.images).toBe(2)
  expect(result.text).toMatch(
    /\| c \| d \|\n\n!\[A\]\(a\.png\)\n\n!\[B\]\(b\.png\)\n$/,
  )
})
