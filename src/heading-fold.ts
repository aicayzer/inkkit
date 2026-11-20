import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Selection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { displayCtx } from './display'
import { editorLabels } from './labels'
import type { EditorLabels } from './types'

/**
 * Folds are presentation: plugin state holds the positions of the folded top-level headings, and
 * decorations hide what each one covers, so the document, its attributes and its history never
 * change. The positions follow edits through the transaction mapping.
 */
interface Folds {
  enabled: boolean
  /** Document positions of folded headings, in ascending order. */
  folded: readonly number[]
  decorations: DecorationSet
}

interface FoldMeta {
  enabled?: boolean
  toggle?: number
  clear?: boolean
}

const foldKey = new PluginKey<Folds>('inkkitHeadingFold')

/** The end of the section that starts at the top-level heading at `pos`. */
function sectionEnd(doc: ProseNode, pos: number, level: number): number {
  let end = pos
  let stopped = false
  doc.forEach((child, offset) => {
    if (stopped || offset < pos) return
    if (
      offset > pos &&
      child.type.name === 'heading' &&
      Number(child.attrs.level) <= level
    ) {
      stopped = true
      return
    }
    end = offset + child.nodeSize
  })
  return end
}

function headingAt(doc: ProseNode, pos: number): ProseNode | undefined {
  if (pos < 0 || pos > doc.content.size) return undefined
  const $pos = doc.resolve(pos)
  return $pos.depth === 0 && $pos.nodeAfter?.type.name === 'heading'
    ? $pos.nodeAfter
    : undefined
}

/** Whether the selection is in the hidden part of a section, or moves into it. */
function reaches(selection: Selection, from: number, to: number): boolean {
  if (selection instanceof AllSelection) return false
  if (selection instanceof NodeSelection)
    return selection.from < to && selection.to > from
  return [selection.anchor, selection.head].some((at) => at >= from && at <= to)
}

function mapFolds(
  folded: readonly number[],
  tr: Transaction,
  before: ProseNode,
): number[] {
  const kept: number[] = []
  for (const pos of folded) {
    const result = tr.mapping.mapResult(pos, 1)
    const node = headingAt(tr.doc, result.pos)
    if (!node) continue
    // A level change replaces the heading's boundary tokens, which maps as a deletion.
    if (result.deleted && !node.content.eq(headingAt(before, pos)!.content))
      continue
    if (!kept.includes(result.pos)) kept.push(result.pos)
  }
  return kept.sort((a, b) => a - b)
}

function foldDecorations(
  doc: ProseNode,
  folded: readonly number[],
): DecorationSet {
  const found: Decoration[] = []
  const hidden = new Set<number>()
  for (const pos of folded) {
    const heading = headingAt(doc, pos)
    if (!heading) continue
    const end = sectionEnd(doc, pos, Number(heading.attrs.level))
    let at = pos + heading.nodeSize
    while (at < end) {
      const block = doc.nodeAt(at)!
      if (!hidden.has(at)) {
        hidden.add(at)
        found.push(
          Decoration.node(at, at + block.nodeSize, {
            class: 'inkkit-folded-content',
            'aria-hidden': 'true',
          }),
        )
      }
      at += block.nodeSize
    }
  }
  return DecorationSet.create(doc, found)
}

type Labels = () => Readonly<EditorLabels>

function controls(doc: ProseNode, labels: Labels): Decoration[] {
  const found: Decoration[] = []
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return
    found.push(
      Decoration.widget(
        offset + 1,
        (view, getPos) => control(view, getPos, labels),
        {
          side: -1,
          key: 'heading-fold',
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    )
  })
  return found
}

const positions = new WeakMap<HTMLElement, () => number | undefined>()

function control(
  view: EditorView,
  getPos: () => number | undefined,
  labels: Labels,
): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'inkkit-heading-fold'
  wrapper.contentEditable = 'false'
  const button = document.createElement('button')
  button.type = 'button'
  button.tabIndex = 0
  button.setAttribute('data-inkkit-heading-toggle', '')
  // The pointer must not move the caret out of the text it is in.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    const at = getPos()
    if (at != null) toggleHeadingFold(view, at - 1)
  })
  wrapper.append(button)
  positions.set(button, getPos)
  syncControl(view.state, button, getPos(), labels)
  return wrapper
}

function syncControl(
  state: EditorState,
  button: HTMLButtonElement,
  at: number | undefined,
  labels: Labels,
): void {
  const folded =
    at != null && (foldKey.getState(state)?.folded.includes(at - 1) ?? false)
  const text = button.parentElement?.parentElement?.textContent?.trim() ?? ''
  const name = folded ? labels().unfoldHeading : labels().foldHeading
  const label = `${name} ${text}`.trim()
  if (button.getAttribute('aria-label') !== label)
    button.setAttribute('aria-label', label)
  const expanded = String(!folded)
  if (button.getAttribute('aria-expanded') !== expanded)
    button.setAttribute('aria-expanded', expanded)
}

/** Folds or unfolds the top-level heading at `pos`. Folding moves a selection in the section to the heading. */
export function toggleHeadingFold(view: EditorView, pos: number): void {
  const state = foldKey.getState(view.state)
  const heading = headingAt(view.state.doc, pos)
  if (!state?.enabled || !heading) return
  const tr = view.state.tr
    .setMeta(foldKey, { toggle: pos } satisfies FoldMeta)
    .setMeta('addToHistory', false)
  if (!state.folded.includes(pos)) {
    const from = pos + heading.nodeSize
    const to = sectionEnd(view.state.doc, pos, Number(heading.attrs.level))
    if (reaches(view.state.selection, from, to))
      tr.setSelection(TextSelection.create(tr.doc, from - 1))
  }
  view.dispatch(tr)
}

/** Turns folding on or off in the transaction. Turning it off unfolds everything. */
export function setHeadingFolding(tr: Transaction, enabled: boolean): void {
  tr.setMeta(foldKey, { enabled } satisfies FoldMeta)
}

/** Unfolds every section. A switch of editing mode clears the folds this way. */
export function clearHeadingFolds(view: EditorView): void {
  if (!foldKey.getState(view.state)?.folded.length) return
  view.dispatch(
    view.state.tr
      .setMeta(foldKey, { clear: true } satisfies FoldMeta)
      .setMeta('addToHistory', false),
  )
}

/** The folded headings' positions, for tests. */
export function foldedHeadings(state: EditorState): readonly number[] {
  return foldKey.getState(state)?.folded ?? []
}

export const headingFold = $prose((ctx) => {
  const labels: Labels = () => editorLabels(ctx)
  return new Plugin<Folds>({
    key: foldKey,
    state: {
      init: (_, state) => {
        const enabled = ctx.get(displayCtx.key)().foldHeadings
        return {
          enabled,
          folded: [],
          decorations: enabled
            ? DecorationSet.create(state.doc, controls(state.doc, labels))
            : DecorationSet.empty,
        }
      },
      apply(tr, previous, oldState, state) {
        const meta = tr.getMeta(foldKey) as FoldMeta | undefined
        const enabled = meta?.enabled ?? previous.enabled
        if (!enabled)
          return enabled === previous.enabled && !previous.folded.length
            ? previous
            : { enabled, folded: [], decorations: DecorationSet.empty }
        let folded = previous.folded
        if (meta?.clear) folded = []
        if (tr.docChanged && folded.length)
          folded = mapFolds(folded, tr, oldState.doc)
        if (meta?.toggle != null && headingAt(tr.doc, meta.toggle))
          folded = folded.includes(meta.toggle)
            ? folded.filter((pos) => pos !== meta.toggle)
            : [...folded, meta.toggle].sort((a, b) => a - b)
        // The caret or selection moving into a folded section opens it.
        folded = folded.filter((pos) => {
          const heading = headingAt(tr.doc, pos)!
          return !reaches(
            state.selection,
            pos + heading.nodeSize,
            sectionEnd(tr.doc, pos, Number(heading.attrs.level)),
          )
        })
        const same =
          enabled === previous.enabled &&
          !tr.docChanged &&
          folded.length === previous.folded.length &&
          folded.every((pos, index) => pos === previous.folded[index])
        if (same) return previous
        return {
          enabled,
          folded,
          decorations: foldDecorations(tr.doc, folded).add(
            tr.doc,
            controls(tr.doc, labels),
          ),
        }
      },
    },
    props: {
      decorations: (state) => foldKey.getState(state)?.decorations,
      attributes: (state) =>
        foldKey.getState(state)?.enabled
          ? { 'data-inkkit-fold-headings': 'true' }
          : ({} as Record<string, string>),
      handleKeyDown(view, event) {
        const state = foldKey.getState(view.state)
        if (!state?.folded.length) return false
        const { selection, doc } = view.state
        if (
          !selection.empty ||
          (event.key !== 'Backspace' && event.key !== 'Delete') ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false
        // A deletion reaching the hidden text opens its section first, so nothing goes unseen.
        const backward = event.key === 'Backspace'
        const edge = backward ? selection.$from : selection.$to
        if (
          edge.depth !== 1 ||
          (backward
            ? edge.parentOffset !== 0
            : edge.parentOffset !== edge.parent.content.size)
        )
          return false
        const at = backward ? edge.before() : edge.after()
        const hit = state.folded.find((pos) => {
          const heading = headingAt(doc, pos)!
          return backward
            ? at === sectionEnd(doc, pos, Number(heading.attrs.level))
            : at === pos + heading.nodeSize
        })
        if (hit == null) return false
        view.dispatch(
          view.state.tr
            .setMeta(foldKey, { toggle: hit } satisfies FoldMeta)
            .setMeta('addToHistory', false),
        )
        return true
      },
    },
    view(view) {
      const sync = (next: EditorState) => {
        for (const button of view.dom.querySelectorAll<HTMLButtonElement>(
          '[data-inkkit-heading-toggle]',
        ))
          syncControl(next, button, positions.get(button)?.(), labels)
      }
      sync(view.state)
      return {
        update(updated, previous) {
          // Edits change the names, which read the heading text.
          if (
            foldKey.getState(updated.state)?.enabled &&
            (updated.state.doc !== previous.doc ||
              foldKey.getState(updated.state) !== foldKey.getState(previous))
          )
            sync(updated.state)
        },
      }
    },
  })
})
