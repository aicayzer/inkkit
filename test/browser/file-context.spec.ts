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
