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
import { commentsVisible, isComment } from './comments'
import { displayCtx } from './display'
import { editorLabels } from './labels'
import type { EditorLabels } from './types'

/**
 * Folds are presentation: plugin state holds the folded top-level headings with the range each one
 * hides, and decorations hide what each one covers, so the document, its attributes and its
 * history never change. The positions follow edits through the transaction mapping.
 *
 * Folded text is never changed unseen. Whenever the selection reaches into a section's hidden
 * range without covering the whole section, heading included, the section opens in the same
 * update, so every input path acts on text the person can see. A selection that covers the whole
 * section, such as select-all, leaves it folded, so deleting everything still works.
 */
interface Section {
  /** The heading's position. */
  pos: number
  /** Where the hidden range starts: the end of the heading. */
  from: number
  /** Where the section ends, which is where the hidden range ends. */
  end: number
}

interface Folds {
  enabled: boolean
  /** Folded sections, in ascending order of heading position. */
  sections: readonly Section[]
  decorations: DecorationSet
}

interface FoldMeta {
  enabled?: boolean
  toggle?: number
  unfold?: readonly number[]
  clear?: boolean
}

const foldKey = new PluginKey<Folds>('inkkitHeadingFold')

/** The end of the section of each top-level heading, in one pass over the document. */
function sectionEnds(doc: ProseNode): Map<number, number> {
  const ends = new Map<number, number>()
  const open: { pos: number; level: number }[] = []
  doc.forEach((child, offset) => {
    if (child.type.name !== 'heading') return
    const level = Number(child.attrs.level)
    while (open.length && open[open.length - 1]!.level >= level)
      ends.set(open.pop()!.pos, offset)
    open.push({ pos: offset, level })
  })
  for (const { pos } of open) ends.set(pos, doc.content.size)
  return ends
}

function headingAt(doc: ProseNode, pos: number): ProseNode | undefined {
  if (pos < 0 || pos > doc.content.size) return undefined
  const $pos = doc.resolve(pos)
  return $pos.depth === 0 && $pos.nodeAfter?.type.name === 'heading'
    ? $pos.nodeAfter
    : undefined
}

function sectionAt(
  doc: ProseNode,
  pos: number,
  ends: Map<number, number>,
): Section | undefined {
  const heading = headingAt(doc, pos)
  return heading
    ? { pos, from: pos + heading.nodeSize, end: ends.get(pos)! }
    : undefined
}

/**
 * Whether the selection must open the section: it is in the hidden range, or reaches into it
 * without covering the whole section. A selection that covers the section, heading included, is
 * the person acting on it on purpose and leaves it folded.
 */
function opens(selection: Selection, { pos, from, end }: Section): boolean {
  if (selection instanceof AllSelection) return false
  if (selection instanceof NodeSelection)
    return selection.from < end && selection.to > from
  if (selection.empty)
    return selection.anchor >= from && selection.anchor <= end
  if (selection.from <= pos && selection.to >= end) return false
  return selection.from <= end && selection.to >= from
}

/** Folded headings follow the document through a transaction, a moved heading by its node. */
function mapFolded(
  sections: readonly Section[],
  tr: Transaction,
  before: ProseNode,
): number[] {
  // A block move, and its undo and redo, put the same node in another place.
  let top: Map<ProseNode, number> | undefined
  const kept = new Set<number>()
  for (const { pos } of sections) {
    const heading = headingAt(before, pos)!
    const result = tr.mapping.mapResult(pos, 1)
    const node = headingAt(tr.doc, result.pos)
    if (node !== heading) {
      if (!top) {
        top = new Map()
        tr.doc.forEach((child, offset) => top!.set(child, offset))
      }
      const moved = top.get(heading)
      if (moved != null) {
        kept.add(moved)
        continue
      }
    }
    if (!node) continue
    // A level change replaces the heading's boundary tokens, which maps as a deletion.
    if (result.deleted && !node.content.eq(heading.content)) continue
    kept.add(result.pos)
  }
  return [...kept].sort((a, b) => a - b)
}

/**
 * Whether every step edits inside one top-level block and leaves that block's type, markup and the
 * number of top-level blocks alone. Then no section changes shape and positions follow by
 * mapping, so an ordinary edit costs no more than the mapping.
 */
function keepsSections(tr: Transaction): boolean {
  for (let index = 0; index < tr.steps.length; index++) {
    const before = tr.docs[index]!
    const after = tr.docs[index + 1] ?? tr.doc
    if (before.childCount !== after.childCount) return false
    let inside = true
    tr.mapping.maps[index]!.forEach((start, end) => {
      if (!inside) return
      const $start = before.resolve(start)
      if ($start.depth === 0) {
        inside = false
        return
      }
      const block = $start.before(1)
      const old = before.nodeAt(block)!
      const now = after.nodeAt(block)
      inside =
        start > block &&
        end < $start.after(1) &&
        now != null &&
        now.type === old.type &&
        now.sameMarkup(old)
    })
    if (!inside) return false
  }
  return true
}

/**
 * The decorations in one pass: each top-level heading carries its fold state, and its arrival,
 * removal or change is what makes ProseMirror ask the heading's view whether it still fits. Each
 * block a fold hides carries a class that hides it in the stylesheet, so no other rule decides
 * its visibility.
 */
function buildDecorations(
  doc: ProseNode,
  sections: readonly Section[],
): DecorationSet {
  const folded = new Set(sections.map((section) => section.pos))
  const hidden: [number, number][] = []
  for (const { from, end } of sections) {
    if (end <= from) continue
    const last = hidden[hidden.length - 1]
    if (last && from <= last[1]) last[1] = Math.max(last[1], end)
    else hidden.push([from, end])
  }
  const found: Decoration[] = []
  let index = 0
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading')
      found.push(
        Decoration.node(offset, offset + node.nodeSize, {
          'data-inkkit-heading-fold': folded.has(offset) ? 'folded' : 'open',
        }),
      )
    while (index < hidden.length && hidden[index]![1] <= offset) index++
    const range = hidden[index]
    if (range && offset >= range[0])
      found.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: 'inkkit-folded-content',
        }),
      )
  })
  return DecorationSet.create(doc, found)
}

function isFolded(state: EditorState, pos: number): boolean {
  const sections = foldKey.getState(state)?.sections ?? []
  let low = 0
  let high = sections.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const at = sections[middle]!.pos
    if (at === pos) return true
    if (at < pos) low = middle + 1
    else high = middle - 1
  }
  return false
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
    const folded = at != null && isFolded(this.view.state, at)
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
  if (!isFolded(view.state, pos)) {
    const section = sectionAt(view.state.doc, pos, sectionEnds(view.state.doc))!
    if (opens(view.state.selection, section))
      tr.setSelection(TextSelection.create(tr.doc, section.from - 1))
  }
  view.dispatch(tr)
}

/** Turns folding on or off in the transaction. Turning it off unfolds everything. */
export function setHeadingFolding(tr: Transaction, enabled: boolean): void {
  tr.setMeta(foldKey, { enabled } satisfies FoldMeta)
}

/** Unfolds every section. A switch of editing mode clears the folds this way. */
export function clearHeadingFolds(view: EditorView): void {
  if (!foldKey.getState(view.state)?.sections.length) return
  view.dispatch(
    view.state.tr
      .setMeta(foldKey, { clear: true } satisfies FoldMeta)
      .setMeta('addToHistory', false),
  )
}

/**
 * Whether an edit would change text that a fold hides from a collapsed caret, such as a deletion
 * across the section's boundary, and what then happens: the edit is refused and the transaction
 * returned unfolds the sections it reached, so what changes is seen. A selection that reaches
 * hidden text has already opened the section (see `Section`), so this is the check that remains
 * for the caret. It reads the transaction, so it holds for every input path, such as a key the
 * browser acts on itself, a cut, a paste or a drop. An edit whose own steps cover a whole folded
 * section, heading included, deletes or replaces that section on purpose, and goes through, as
 * the range the edit names decides, not the selection at the time it applies. Undefined when the
 * edit may be applied.
 */
export function refuseFoldedEdit(
  state: EditorState,
  tr: Transaction,
): Transaction | undefined {
  const sections = foldKey.getState(state)?.sections
  if (!sections?.length || !tr.docChanged) return undefined
  const reached: number[] = []
  for (const section of sections) {
    if (section.end <= section.from) continue
    let { pos: head, from, end: to } = section
    // The hidden range is followed through the steps, so a later step is read against the
    // document the earlier ones made.
    for (let index = 0; index < tr.steps.length; index++) {
      const map = tr.mapping.maps[index]!
      let touches = false
      let covers = false
      map.forEach((start, end) => {
        if (start >= to || end <= from) return
        if (start <= head && end >= to) covers = true
        else touches = true
      })
      if (touches) {
        reached.push(section.pos)
        break
      }
      if (covers) break
      head = map.map(head, 1)
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
  return (foldKey.getState(state)?.sections ?? []).map(({ pos }) => pos)
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
          sections: [],
          decorations: enabled
            ? buildDecorations(state.doc, [])
            : DecorationSet.empty,
        }
      },
      apply(tr, previous, oldState, state) {
        const meta = tr.getMeta(foldKey) as FoldMeta | undefined
        const enabled = meta?.enabled ?? previous.enabled
        if (!enabled)
          return enabled === previous.enabled && !previous.sections.length
            ? previous
            : { enabled, sections: [], decorations: DecorationSet.empty }
        let sections = previous.sections
        let rebuild = enabled !== previous.enabled
        if (meta?.clear && sections.length) {
          sections = []
          rebuild = true
        }
        // An ordinary edit inside one block moves positions and nothing else. Any other change
        // reads the document once for every section.
        const mapped = tr.docChanged && keepsSections(tr)
        let ends: Map<number, number> | undefined
        if (tr.docChanged && sections.length) {
          if (mapped)
            sections = sections.map((section) => ({
              pos: tr.mapping.map(section.pos, 1),
              from: tr.mapping.map(section.from, 1),
              end: tr.mapping.map(section.end, -1),
            }))
          else {
            ends = sectionEnds(tr.doc)
            sections = mapFolded(sections, tr, oldState.doc).map((pos) =>
              sectionAt(tr.doc, pos, ends!)!,
            )
          }
        }
        if (tr.docChanged && !mapped) rebuild = true
        if (meta?.unfold) {
          const kept = sections.filter(
            (section) => !meta.unfold!.includes(section.pos),
          )
          if (kept.length !== sections.length) rebuild = true
          sections = kept
        }
        if (meta?.toggle != null && headingAt(tr.doc, meta.toggle)) {
          rebuild = true
          if (sections.some((section) => section.pos === meta.toggle))
            sections = sections.filter((section) => section.pos !== meta.toggle)
          else
            sections = [
              ...sections,
              sectionAt(tr.doc, meta.toggle, (ends ??= sectionEnds(tr.doc)))!,
            ].sort((a, b) => a.pos - b.pos)
        }
        // The selection reaching into a folded section opens it, so every input acts on text
        // the person can see.
        if (sections.length) {
          const kept = sections.filter(
            (section) => !opens(state.selection, section),
          )
          if (kept.length !== sections.length) {
            rebuild = true
            sections = kept
          }
        }
        if (!rebuild && !tr.docChanged) return previous
        return {
          enabled,
          sections,
          decorations: rebuild
            ? buildDecorations(tr.doc, sections)
            : previous.decorations.map(tr.mapping, tr.doc),
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
        if (!state?.sections.length) return false
        const { selection } = view.state
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
        const hit = state.sections.find((section) =>
          backward ? at === section.end : at === section.from,
        )
        if (!hit) return false
        view.dispatch(
          view.state.tr
            .setMeta(foldKey, { unfold: [hit.pos] } satisfies FoldMeta)
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
