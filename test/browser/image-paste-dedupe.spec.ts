import { expect, test, type Page } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

interface Item {
  name?: string
  type: string
  bytes: number[]
}

/** A PNG header with a size, then filler. Nothing here needs to decode. */
function png(width: number, height: number, seed = 0): Item['bytes'] {
  const u32 = (value: number) => [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]
  return [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
    seed,
    seed,
    seed,
    seed,
  ]
}

/** A little-endian TIFF whose first directory holds only the size. */
function tiff(width: number, height: number, seed = 0): Item['bytes'] {
  const u16 = (value: number) => [value & 255, (value >>> 8) & 255]
  const u32 = (value: number) => [...u16(value), ...u16(value >>> 16)]
  const entry = (tag: number, value: number) => [
    ...u16(tag),
    ...u16(4),
    ...u32(1),
    ...u32(value),
  ]
  return [
    0x49,
    0x49,
    0x2a,
    0,
    ...u32(8),
    ...u16(2),
    ...entry(256, width),
    ...entry(257, height),
    ...u32(0),
    seed,
    seed,
    seed,
    seed,
  ]
}

const item = (name: string, bytes: number[]): Item => ({
  name,
  type: name.endsWith('.tiff') ? 'image/tiff' : 'image/png',
  bytes,
})

type Route = 'api' | 'clipboard' | 'web' | 'drop'

async function paste(
  page: Page,
  route: Route,
  items: Item[],
  options: { reject?: boolean } = {},
) {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  return page.evaluate(
    async ({ moduleUrl, route, items, reject }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const root = document.createElement('div')
      document.body.append(root)
      const imports: { name?: string; type: string; length: number }[] = []
      const errors: string[] = []
      let started = false
      let finish!: () => void
      const imported = new Promise<void>((resolve) => {
        finish = resolve
      })
      const editor = await InkKitEditor.mount(
        root,
        {
          changed() {},
          error: (error) => errors.push(error.code),
          commandStateChanged(state) {
            if (state.pending) started = true
            else if (started) finish()
          },
        },
        {
          images: {
            presentation: () => undefined,
            exportImage: async () => ({
              bytes: new Uint8Array([1]),
              mimeType: 'image/png',
            }),
            importImage: async (input) => {
              imports.push({
                name: input.filename,
                type: input.mimeType,
                length: input.bytes.length,
              })
              if (reject) throw new Error('refused')
              return { reference: `images/${imports.length}.png` }
            },
          },
        },
      )
      try {
        editor.loadDocument({
          documentId: 'dedupe',
          generation: 1,
          format: 'md',
          text: 'Before\n',
        })
        const bytes = items.map((entry) => new Uint8Array(entry.bytes))
        const html =
          route === 'web' || route === 'drop'
            ? '<p>Look <img src="https://example.test/shot.png" alt="Shot"></p>'
            : ''
        if (route === 'api') {
          await editor.paste({
            text: '',
            html: html || undefined,
            images: items.map((entry, index) => ({
              bytes: bytes[index]!,
              mimeType: entry.type,
              filename: entry.name,
            })),
          })
        } else {
          const transfer = new DataTransfer()
          items.forEach((entry, index) =>
            transfer.items.add(
              new File([bytes[index]!], entry.name ?? '', { type: entry.type }),
            ),
          )
          if (html) transfer.setData('text/html', html)
          const target = root.querySelector('.ProseMirror')!
          if (route === 'drop') {
            const rect = target.getBoundingClientRect()
            target.dispatchEvent(
              new DragEvent('drop', {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 20,
                clientY: rect.top + 10,
              }),
            )
          } else
            target.dispatchEvent(
              new ClipboardEvent('paste', {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              }),
            )
          await imported
          // The DOM handler reports a rejected import after pending becomes false.
          await new Promise<void>((resolve) => queueMicrotask(resolve))
        }
        return { imports, errors, text: editor.snapshot().text }
      } finally {
        await editor.destroy()
        root.remove()
      }
    },
    { moduleUrl, route, items, reject: options.reject ?? false },
  )
}

const count = (text: string, pattern: RegExp) =>
  text.match(pattern)?.length ?? 0

for (const route of ['api', 'clipboard'] as const) {
  test.describe(`one picture in several representations, ${route}`, () => {
    test('PNG with TIFF of the same size imports once, as the PNG', async ({
      page,
    }) => {
      const result = await paste(page, route, [
        item('Screenshot.tiff', tiff(640, 480, 1)),
        item('Screenshot.png', png(640, 480, 2)),
      ])
      expect(result.imports).toEqual([
        { name: 'Screenshot.png', type: 'image/png', length: 33 },
      ])
      expect(count(result.text, /!\[/g)).toBe(1)
      expect(result.errors).toEqual([])
    })

    test('PNG with PNG of identical bytes imports once', async ({ page }) => {
      const result = await paste(page, route, [
        item('image.png', png(10, 10, 3)),
        item('image.png', png(10, 10, 3)),
      ])
      expect(result.imports).toHaveLength(1)
      expect(count(result.text, /!\[/g)).toBe(1)
    })

    test('a single PNG imports once', async ({ page }) => {
      const result = await paste(page, route, [item('image.png', png(10, 10))])
      expect(result.imports).toHaveLength(1)
      expect(count(result.text, /!\[/g)).toBe(1)
    })

    test('a single TIFF imports once', async ({ page }) => {
      const result = await paste(page, route, [
        item('image.tiff', tiff(10, 10)),
      ])
      expect(result.imports).toEqual([
        { name: 'image.tiff', type: 'image/tiff', length: 42 },
      ])
      expect(count(result.text, /!\[/g)).toBe(1)
    })

    test('two different images import twice, in order', async ({ page }) => {
      const result = await paste(page, route, [
        item('one.png', png(640, 480, 1)),
        item('two.png', png(640, 480, 2)),
      ])
      expect(result.imports.map((entry) => entry.name)).toEqual([
        'one.png',
        'two.png',
      ])
      expect(count(result.text, /!\[/g)).toBe(2)
    })

    test('a PNG and TIFF that differ in size or name stay separate', async ({
      page,
    }) => {
      const size = await paste(page, route, [
        item('Screenshot.png', png(640, 480)),
        item('Screenshot.tiff', tiff(320, 240)),
      ])
      expect(size.imports).toHaveLength(2)
      const name = await paste(page, route, [
        item('One.png', png(640, 480)),
        item('Two.tiff', tiff(640, 480)),
      ])
      expect(name.imports).toHaveLength(2)
    })

    test('an unreadable TIFF is never matched to a PNG', async ({ page }) => {
      const result = await paste(page, route, [
        item('image.png', png(10, 10)),
        item('image.tiff', [0x49, 0x49, 0x2a, 0, 0xff, 0xff, 0xff, 0x7f]),
      ])
      expect(result.imports).toHaveLength(2)
    })

    test('a refused import leaves one placeholder, not two', async ({
      page,
    }) => {
      const result = await paste(
        page,
        route,
        [
          item('Screenshot.png', png(64, 64, 1)),
          item('Screenshot.tiff', tiff(64, 64, 2)),
        ],
        { reject: true },
      )
      expect(result.imports).toHaveLength(1)
      expect(result.errors).toEqual(['image-unavailable'])
      expect(count(result.text, /image unavailable/g)).toBe(1)
    })
  })
}

for (const route of ['web', 'drop'] as const) {
  test(`a copied web image with PNG and TIFF files inserts once, ${route}`, async ({
    page,
  }) => {
    const result = await paste(page, route, [
      item('image.png', png(640, 480, 1)),
      item('image.tiff', tiff(640, 480, 2)),
    ])
    expect(result.imports).toHaveLength(1)
    expect(result.text).toContain('images/1.png')
    expect(result.text).not.toContain('unavailable')
    expect(count(result.text, /!\[/g)).toBe(1)
  })
}
