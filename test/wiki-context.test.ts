import { afterEach, expect, test } from 'vitest'
import { InkKitEditor, type WikiLinkReference } from '../src/core'
const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})
async function mount(text: string) {
  const root = document.createElement('div')
  document.body.append(root)
  const resolved: WikiLinkReference[] = [],
    opened: WikiLinkReference[] = [],
    errors: unknown[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      error(e) {
        errors.push(e)
      },
    },
    {
      wikiLinks: {
        resolve(r) {
          resolved.push({ ...r })
          return { missing: false }
        },
        open(r) {
          opened.push({ ...r })
        },
      },
    },
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'context',
    generation: 1,
    format: 'md',
    text,
  })
  return { editor, root, resolved, opened, errors }
}
for (const ending of ['\n', '\r\n'])
  for (const raw of ['Plan|Plan', ' Café\\日本語 # section | alias\\\\name ']) {
    test(`pasted wiki raw follows table context ${JSON.stringify({ ending, raw })}`, async () => {
      const source =
        'Before  \n\n| TARGET | B |\n| --- | --- |\n| c | d |\n\nAfter _kept_.\n'.replaceAll(
          '\n',
          ending,
        )
      const host = await mount(source)
      host.editor.find('TARGET')
      await host.editor.paste({ text: 'Plan', markdown: `[[${raw}]]` }, 1)
      const tableRaw = raw.replace(
        /(\\*)\|/g,
        (_m, slashes: string) => '\\'.repeat(slashes.length * 2 + 1) + '|',
      )
      const saved = host.editor.snapshot().text
      expect(saved).toBe(source.replace('TARGET', `[[${tableRaw}]]`))
      const check = async (
        h: Awaited<ReturnType<typeof mount>>,
        expected: string,
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        h.root
          .querySelector('[role=link]')!
          .dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
          )
        expect(h.resolved.at(-1)?.raw).toBe(expected)
        expect(h.opened.at(-1)?.raw).toBe(expected)
        expect(h.errors).toEqual([])
      }
      await check(host, `[[${tableRaw}]]`)
      await check(await mount(saved), `[[${tableRaw}]]`)
      expect(host.editor.undo()).toBe(true)
      expect(host.editor.snapshot().text).toBe(source)
      expect(host.editor.redo()).toBe(true)
      expect(host.editor.snapshot().text).toBe(saved)
      await check(host, `[[${tableRaw}]]`)
      // Adapter callbacks already ran during dispatch, before any reopen.
      expect(
        host.resolved.every((reference) => reference.raw === `[[${tableRaw}]]`),
      ).toBe(true)
    })
  }

test('table-authored Markdown clipboard adopts paragraph spelling', async () => {
  const table = await mount('| [[Plan\\|Plan]] |\n| --- |\n')
  const text = table.editor.textSnapshot()
  const from = text.text.indexOf('Plan')
  table.editor.selectTextRange({
    snapshotId: text.snapshotId,
    from,
    to: from + 4,
  })
  const copied = await table.editor.clipboardSnapshot('selection')
  expect(copied.text).toBe('Plan')
  expect(copied.markdown).toBe('[[Plan|Plan]]\n')
  const host = await mount('TARGET\n')
  host.editor.find('TARGET')
  await host.editor.paste({ text: copied.text, markdown: copied.markdown }, 1)
  expect(host.editor.snapshot().text).toBe('[[Plan|Plan]]\n')
  expect(host.resolved.every((r) => r.raw === '[[Plan|Plan]]')).toBe(true)
  host.root
    .querySelector('[role=link]')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
  expect(host.opened.at(-1)?.raw).toBe('[[Plan|Plan]]')
  expect(host.errors).toEqual([])
})

test('refused table pastes do not publish context changes or history', async () => {
  const source = '| TARGET |\n| --- |\n'
  const host = await mount(source)
  host.editor.find('TARGET')
  const before = host.editor.snapshot()
  const input = { text: 'Plan', markdown: '[[Plan|Plan]]' }
  await expect(host.editor.paste(input, 2)).rejects.toMatchObject({
    code: 'stale-document',
  })
  host.editor.setEditable(false)
  await expect(host.editor.paste(input, 1)).rejects.toMatchObject({
    code: 'read-only',
  })
  expect(host.editor.snapshot()).toEqual(before)
  expect(host.resolved).toEqual([])
  expect(host.opened).toEqual([])
  host.editor.setEditable(true)
  expect(host.editor.undo()).toBe(false)
})
