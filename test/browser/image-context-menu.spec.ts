import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

// A visible 40 x 40 square, so the image has a size to click.
const pixel =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="gray"/></svg>',
  )

type Variant = 'hook' | 'none' | 'throws'

interface Probe {
  calls: {
    reference: string
    clientX: number
    clientY: number
    documentId: string
    generation: number
  }[]
  errors: string[]
  prevented: boolean[]
  destroy(): Promise<void>
  snapshot(): string
}

declare global {
  interface Window {
    menuProbe: Probe
  }
}

for (const block of [false, true]) {
  for (const variant of ['hook', 'none', 'throws'] as Variant[]) {
    test(`right-click on ${block ? 'a standalone' : 'an inline'} image, ${variant}`, async ({
      page,
    }) => {
      await page.goto('/')
      await page.waitForFunction(() => Boolean(window.inkkitPlayground))
      await page.evaluate(
        async ({ moduleUrl, pixel, variant, block }) => {
          const { InkKitEditor } = (await import(
            moduleUrl
          )) as typeof import('../../src/core')
          const root = document.createElement('div')
          root.id = 'menu-root'
          document.body.append(root)
          const probe: Probe = {
            calls: [],
            errors: [],
            prevented: [],
            destroy: async () => {
              await editor.destroy()
              root.remove()
            },
            snapshot: () => editor.snapshot().text,
          }
          const editor = await InkKitEditor.mount(
            root,
            { changed() {}, error: (error) => probe.errors.push(error.code) },
            {
              images: {
                presentation: () => ({ url: pixel }),
                exportImage: async () => ({
                  bytes: new Uint8Array([1]),
                  mimeType: 'image/png',
                }),
                importImage: async () => ({ reference: 'images/new.png' }),
                ...(variant === 'none'
                  ? {}
                  : {
                      contextMenu(reference, point, context) {
                        probe.calls.push({
                          reference,
                          ...point,
                          documentId: context.documentId,
                          generation: context.generation,
                        })
                        if (variant === 'throws') throw new Error('refused')
                      },
                    }),
              },
            },
          )
          document.addEventListener('contextmenu', (event) =>
            probe.prevented.push(event.defaultPrevented),
          )
          editor.loadDocument({
            documentId: 'menu',
            generation: 7,
            format: 'md',
            text: block
              ? 'Before\n\n![Alt](images/a.png)\n\nAfter\n'
              : 'Before ![Alt](images/a.png) after\n',
          })
          window.menuProbe = probe
        },
        { moduleUrl, pixel, variant, block },
      )
      const image = page.locator('#menu-root img')
      await expect(image).toBeVisible()
      const before = await page.evaluate(() => window.menuProbe.snapshot())
      // The resize handle covers the middle of the picture.
      await image.click({ button: 'right', position: { x: 4, y: 4 } })
      const box = (await image.boundingBox())!
      const probe = await page.evaluate(() => ({
        calls: window.menuProbe.calls,
        errors: window.menuProbe.errors,
        prevented: window.menuProbe.prevented,
        selected: document.querySelectorAll(
          '#menu-root .ProseMirror-selectednode',
        ).length,
        text: window.menuProbe.snapshot(),
      }))
      expect(probe.prevented).toEqual([variant !== 'none'])
      expect(probe.text).toBe(before)
      if (variant === 'none') {
        expect(probe.calls).toEqual([])
      } else {
        expect(probe.calls).toHaveLength(1)
        const call = probe.calls[0]!
        expect(call.reference).toBe('images/a.png')
        expect(call.documentId).toBe('menu')
        expect(call.generation).toBe(7)
        expect(call.clientX).toBeCloseTo(box.x + 4, 0)
        expect(call.clientY).toBeCloseTo(box.y + 4, 0)
        expect(probe.selected).toBe(1)
      }
      expect(probe.errors).toEqual(
        variant === 'throws' ? ['image-unavailable'] : [],
      )
      await page.evaluate(() => window.menuProbe.destroy())
    })
  }
}
