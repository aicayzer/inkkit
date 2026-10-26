import { expect, test } from '@playwright/test'
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
test('file raw follows saved table spelling before and after reopen', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  const results = await page.evaluate(async (moduleUrl) => {
    const { InkKitEditor } = await import(moduleUrl)
    const all = []
    for (const ending of ['\n', '\r\n'])
      for (const token of [
        '![[photo.png|400]]',
        '![alt](a\\_b.png)',
        '![a|b](a.png)',
        '![a&amp;b](a.png)',
        '![a\\|b](a.png)',
      ]) {
        const root = document.createElement('div')
        document.body.append(root)
        const calls: any[] = []
        const errors: any[] = []
        const editor = await InkKitEditor.mount(
          root,
          {
            changed() {},
            error(e: any) {
              errors.push(e.code)
            },
          },
          {
            files: {
              async resolve(r: any) {
                calls.push(['resolve', r.raw])
                return {
                  kind: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                }
              },
              async exportImage(r: any) {
                calls.push(['export', r.raw])
                return {
                  bytes: new Uint8Array([71, 73, 70, 56, 57, 97]),
                  mimeType: 'image/gif',
                }
              },
              open(r: any) {
                calls.push(['open', r.raw])
              },
              contextMenu(r: any) {
                calls.push(['context', r.raw])
              },
            },
          },
        )
        const source =
          'Before  \n\n| TARGET | B |\n| --- | --- |\n| c | d |\n\nAfter _kept_.\n'.replaceAll(
            '\n',
            ending,
          )
        editor.loadDocument({
          documentId: 'a',
          generation: 1,
          format: 'md',
          text: source,
        })
        editor.find('TARGET')
        await editor.paste({ text: token, markdown: 'x ' + token + ' y' }, 1)
        await new Promise((r) => setTimeout(r, 20))
        const saved = editor.snapshot()
        const actions = () => {
          root
            .querySelector<HTMLButtonElement>('button[aria-label^=Open]')
            ?.click()
          root
            .querySelector('.inkkit-file')
            ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        }
        actions()
        await editor.clipboardSnapshot('document')
        const before = calls.splice(0)
        const undone = editor.undo()
        const undoText = editor.snapshot().text
        const redone = editor.redo()
        const redoText = editor.snapshot().text
        calls.splice(0)
        editor.loadDocument({
          documentId: 'b',
          generation: 2,
          format: 'md',
          text: saved.text,
        })
        await new Promise((r) => setTimeout(r, 20))
        actions()
        await editor.clipboardSnapshot('document')
        const after = calls.splice(0)
        all.push({
          token,
          source,
          saved: saved.text,
          before,
          after,
          errors,
          undone,
          undoText,
          redone,
          redoText,
        })
        await editor.destroy()
        root.remove()
      }
    return all
  }, moduleUrl)
  for (const r of results) {
    const raw = r.token.includes('[[photo')
      ? r.token.replace('|', '\\|')
      : r.token.replace(/(?<!\\)\|/g, '\\|')
    expect(r.saved).toBe(r.source.replace('TARGET', 'x ' + raw + ' y'))
    expect(r.before.length).toBeGreaterThanOrEqual(4)
    for (const calls of [r.before, r.after]) {
      expect(calls.map((c) => c[0])).toEqual([
        'resolve',
        'open',
        'context',
        'resolve',
        'export',
      ])
      expect(calls.every((c) => c[1] === raw)).toBe(true)
    }
    expect(r.undone).toBe(true)
    expect(r.undoText).toBe(r.source)
    expect(r.redone).toBe(true)
    expect(r.redoText).toBe(r.saved)
    expect(r.errors).toEqual([])
  }
})

for (const wrapper of ['strong', 'link'])
  test(`resizing a ${wrapper}-wrapped image keeps token raw stable`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.inkkitPlayground))
    const result = await page.evaluate(
      async ({ moduleUrl, wrapper }) => {
        const { InkKitEditor } = await import(moduleUrl)
        const token = '![alt](a.png)'
        const resized = '![alt|101](a.png)'
        const wrap = (s: string) =>
          wrapper === 'strong' ? `**${s}**` : `[${s}](https://example.com)`
        const source = `Before _kept_.\r\n\r\n${wrap(token)}\r\n\r\nAfter.\r\n`
        const root = document.createElement('div')
        document.body.append(root)
        const calls: string[][] = []
        const errors: string[] = []
        const editor = await InkKitEditor.mount(
          root,
          {
            changed() {},
            error(e: any) {
              errors.push(e.code)
            },
          },
          {
            files: {
              async resolve(r: any) {
                calls.push(['resolve', r.raw])
                return {
                  kind: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                }
              },
              open(r: any) {
                calls.push(['open', r.raw])
              },
              contextMenu(r: any) {
                calls.push(['context', r.raw])
              },
              async exportImage(r: any) {
                calls.push(['export', r.raw])
                return {
                  bytes: new Uint8Array([71, 73, 70, 56, 57, 97]),
                  mimeType: 'image/gif',
                }
              },
            },
          },
        )
        const settle = () => new Promise((r) => setTimeout(r, 30))
        editor.loadDocument({
          documentId: 'a',
          generation: 1,
          format: 'md',
          text: source,
        })
        await settle()
        calls.splice(0)
        const handle = root.querySelector('.inkkit-image-handle')!
        for (const [type, clientX] of [
          ['pointerdown', 0],
          ['pointermove', 100],
          ['pointerup', 100],
        ] as const)
          handle.dispatchEvent(
            new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }),
          )
        await settle()
        const saved = editor.snapshot().text
        const actions = async () => {
          root
            .querySelector<HTMLButtonElement>('button[aria-label^=Open]')!
            .click()
          root
            .querySelector('.inkkit-file')!
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
          await editor.clipboardSnapshot('document')
        }
        await actions()
        const before = calls.splice(0)
        const undone = editor.undo()
        const undoText = editor.snapshot().text
        const redone = editor.redo()
        const redoText = editor.snapshot().text
        await settle()
        calls.splice(0)
        editor.loadDocument({
          documentId: 'b',
          generation: 2,
          format: 'md',
          text: saved,
        })
        await settle()
        await actions()
        const after = calls.splice(0)
        await editor.destroy()
        root.remove()
        return {
          source,
          expected: source.replace(token, resized),
          resized,
          saved,
          before,
          after,
          undone,
          undoText,
          redone,
          redoText,
          errors,
        }
      },
      { moduleUrl, wrapper },
    )
    expect(result.saved).toBe(result.expected)
    expect(result.undone).toBe(true)
    expect(result.undoText).toBe(result.source)
    expect(result.redone).toBe(true)
    expect(result.redoText).toBe(result.saved)
    for (const calls of [result.before, result.after]) {
      expect(calls.map((c) => c[0])).toEqual([
        'resolve',
        'open',
        'context',
        'resolve',
        'export',
      ])
      expect(calls.every((c) => c[1] === result.resized)).toBe(true)
    }
    expect(result.errors).toEqual([])
  })

for (const [kind, tableRaw, paragraphRaw] of [
  ['named', '![[photo.png\\|40]]', '![[photo.png|40]]'],
  ['path', '![a&amp;b\\|40](a\\_b.png)', '![a&amp;b\\|40](a\\_b.png)'],
] as const)
  test(`dragging a ${kind} image out of a table updates its raw context`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.inkkitPlayground))
    const source = `| before ${tableRaw} after | B |\n| --- | --- |\n| c | d |\n\nDestination paragraph.\n`
    await page.evaluate(
      async ({ moduleUrl, source }) => {
        const { InkKitEditor } = await import(moduleUrl)
        const root = document.createElement('div')
        root.id = 'file-transfer'
        document.body.prepend(root)
        const calls: string[][] = []
        const errors: string[] = []
        const editor = await InkKitEditor.mount(
          root,
          {
            changed() {},
            error(e: any) {
              errors.push(e.code)
            },
          },
          {
            files: {
              async resolve(r: any) {
                calls.push(['resolve', r.raw])
                return {
                  kind: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                }
              },
              open(r: any) {
                calls.push(['open', r.raw])
              },
              contextMenu(r: any) {
                calls.push(['context', r.raw])
              },
              async exportImage(r: any) {
                calls.push(['export', r.raw])
                return {
                  bytes: new Uint8Array([71, 73, 70, 56, 57, 97]),
                  mimeType: 'image/gif',
                }
              },
            },
          },
        )
        editor.loadDocument({
          documentId: 'transfer',
          generation: 1,
          format: 'md',
          text: source,
        })
        Object.assign(window, { fileTransfer: { editor, calls, errors } })
      },
      { moduleUrl, source },
    )
    const image = page.locator('#file-transfer img')
    await expect(image).toBeVisible()
    await image.click()
    const start = (await image.boundingBox())!
    const end = (await page
      .locator('#file-transfer p', { hasText: 'Destination paragraph.' })
      .boundingBox())!
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      start.x + start.width / 2 + 15,
      start.y + start.height / 2 + 15,
      { steps: 10 },
    )
    await page.mouse.move(end.x + 60, end.y + end.height / 2, { steps: 20 })
    await page.mouse.up()
    const result = await page.evaluate(async () => {
      const { editor, calls, errors } = (window as any).fileTransfer
      const root = document.querySelector('#file-transfer')!
      const saved = editor.snapshot().text
      const transfer = calls.splice(0)
      const actions = async () => {
        root
          .querySelector<HTMLButtonElement>('button[aria-label^=Open]')!
          .click()
        root
          .querySelector('.inkkit-file')!
          .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        await editor.clipboardSnapshot('document')
      }
      await actions()
      const before = calls.splice(0)
      const undone = editor.undo()
      const undoText = editor.snapshot().text
      const redone = editor.redo()
      const redoText = editor.snapshot().text
      calls.splice(0)
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: saved,
      })
      await new Promise((r) => setTimeout(r, 30))
      await actions()
      const after = calls.splice(0)
      await editor.destroy()
      root.remove()
      return {
        saved,
        transfer,
        before,
        after,
        undone,
        undoText,
        redone,
        redoText,
        errors,
      }
    })
    expect(result.saved).toBe(
      source
        .replace(tableRaw, '')
        .replace(
          'Destination paragraph.',
          `${paragraphRaw}\n\nDestination paragraph.`,
        ),
    )
    expect(result.transfer).toEqual([
      ['resolve', tableRaw],
      ['resolve', paragraphRaw],
    ])
    expect(result.undone).toBe(true)
    expect(result.undoText).toBe(source)
    expect(result.redone).toBe(true)
    expect(result.redoText).toBe(result.saved)
    expect(result.before.map((call: string[]) => call[0])).toEqual([
      'open',
      'context',
      'resolve',
      'export',
    ])
    expect(result.after.map((call: string[]) => call[0])).toEqual([
      'resolve',
      'open',
      'context',
      'resolve',
      'export',
    ])
    for (const calls of [result.before, result.after])
      expect(calls.every((call: string[]) => call[1] === paragraphRaw)).toBe(
        true,
      )
    expect(result.errors).toEqual([])
  })
