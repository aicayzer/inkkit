import { test, expect } from './fixtures'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const cases = [
  {
    name: 'full repeated-BOM percent-comment selection',
    text: '\uFEFF\uFEFFbefore %%PRIVATE%% after\uFEFFend\r\n',
    bodyOnly: false,
    readable: '\uFEFFbefore  after\uFEFFend',
  },
  {
    name: 'private HTML-comment body after CRLF',
    text: '\uFEFF\uFEFFpre\r\nL <!--PRIVATE--> R\r\nkeep\uFEFFend',
    bodyOnly: true,
    readable: '',
  },
] as const

for (const fixture of cases)
  test(`source DOM copy and clipboardSnapshot hide ${fixture.name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    const result = await page.evaluate(
      async ({ moduleUrl, fixture }) => {
        const { InkKitEditor } = await import(moduleUrl)
        const root = document.createElement('div')
        document.body.append(root)
        let changes = 0
        const errors: string[] = []
        const editor = await InkKitEditor.mount(root, {
          changed() {
            changes++
          },
          copy() {},
          openLink() {},
          error(error: Error) {
            errors.push(error.message)
          },
        })
        const input = {
          documentId: 'bom-comment-browser',
          generation: 1,
          format: 'md',
          text: fixture.text,
        }
        try {
          editor.loadDocument(input)
          editor.setEditingMode('source')
          const area = root.querySelector('textarea')!
          area.focus()
          const start = fixture.bodyOnly ? area.value.indexOf('PRIVATE') : 0
          const end = fixture.bodyOnly ? start + 7 : area.value.length
          area.setSelectionRange(start, end, 'backward')
          const state = () => ({
            snapshot: editor.snapshot(),
            undo: editor.commandState().commands.undo,
            redo: editor.commandState().commands.redo,
            selection: [
              area.selectionStart,
              area.selectionEnd,
              area.selectionDirection,
            ],
            changes,
          })
          const before = state()
          const transfer = new DataTransfer()
          const event = new ClipboardEvent('copy', {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          })
          area.dispatchEvent(event)
          const ordinary = {
            text: transfer.getData('text/plain'),
            html: transfer.getData('text/html'),
          }
          const afterDOMCopy = state()
          const portable = await editor.clipboardSnapshot('selection')
          const afterSnapshot = state()
          editor.loadDocument({
            ...input,
            generation: 2,
            text: editor.snapshot().text,
          })
          return {
            before,
            afterDOMCopy,
            afterSnapshot,
            ordinary,
            portable,
            prevented: event.defaultPrevented,
            errors,
            reopened: editor.snapshot(),
          }
        } finally {
          await editor.destroy()
          root.remove()
        }
      },
      { moduleUrl, fixture },
    )
    expect(result.prevented).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.ordinary.text).toBe(fixture.readable)
    expect(result.ordinary.html).not.toContain('PRIVATE')
    expect(result.portable.text).toBe(fixture.readable)
    expect(result.portable.html).not.toContain('PRIVATE')
    expect(result.portable.markdown).toBe(
      fixture.bodyOnly ? 'PRIVATE' : fixture.text,
    )
    expect(result.afterDOMCopy).toEqual(result.before)
    expect(result.afterSnapshot).toEqual(result.before)
    expect(result.reopened).toMatchObject({
      generation: 2,
      text: fixture.text,
      dirty: false,
      revision: 0,
    })
  })
