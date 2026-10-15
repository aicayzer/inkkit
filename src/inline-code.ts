import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

// Inline code does not continue past the end of its span, so that text typed
// after a span stays outside it. A code mark that was asked for at a caret
// would then apply to one character only, since ProseMirror clears stored
// marks when text goes in. This keeps the stored mark while the text typed
// under it lands at the caret, as bold does, until the command is toggled or
// the caret moves.
export const storedInlineCode = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('storedInlineCode'),
      appendTransaction(transactions, oldState, newState) {
        const type = inlineCodeSchema.type(ctx)
        const stored = oldState.storedMarks
        if (
          !stored ||
          !type.isInSet(stored) ||
          newState.storedMarks ||
          !newState.selection.empty ||
          !transactions.some((tr) => tr.docChanged)
        )
          return null
        // The text that went in at the old caret, which ends at the new one.
        const start = transactions.reduce(
          (pos, tr) => tr.mapping.map(pos, -1),
          oldState.selection.from,
        )
        const end = newState.selection.from
        if (start >= end) return null
        let typed = true
        newState.doc.nodesBetween(start, end, (node) => {
          if (node.isText && !type.isInSet(node.marks)) typed = false
        })
        return typed ? newState.tr.setStoredMarks(stored) : null
      },
    }),
)
