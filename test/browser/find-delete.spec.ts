import { test, expect, observe, operation } from './fixtures'

for (const position of ['first', 'middle'] as const)
  for (const arrow of ['ArrowLeft', 'ArrowRight'] as const)
    for (const deletion of ['Backspace', 'Delete'] as const)
      for (const moves of [1, 2])
        test(`find ${position} match, ${moves} ${arrow}, ${deletion}`, async ({
          page,
          openFixture,
        }) => {
          await openFixture()
          const prefix = position === 'first' ? '' : 'Alpha β😀 beta '
          const source = `${prefix}gamma delta.\r\n\r\nUntouched é 中文.\r\n`
          await page.evaluate(
            (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
            source,
          )
          await page
            .getByRole('textbox', { name: 'Host text', exact: true })
            .focus()
          expect(await operation(page, 'find', { text: 'gamma' })).toBe(true)
          // Do not wait for selectionchange: the next key must consume the caret
          // chosen by the arrow, even while focus correction is pending.
          for (let move = 0; move < moves; move++)
            await page.keyboard.press(arrow)
          await page.keyboard.press(deletion)

          const edge = arrow === 'ArrowLeft' ? prefix.length : prefix.length + 5
          const caret = Math.max(
            0,
            edge + (moves - 1) * (arrow === 'ArrowLeft' ? -1 : 1),
          )
          const removed = deletion === 'Backspace' ? caret - 1 : caret
          const expected =
            removed < 0
              ? source
              : source.slice(0, removed) + source.slice(removed + 1)
          const saved = (await observe(page)).snapshot!.text
          expect(saved).toBe(expected)
          await operation(page, 'undo')
          expect((await observe(page)).snapshot!.text).toBe(source)
          await page.evaluate(
            (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
            saved,
          )
          expect((await observe(page)).snapshot!.text).toBe(expected)
        })
