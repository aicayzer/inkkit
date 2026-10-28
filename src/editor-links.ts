import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  NodeSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Mark as ProseMark } from '@milkdown/kit/prose/model'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { serialize } from './dialect'
import { isSafeLinkTarget } from './link-safety'
import { normaliseLabel, referenceDefinitions, singleLine } from './references'
import { markRun } from './editor-selection'
import { coded, invalidArgument } from './errors'
import { wikiReference } from './linked-syntax'
import type { DocumentContext, WikiLinkAdapter } from './types'

export function checkDestination(
  ctx: Ctx,
  destination: string,
  name: string,
  linkSchemes: ReadonlySet<string>,
): void {
  if (destination.trim() === '')
    throw invalidArgument(`${name} must not be empty`)
  if (!isSafeLinkTarget(destination, linkSchemes))
    throw invalidArgument(
      `${name} must be relative, or an address with an allowed scheme (http, https, mailto, tel or one of linkSchemes), with no control characters`,
    )
  const { schema } = ctx.get(editorViewCtx).state
  const written = serialize(
    ctx,
    schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('x', [schema.marks.link!.create({ href: destination })]),
      ]),
    ]),
  )
  let read: unknown
  ctx
    .get(parserCtx)(written)
    .descendants((node) => {
      read ??= node.marks.find((mark) => mark.type.name === 'link')?.attrs.href
    })
  if (read !== destination)
    throw invalidArgument(`${name} cannot be written in Markdown as given`)
}

export function setLink(
  ctx: Ctx,
  destination: string | undefined,
  editReference: (label: string, destination: string) => boolean,
): void {
  const view = ctx.get(editorViewCtx)
  const { state } = view
  const type = linkSchema.type(ctx)
  const { selection, storedMarks } = state
  const { from, to, empty } = selection
  const stored = empty ? type.isInSet(storedMarks ?? []) : undefined
  // Links end at their edges, so a caret at a link's end, where typing
  // continues or leaves it, is still at that link.
  const beside = empty ? (selection.$from.nodeBefore?.marks ?? []) : []
  // A stored link that the caret already sits in is that link, kept when another mark was toggled.
  if (
    stored &&
    !stored.isInSet(selection.$from.marks()) &&
    !stored.isInSet(beside)
  ) {
    const tr = state.tr.removeStoredMark(type)
    if (destination !== undefined)
      tr.addStoredMark(type.create({ href: destination }))
    view.dispatch(tr)
    return
  }
  const mark = type.isInSet(
    empty
      ? [
          ...selection.$from.marks(),
          ...beside,
          ...(state.doc.nodeAt(from)?.marks ?? []),
        ]
      : (state.doc.nodeAt(from)?.marks ?? []),
  )
  const extent = mark && markRun(state.doc, mark, from, to)
  // Steps clear the stored marks; the ones other than the old link are put back.
  const keepStored = (tr: Transaction, link?: ProseMark) => {
    if (!storedMarks) return tr
    const kept = type.removeFromSet(storedMarks)
    return tr.setStoredMarks(
      link && type.isInSet(storedMarks) ? link.addToSet(kept) : kept,
    )
  }
  if (destination === undefined) {
    if (extent)
      view.dispatch(
        keepStored(state.tr.removeMark(extent.from, extent.to, type)),
      )
    else if (!empty && state.doc.rangeHasMark(from, to, type))
      view.dispatch(state.tr.removeMark(from, to, type))
    return
  }
  if (extent && mark!.attrs.identifier != null) {
    const identifier = String(mark!.attrs.identifier)
    const definition = referenceDefinitions(state.doc).get(
      normaliseLabel(identifier),
    )
    if (definition?.node.attrs.url === destination) return
    editReference(identifier, destination)
    if (storedMarks) view.dispatch(view.state.tr.setStoredMarks(storedMarks))
    return
  }
  if (extent) {
    // An autolink rewritten with its own address would lose its form for nothing.
    if (mark!.attrs.href === destination) return
    const link = type.create({ href: destination, title: mark!.attrs.title })
    view.dispatch(
      keepStored(
        state.tr
          .removeMark(extent.from, extent.to, type)
          .addMark(extent.from, extent.to, link),
        link,
      ),
    )
    return
  }
  const link = type.create({ href: destination })
  view.dispatch(
    empty
      ? state.tr.addStoredMark(link)
      : state.tr.removeMark(from, to, type).addMark(from, to, link),
  )
}

export function editReferenceDefinition(
  view: EditorView,
  label: string,
  destination: string,
  title: string | undefined,
): boolean {
  const definitions = referenceDefinitions(view.state.doc)
  const definition =
    definitions.get(normaliseLabel(label)) ??
    [...definitions.values()].find(
      ({ node }) =>
        normaliseLabel(String(node.attrs.label)) === normaliseLabel(label),
    )
  if (!definition) return false
  const transaction = view.state.tr.setNodeMarkup(definition.pos, undefined, {
    ...definition.node.attrs,
    url: destination,
    title: title == null ? definition.node.attrs.title : singleLine(title),
  })
  // A refused edit makes the call throw `preservation` and change nothing.
  view.dispatch(transaction)
  return true
}

interface LinkActivation {
  wikiLinks: WikiLinkAdapter | undefined
  capture(): { context: DocumentContext; isCurrent(): boolean }
  linkSchemes: ReadonlySet<string>
  openLink(href: string): void
  report(error: unknown): void
}

export function openSelectedLink(
  state: EditorState,
  runtime: LinkActivation,
): boolean {
  const { selection } = state
  const node =
    selection instanceof NodeSelection
      ? selection.node
      : selection.$from.nodeAfter
  if (node?.type.name === 'inkkit_wiki_link' && runtime.wikiLinks) {
    const captured = runtime.capture()
    try {
      if (captured.isCurrent())
        runtime.wikiLinks.open(wikiReference(node), captured.context)
    } catch (error) {
      runtime.report(coded(error, 'file-unavailable'))
    }
  } else {
    // Prefer the character after a boundary, then the one before it, just
    // as a caret at either end of a rendered link belongs to that link.
    const mark = [selection.$from.nodeAfter, selection.$from.nodeBefore]
      .flatMap((node) => node?.marks ?? [])
      .find((mark) => mark.type.name === 'link')
    const href = mark?.attrs.href as string | undefined
    if (href && isSafeLinkTarget(href, runtime.linkSchemes))
      runtime.openLink(href)
  }
  return true
}
