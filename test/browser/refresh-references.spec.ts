import { expect, test } from '@playwright/test'

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
const pixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

test('refreshReferences updates links and cards in place, with the scroll position, caret and revision kept', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  const result = await page.evaluate(
    async ({ moduleUrl, pixel }) => {
      const { InkKitEditor } = (await import(
        moduleUrl
      )) as typeof import('../../src/core')
      const root = document.createElement('div')
      root.style.cssText = 'height:240px;overflow:auto;width:480px'
      document.body.append(root)
      const known = new Set<string>()
      const answers: Promise<import('../../src/core').FilePresentation>[] = []
      let ready = false
      const asked: string[] = []
      const errors: string[] = []
      const editor = await InkKitEditor.mount(
        root,
        { changed() {}, error: (e) => errors.push(e.code) },
        {
          wikiLinks: {
            open() {},
            resolve(r) {
              asked.push(`wiki:${r.target}`)
              return { missing: !known.has(r.target) }
            },
          },
          files: {
            resolve(r) {
              asked.push(`file:${r.target}`)
              const answer = Promise.resolve(
                ready
                  ? { kind: 'image' as const, url: pixel }
                  : { kind: 'missing' as const, label: r.target },
              )
              answers.push(answer)
              return answer
            },
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
        text: `${filler}\nA [[Plan]] and\n\n![[pic.png|120]]\n\nEnd\n`,
      })
      const settle = async () => {
        await Promise.all(answers.splice(0))
        // File resolution wraps the answer before applying its presentation.
        await new Promise<void>((resolve) => setTimeout(resolve))
        if (
          root.querySelector<HTMLElement>('.inkkit-file')?.dataset
            .inkkitFileState !== 'resolved'
        )
          throw new Error('The refreshed file card is not ready')
        await Promise.all(
          [...root.querySelectorAll('img')].map((image) => image.decode()),
        )
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve)),
        )
      }
      await settle()
      const link = root.querySelector<HTMLElement>('.inkkit-wiki-link')!
      const card = () => root.querySelector<HTMLElement>('.inkkit-file')!
      editor.find('Line 3')
      editor.focus()
      root.scrollTop = 150
      await settle()
      const selection = () => {
        const s = getSelection()!
        return [s.anchorNode?.textContent, s.anchorOffset, s.focusOffset]
      }
      const before = {
        top: root.scrollTop,
        selection: selection(),
        revision: editor.snapshot().revision,
        missing: link.dataset.missing,
        kind: card().dataset.inkkitFileKind,
        height: card().getBoundingClientRect().height,
      }
      asked.length = 0
      // Nothing changed behind the references: nothing may move.
      editor.refreshReferences()
      await settle()
      const unchanged = {
        top: root.scrollTop,
        height: card().getBoundingClientRect().height,
        asked: [...asked].sort(),
      }
      known.add('Plan')
      ready = true
      asked.length = 0
      editor.refreshReferences(['Plan', 'pic.png'])
      await settle()
      const after = {
        top: root.scrollTop,
        selection: selection(),
        revision: editor.snapshot().revision,
        missing: link.dataset.missing,
        sameLink: link === root.querySelector('.inkkit-wiki-link'),
        kind: card().dataset.inkkitFileKind,
        asked: [...asked].sort(),
        undo: editor.commandState().commands.undo,
      }
      await editor.destroy()
      root.remove()
      return { before, unchanged, after, errors }
    },
    { moduleUrl, pixel },
  )
  expect(result.errors).toEqual([])
  expect(result.before.missing).toBe('true')
  expect(result.before.kind).toBe('missing')
  expect(result.unchanged.top).toBe(result.before.top)
  expect(result.unchanged.height).toBe(result.before.height)
  expect(result.unchanged.asked).toEqual(['file:pic.png', 'wiki:Plan'])
  expect(result.after.missing).toBeUndefined()
  expect(result.after.sameLink).toBe(true)
  expect(result.after.kind).toBe('image')
  expect(result.after.asked).toEqual(['file:pic.png', 'wiki:Plan'])
  expect(result.after.selection).toEqual(result.before.selection)
  expect(result.after.revision).toBe(result.before.revision)
  expect(result.after.undo).toBe(false)
  // A card that grows from a missing card to a picture may move the page below it, but not the
  // view's scroll anchor above it.
  expect(result.after.top).toBe(result.before.top)
})
