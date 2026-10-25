import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

for (const html of [false, true]) {
  test(`cancel a stalled ${html ? 'HTML' : 'file'} image paste, save and keep typing`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.inkkitPlayground))
    const result = await page.evaluate(
      async ({ moduleUrl, html }) => {
        const { InkKitEditor } = (await import(
          moduleUrl
        )) as typeof import('../../src/core')
        const root = document.createElement('div')
        document.body.append(root)
        let signal!: AbortSignal
        let finish!: (value: { reference: string }) => void
        let changes = 0
        const editor = await InkKitEditor.mount(
          root,
          {
            changed() {
              changes++
            },
          },
          {
            images: {
              presentation: () => undefined,
              exportImage: async () => ({
                bytes: new Uint8Array([1]),
                mimeType: 'image/png',
              }),
              importImage: (_, context) => {
                signal = context.signal
                return new Promise((resolve) => {
                  finish = resolve
                })
              },
            },
          },
        )
        try {
          editor.loadDocument({
            documentId: 'cancel',
            generation: 1,
            format: 'md',
            text: 'Café\r\n',
          })
          const before = editor.snapshot()
          const pending = editor
            .paste({
              text: 'not inserted',
              ...(html
                ? { html: '<p>not inserted<img src="captured"></p>' }
                : {}),
              images: [
                {
                  bytes: new Uint8Array([1]),
                  mimeType: 'image/png',
                  source: 'captured',
                },
              ],
            })
            .then(
              () => 'resolved',
              (error) => error.code,
            )
          const wasPending = editor.commandState().pending
          editor.cancelPendingImports(1)
          const error = await pending
          const saved = editor.snapshot()
          const changeCount = changes
          finish({ reference: 'late.png' })
          await Promise.resolve()
          await Promise.resolve()
          const afterLateResult = editor.snapshot()
          editor.loadDocument({ ...saved, generation: 2 })
          const reopened = editor.snapshot().text
          editor.insertText(' new text', 2)
          return {
            before,
            saved,
            afterLateResult,
            reopened,
            error,
            aborted: signal.aborted,
            wasPending,
            editable: editor.editable,
            changeCount,
            typed: editor.snapshot().text,
          }
        } finally {
          await editor.destroy()
          root.remove()
        }
      },
      { moduleUrl, html },
    )
    expect(result.wasPending).toBe(true)
    expect(result.error).toBe('stale-document')
    expect(result.aborted).toBe(true)
    expect(result.editable).toBe(true)
    expect(result.saved).toEqual(result.before)
    expect(result.afterLateResult).toEqual(result.before)
    expect(result.reopened).toBe(result.before.text)
    expect(result.changeCount).toBe(0)
    expect(result.typed).toContain(' new text')
    expect(result.typed).not.toContain('late.png')
  })
}
