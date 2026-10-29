import { expect, test } from 'vitest'
import { input, withEditor } from '../harness'

// Formatting that a link at the start of its parent shares with the text after it is written once
// around both. The writer once wrote the link and the text twice there.
for (const source of [
  '~~[x](https://a.example/)b~~',
  '**[x](https://a.example/) b**',
  '<sup>[x](https://a.example/)b</sup>',
])
  test(`a copy of ${source} writes it once`, () =>
    withEditor(undefined, async ({ editor }) => {
      editor.loadDocument(input('md', `${source}\n`))
      const readable = editor.textSnapshot()
      editor.selectTextRange({
        snapshotId: readable.snapshotId,
        from: 0,
        to: readable.text.length,
      })
      const { markdown } = await editor.clipboardSnapshot('selection')
      // The link is written once, and so is the text after it.
      expect(markdown.split('https://a.example/')).toHaveLength(2)
      expect(markdown.match(/b/g)).toHaveLength(1)
    }))
