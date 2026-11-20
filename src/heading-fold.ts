import {
  DOMSerializer,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
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
  type NodeView,
  type ViewMutationRecord,
} from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { carriedBlocks } from './block-move'
import { commentsVisible, isComment } from './comments'
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
  unfold?: readonly number[]
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

function topLevelPosition(doc: ProseNode, node: ProseNode): number | undefined {
  let found: number | undefined
  doc.forEach((child, offset) => {
    if (found == null && child === node) found = offset
  })
  return found
}

function mapFolds(
  folded: readonly number[],
  tr: Transaction,
  before: ProseNode,
): number[] {
  // A block move carries the nodes themselves, so a heading it moves keeps its fold wherever it
  // lands.
  const carried = tr.getMeta(carriedBlocks) as readonly ProseNode[] | undefined
  const kept: number[] = []
  for (const pos of folded) {
    const heading = headingAt(before, pos)!
    const moved = carried?.includes(heading)
      ? topLevelPosition(tr.doc, heading)
      : undefined
    if (moved != null) {
      if (!kept.includes(moved)) kept.push(moved)
      continue
    }
    const result = tr.mapping.mapResult(pos, 1)
    const node = headingAt(tr.doc, result.pos)
    if (!node) continue
    // A level change replaces the heading's boundary tokens, which maps as a deletion.
    if (result.deleted && !node.content.eq(heading.content)) continue
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
        // The class hides the block in the stylesheet, so no other rule decides its visibility.
        found.push(
          Decoration.node(at, at + block.nodeSize, {
            class: 'inkkit-folded-content',
          }),
        )
      }
      at += block.nodeSize
    }
  }
  return DecorationSet.create(doc, found)
}

/**
 * A decoration on each top-level heading. It carries the heading's fold state, and its arrival,
 * removal or change is what makes ProseMirror ask the heading's view whether it still fits.
 */
function headingDecorations(
  doc: ProseNode,
  folded: readonly number[],
): Decoration[] {
  const found: Decoration[] = []
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return
    found.push(
      Decoration.node(offset, offset + node.nodeSize, {
        'data-inkkit-heading-fold': folded.includes(offset) ? 'folded' : 'open',
      }),
    )
  })
  return found
}

type Labels = () => Readonly<EditorLabels>

/**
 * The words a reader sees in the heading. A comment is left out while it is hidden, as the
 * heading's own name leaves it out.
 */
function visibleText(node: ProseNode, comments: boolean): string {
  let text = ''
  node.descendants((child) => {
    if (isComment(child)) {
      if (comments) text += child.textContent
      return false
    }
    if (child.isText) text += child.text
    else if (child.isLeaf) text += ' '
    return true
  })
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A top-level heading in a wrapper beside its fold control. The heading is the content, so its
 * accessible name is its own text; the control is an uneditable sibling, named from the heading's
 * visible text. Another heading, and every heading while the option is off, is the plain element
 * the schema describes.
 */
class HeadingView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  private readonly wrapped: boolean
  private readonly button?: HTMLButtonElement
  private readonly control?: HTMLElement

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly labels: Labels,
    private readonly live: Set<HeadingView>,
  ) {
    const rendered = DOMSerializer.renderSpec(
      document,
      node.type.spec.toDOM!(node),
    )
    this.contentDOM = rendered.contentDOM as HTMLElement
    this.wrapped = this.fits()
    if (!this.wrapped) {
      this.dom = rendered.dom as HTMLElement
      return
    }
    this.dom = document.createElement('div')
    this.dom.className = 'inkkit-heading-block'
    this.dom.setAttribute('data-inkkit-heading-level', String(node.attrs.level))
    this.control = document.createElement('span')
    this.control.className = 'inkkit-heading-fold'
    this.control.setAttribute('contenteditable', 'false')
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.tabIndex = 0
    this.button.setAttribute('data-inkkit-heading-toggle', '')
    // The pointer must not move the caret out of the text it is in.
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => {
      const at = this.getPos()
      if (at != null) toggleHeadingFold(this.view, at)
    })
    this.control.append(this.button)
    this.dom.append(this.control, rendered.dom)
    this.live.add(this)
    this.sync()
  }

  /** Whether the heading is the kind the preference calls for: wrapped when it folds. */
  private fits(): boolean {
    const at = this.getPos()
    return (
      (foldKey.getState(this.view.state)?.enabled ?? false) &&
      at != null &&
      headingAt(this.view.state.doc, at) != null
    )
  }

  update(node: ProseNode): boolean {
    if (
      node.type !== this.node.type ||
      !node.sameMarkup(this.node) ||
      this.fits() !== this.wrapped
    )
      return false
    this.node = node
    this.sync()
    return true
  }

  /** The control's name and state, which follow the heading's text and its fold. */
  sync(): void {
    const { button } = this
    if (!button) return
    const at = this.getPos()
    const folded =
      at != null &&
      (foldKey.getState(this.view.state)?.folded.includes(at) ?? false)
    const text = visibleText(this.node, commentsVisible(this.view.state))
    const name = folded
      ? this.labels().unfoldHeading
      : this.labels().foldHeading
    const label = `${name} ${text}`.trim()
    if (button.getAttribute('aria-label') !== label)
      button.setAttribute('aria-label', label)
    const expanded = String(!folded)
    if (button.getAttribute('aria-expanded') !== expanded)
      button.setAttribute('aria-expanded', expanded)
  }

  /** The browser edits the heading's text, never the control beside it. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return (
      this.wrapped &&
      mutation.type !== 'selection' &&
      !this.contentDOM.contains(mutation.target)
    )
  }

  stopEvent(event: Event): boolean {
    return this.control?.contains(event.target as Node | null) ?? false
  }

  destroy(): void {
    this.live.delete(this)
  }
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

/**
 * Whether a person's edit would change text that a fold hides, and what then happens: the edit
 * is refused and the transaction returned unfolds the sections it reached, so what changes is
 * seen. It is a check on the transaction, so it holds for every input path, such as a key the
 * browser acts on itself, a cut, a paste or a drop. An edit whose selection covers a whole
 * folded section, heading included, is the person deleting or replacing that section on
 * purpose, and goes through. Undefined when the edit may be applied.
 */
export function refuseFoldedEdit(
  state: EditorState,
  tr: Transaction,
): Transaction | undefined {
  const folded = foldKey.getState(state)?.folded
  if (!folded?.length || !tr.docChanged) return undefined
  const { selection } = state
  const reached: number[] = []
  for (const pos of folded) {
    const heading = headingAt(state.doc, pos)
    if (!heading) continue
    let from = pos + heading.nodeSize
    let to = sectionEnd(state.doc, pos, Number(heading.attrs.level))
    if (to <= from) continue
    if (selection.from <= pos && selection.to >= to) continue
    // The hidden range is followed through the steps, so a later step is read against the
    // document the earlier ones made.
    for (let index = 0; index < tr.steps.length; index++) {
      const map = tr.mapping.maps[index]!
      let touches = false
      map.forEach((start, end) => {
        if (start < to && end > from) touches = true
      })
      if (touches) {
        reached.push(pos)
        break
      }
      from = map.map(from, 1)
      to = map.map(to, -1)
      if (to <= from) break
    }
  }
  if (!reached.length) return undefined
  return state.tr
    .setMeta(foldKey, { unfold: reached } satisfies FoldMeta)
    .setMeta('addToHistory', false)
}

/** The folded headings' positions, for tests. */
export function foldedHeadings(state: EditorState): readonly number[] {
  return foldKey.getState(state)?.folded ?? []
}

export const headingFold = $prose((ctx) => {
  const labels: Labels = () => editorLabels(ctx)
  const live = new Set<HeadingView>()
  return new Plugin<Folds>({
    key: foldKey,
    state: {
      init: (_, state) => {
        const enabled = ctx.get(displayCtx.key)().foldHeadings
        return {
          enabled,
          folded: [],
          decorations: enabled
            ? DecorationSet.create(state.doc, headingDecorations(state.doc, []))
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
        if (meta?.unfold)
          folded = folded.filter((pos) => !meta.unfold!.includes(pos))
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
            headingDecorations(tr.doc, folded),
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
        // A plain deletion beside a section opens it first. A key that edits the text across the
        // boundary is caught by `refuseFoldedEdit`; this one also covers the block that ends the
        // section, which Backspace turns into a paragraph that the section would then hide.
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
            .setMeta(foldKey, { unfold: [hit] } satisfies FoldMeta)
            .setMeta('addToHistory', false),
        )
        return true
      },
      nodeViews: {
        heading: (node: ProseNode, view: EditorView, getPos) =>
          new HeadingView(node, view, getPos, labels, live),
      },
    },
    view() {
      return {
        update(updated, previous) {
          // A comment that shows is part of the heading's text, and a hidden one is not.
          if (commentsVisible(updated.state) !== commentsVisible(previous))
            for (const heading of live) heading.sync()
        },
      }
    },
  })
})
