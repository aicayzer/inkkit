import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const route = ['clipboard', 'drop'] as const

for (const kind of route)
  for (const withAdapter of [false, true])
    test(`a ${kind} of an image ${withAdapter ? 'is imported with an adapter' : 'is refused without one'}`, async ({
      page,
    }) => {
      await page.goto('/')
      await page.waitForFunction(() => Boolean(window.inkkitPlayground))
      const result = await page.evaluate(
        async ({ moduleUrl, kind, withAdapter }) => {
          const { InkKitEditor } = (await import(
            moduleUrl
          )) as typeof import('../../src/core')
          const root = document.createElement('div')
          document.body.append(root)
          const errors: string[] = []
          const editor = await InkKitEditor.mount(
            root,
            { changed() {}, error: (error) => errors.push(error.code) },
            withAdapter
              ? {
                  images: {
                    presentation: () => undefined,
                    exportImage: async () => ({
                      bytes: new Uint8Array([1]),
                      mimeType: 'image/png',
                    }),
                    importImage: async () => ({ reference: 'images/a.png' }),
                  },
                }
              : {},
          )
          try {
            editor.loadDocument({
              documentId: 'refusal',
              generation: 1,
              format: 'md',
              text: 'Before\n',
            })
            const transfer = new DataTransfer()
            transfer.items.add(
              new File([new Uint8Array([1, 2, 3])], 'shot.png', {
                type: 'image/png',
              }),
            )
            const target = root.querySelector('.ProseMirror')!
            const rect = target.getBoundingClientRect()
            const event =
              kind === 'drop'
                ? new DragEvent('drop', {
                    dataTransfer: transfer,
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + 20,
                    clientY: rect.top + 10,
                  })
                : new ClipboardEvent('paste', {
                    clipboardData: transfer,
                    bubbles: true,
                    cancelable: true,
                  })
            target.dispatchEvent(event)
            await new Promise((resolve) => setTimeout(resolve, 50))
            return {
              errors,
              prevented: event.defaultPrevented,
              text: editor.snapshot().text,
            }
          } finally {
            await editor.destroy()
            root.remove()
          }
        },
        { moduleUrl, kind, withAdapter },
      )
      if (withAdapter) expect(result.errors).toEqual([])
      else {
        expect(result.errors).toEqual(['image-unsupported'])
        expect(result.prevented).toBe(true)
        expect(result.text).toBe('Before\n')
      }
      if (withAdapter && kind === 'clipboard')
        expect(result.text).toContain('images/a.png')
    })
