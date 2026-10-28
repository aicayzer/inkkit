import { expect } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { InkKitEditor } from '../src/core'
import { ctxOf } from './editor-access'

// The differential algorithms also have to save through the facade hosts use.
export function expectFacadeSave(
  editor: InkKitEditor,
  source: string,
  doc: ProseNode,
  expected: string,
  label: string,
): void {
  const generation = editor.snapshot().generation + 1
  editor.loadDocument({
    documentId: 'preservation',
    generation,
    format: 'md',
    text: source,
  })
  const view = ctxOf(editor).get(editorViewCtx)
  view.dispatch(
    view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content),
  )
  const saved = editor.snapshot().text
  expect(saved, label).toBe(expected)
  editor.loadDocument({
    documentId: 'reopened',
    generation: generation + 1,
    format: 'md',
    text: saved,
  })
  expect(editor.snapshot().text, `${label}, reopened`).toBe(saved)
}
