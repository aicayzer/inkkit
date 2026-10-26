import { expect, test } from '@playwright/test'
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
for (const ending of ['\n', '\r\n'])
  test(`wiki paste callbacks use saved table spelling ${JSON.stringify(ending)}`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.inkkitPlayground))
    const result = await page.evaluate(
      async ({ moduleUrl, ending }) => {
        const { InkKitEditor } = (await import(
          moduleUrl
        )) as typeof import('../../src/core')
        const root = document.createElement('div')
        document.body.append(root)
        const resolved: string[] = [],
          opened: string[] = [],
          errors: string[] = []
        const editor = await InkKitEditor.mount(
          root,
          {
            changed() {},
            error(e) {
              errors.push(e.code)
            },
          },
          {
            wikiLinks: {
              resolve(r) {
                resolved.push(r.raw)
                return { missing: false }
              },
              open(r) {
                opened.push(r.raw)
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
          documentId: 'context',
          generation: 1,
          format: 'md',
          text: source,
        })
        editor.find('TARGET')
        const revision = editor.snapshot().revision
        await editor.paste({ text: 'Plan', markdown: '[[Plan|Plan]]' }, 1)
        const saved = editor.snapshot()
        root
          .querySelector('[role=link]')!
          .dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
          )
        const undone = editor.undo() && editor.snapshot().text === source
        const redone = editor.redo() && editor.snapshot().text === saved.text
        editor.loadDocument({
          documentId: 'reopen',
          generation: 2,
          format: 'md',
          text: saved.text,
        })
        root
          .querySelector('[role=link]')!
          .dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
          )
        await editor.destroy()
        root.remove()
        return {
          resolved,
          opened,
          errors,
          undone,
          redone,
          text: saved.text,
          expected: source.replace('TARGET', '[[Plan\\|Plan]]'),
          revisions: saved.revision - revision,
        }
      },
      { moduleUrl, ending },
    )
    expect(result.text).toBe(result.expected)
    expect(result.resolved.every((raw) => raw === '[[Plan\\|Plan]]')).toBe(true)
    expect(result.opened).toEqual(['[[Plan\\|Plan]]', '[[Plan\\|Plan]]'])
    expect(result.errors).toEqual([])
    expect(result.undone).toBe(true)
    expect(result.redone).toBe(true)
    expect(result.revisions).toBe(1)
  })
