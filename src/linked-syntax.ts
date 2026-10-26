import { $inputRule, $node, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import {
  Mark,
  type Node as ProseNode,
  type Schema,
} from '@milkdown/kit/prose/model'
import type { Literal, Nodes, Root } from 'mdast'
import type { Extension as FromExtension } from 'mdast-util-from-markdown'
import { defaultHandlers, type Handle } from 'mdast-util-to-markdown'
import type { Code, Extension, Tokenizer, State } from 'micromark-util-types'
import type { Processor } from 'unified'
import {
  InkKitError,
  type FileReference,
  type WikiLinkReference,
} from './types'
import { showsText } from './references'
import { insertedAt } from './smart-punctuation'

interface WikiLink extends Literal {
  type: 'inkkitWikiLink'
  raw: string
  target: string
  fragment: string | null
  label: string
  inTable: boolean
}
declare module 'mdast' {
  interface PhrasingContentMap {
    inkkitWikiLink: WikiLink
  }
  interface RootContentMap {
    inkkitWikiLink: WikiLink
  }
  interface Image {
    inkkitFileRaw?: string
    inkkitFileSource?: string
    inkkitFileTarget?: string
    inkkitFileFragment?: string | null
    inkkitFileWidth?: number | null
    inkkitFileInTable?: boolean
  }
}
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    inkkitLinkedSyntax: 'inkkitLinkedSyntax'
  }
}

export interface LinkedSyntax {
  raw: string
  target: string
  fragment: string | null
  label: string
  width: number | null
  embed: boolean
  inTable: boolean
}

const fromTable = (raw: string): string =>
  raw.replace(
    /(\\*)\|/g,
    (_match, escapes: string) =>
      `${'\\'.repeat(Math.floor(escapes.length / 2))}|`,
  )
const toTable = (raw: string): string =>
  raw.replace(
    /(\\*)\|/g,
    (_match, escapes: string) => `${'\\'.repeat(escapes.length * 2 + 1)}|`,
  )

// GFM removes the table escape before CommonMark reads the image. Unlike
// named syntax, an existing CommonMark pipe escape already works in both contexts.
function pathTableForm(raw: string, inTable: boolean): string {
  if (!inTable) return raw
  return raw.replace(/(\\*)\|/g, (_match, escapes: string) =>
    escapes.length % 2 ? escapes + '|' : escapes + '\\|',
  )
}

export function parseLinkedSyntax(
  raw: string,
  inTable = false,
): LinkedSyntax | undefined {
  const source = inTable ? fromTable(raw) : raw
  const embed = source.startsWith('!')
  const prefix = embed ? '![[' : '[['
  if (!source.startsWith(prefix) || !source.endsWith(']]')) return undefined
  const content = source.slice(prefix.length, -2)
  const parts = { target: '', fragment: '', alias: '' }
  let section: keyof typeof parts = 'target',
    hasFragment = false,
    hasAlias = false
  for (let index = 0; index < content.length; index++) {
    const character = content[index]!
    if (character === '\\') {
      const escaped = content[++index]
      if (!escaped || !'[]|#\\'.includes(escaped)) return undefined
      parts[section] += escaped
    } else if (character === '|') {
      if (hasAlias) return undefined
      hasAlias = true
      section = 'alias'
    } else if (character === '#' && section !== 'alias') {
      if (hasFragment) return undefined
      hasFragment = true
      section = 'fragment'
    } else {
      if (
        '[]'.includes(character) ||
        (character.charCodeAt(0) < 32 && character !== '\t') ||
        character === '\u007f'
      )
        return undefined
      parts[section] += character
    }
  }
  if (
    (!parts.target.trim() && !(hasFragment && parts.fragment.trim())) ||
    (hasFragment && !parts.fragment.trim()) ||
    (hasAlias && !parts.alias.trim()) ||
    parts.target.trimStart().startsWith('^') ||
    parts.fragment.trimStart().startsWith('^')
  )
    return undefined
  const size = /^[ \t]*(\d{1,5})(?:x(\d{1,5}))?[ \t]*$/.exec(parts.alias)
  if (
    embed &&
    (!parts.target.trim() ||
      (hasAlias &&
        (!size ||
          Number(size[1]) < 1 ||
          (size[2] != null && Number(size[2]) < 1))))
  )
    return undefined
  const target = embed ? parts.target.trim() : parts.target
  const fragment = hasFragment
    ? embed
      ? parts.fragment.trim()
      : parts.fragment
    : null
  return {
    raw,
    target,
    fragment,
    label:
      !embed && hasAlias
        ? parts.alias
        : target + (fragment != null ? `#${fragment}` : ''),
    width: embed && hasAlias ? Number(size![1]) : null,
    embed,
    inTable,
  }
}

function linkedTokenizer(embed: boolean): Tokenizer {
  return function (effects, ok, nok) {
    const prefix = embed ? '![[' : '[['
    let index = 0,
      raw = ''
    return opening
    function consume(code: Exclude<Code, null>) {
      raw += code === -2 ? '\t' : code === -1 ? ' ' : String.fromCodePoint(code)
      effects.consume(code)
    }
    function opening(code: Code): State | undefined {
      if (code !== prefix.charCodeAt(index)) return nok(code)
      if (!index) effects.enter('inkkitLinkedSyntax')
      consume(code)
      index++
      return index === prefix.length ? body : opening
    }
    function body(code: Code): State | undefined {
      if (
        code === null ||
        (code < 32 && code !== -2 && code !== -1 && code !== 9) ||
        code === 91
      )
        return nok(code)
      consume(code)
      if (code === 92) return escaped
      return code === 93 ? closing : body
    }
    function escaped(code: Code): State | undefined {
      if (code === null || code < 32) return nok(code)
      consume(code)
      return body
    }
    function closing(code: Code): State | undefined {
      if (code !== 93) return nok(code)
      consume(code)
      if (!parseLinkedSyntax(raw) && !parseLinkedSyntax(raw, true))
        return nok(code)
      effects.exit('inkkitLinkedSyntax')
      return ok
    }
  }
}

function tableForm(
  raw: string,
  authoredInTable: boolean,
  outputInTable: boolean,
): string {
  if (authoredInTable === outputInTable) return raw
  return outputInTable ? toTable(raw) : fromTable(raw)
}

export function wikiMarkdown(node: ProseNode, inTable = false): string {
  return tableForm(String(node.attrs.raw), Boolean(node.attrs.inTable), inTable)
}

export function wikiReference(node: ProseNode): WikiLinkReference {
  return {
    raw: wikiMarkdown(node, Boolean(node.attrs.inTable)),
    target: String(node.attrs.target),
    ...(node.attrs.fragment != null
      ? { fragment: String(node.attrs.fragment) }
      : {}),
    label: String(node.attrs.label),
  }
}

export function fileReference(node: ProseNode): FileReference {
  return { ...fileFields(node), raw: fileSource(node) }
}

/** `fileReference` without the embed's text, which takes writing it. */
export function fileFields(node: ProseNode): Omit<FileReference, 'raw'> {
  const reference = String(node.attrs.src ?? '')
  const named = node.attrs.inkkitFileRaw != null
  const alt = String(node.attrs.alt ?? '')
  const match = /\|(\d{1,5})$/.exec(alt)
  // A path's fragment starts at its first `#`; a `#` in a file name is written
  // `%23`. A named file's `#` can be escaped, so its parsed target is kept.
  const hash = reference.indexOf('#')
  const target = named
    ? String(node.attrs.inkkitFileTarget ?? '')
    : hash < 0
      ? reference
      : reference.slice(0, hash)
  const fragment = named
    ? node.attrs.inkkitFileFragment
    : hash < 0
      ? null
      : reference.slice(hash + 1)
  const label = named
    ? target + (fragment != null ? `#${fragment}` : '')
    : match
      ? alt.slice(0, match.index)
      : alt
  const width =
    named && alt === label && node.attrs.inkkitFileWidth == null
      ? null
      : match
        ? Number(match[1])
        : null
  return {
    reference,
    kind: named ? 'wiki' : 'path',
    target,
    ...(fragment != null ? { fragment: String(fragment) } : {}),
    ...(label ? { label } : {}),
    ...(width != null ? { width } : {}),
  }
}

/** A path image's Markdown as it was read, with the attributes it was read as. */
export interface AuthoredImage {
  text: string
  src: string
  alt: string
  title: string
}

const writers = new WeakMap<Schema, (node: ProseNode) => string>()

/** Sets how an image of `schema` is written when it has no authored text. */
export function setImageWriter(
  schema: Schema,
  write: (node: ProseNode) => string,
): void {
  writers.set(schema, write)
}

/**
 * A file embed's Markdown as the document holds it: its authored text while
 * the embed is unchanged, otherwise the text InkKit writes for it.
 */
function fileSource(node: ProseNode): string {
  if (node.attrs.inkkitFileRaw != null)
    return namedFileMarkdown(node, Boolean(node.attrs.inkkitFileInTable)) ?? ''
  const authored = authoredFileSource(node)
  if (authored != null) return authored
  const write = writers.get(node.type.schema)
  if (!write) throw new InkKitError('internal', 'The image writer is not set')
  return pathTableForm(write(node), Boolean(node.attrs.inkkitFileInTable))
}

/** Only reuse authored spelling while it still describes the image. */
export function authoredFileSource(node: ProseNode): string | null {
  const authored = node.attrs.inkkitFileSource as AuthoredImage | null
  return authored &&
    authored.src === node.attrs.src &&
    authored.alt === node.attrs.alt &&
    authored.title === node.attrs.title
    ? authored.text
    : null
}

/** Records each path image's Markdown as written, for `FileReference.raw`. */
export function remarkFileSources() {
  return (tree: Root, file: { value?: unknown }) => {
    // Positions count from after a byte order mark.
    const source = String(file.value ?? '').replace(/^\uFEFF/, '')
    const visit = (node: Nodes, inTable = false) => {
      if (node.type === 'image' && node.inkkitFileRaw == null) {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start != null && end != null)
          node.inkkitFileSource = source.slice(start, end)
        node.inkkitFileInTable = inTable
      }
      if ('children' in node)
        node.children.forEach((child) =>
          visit(child, inTable || node.type === 'tableCell'),
        )
    }
    visit(tree)
  }
}

export function namedFileMarkdown(
  node: ProseNode,
  inTable = false,
): string | undefined {
  if (node.attrs.inkkitFileRaw == null) return undefined
  let raw = String(node.attrs.inkkitFileRaw)
  const authoredInTable = Boolean(node.attrs.inkkitFileInTable)
  const width = fileFields(node).width ?? null
  const original = node.attrs.inkkitFileWidth ?? null
  if (width !== original) {
    if (authoredInTable) raw = fromTable(raw)
    if (original != null)
      raw = raw.replace(/\|[ \t]*\d{1,5}(?:x\d{1,5})?[ \t]*\]\]$/, ']]')
    if (width != null) raw = `${raw.slice(0, -2)}|${width}]]`
    return inTable ? toTable(raw) : raw
  }
  return tableForm(raw, authoredInTable, inTable)
}

/**
 * Whether a wiki link shows its own target, as it does unless it is written
 * with other text, so a reader sees where it leads.
 */
export function showsWikiTarget(link: {
  target?: unknown
  fragment?: unknown
  label?: unknown
}): boolean {
  return (
    link.label ===
    `${String(link.target ?? '')}${link.fragment != null ? `#${String(link.fragment)}` : ''}`
  )
}

export const wikiLinkSchema = $node('inkkit_wiki_link', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  marks: '',
  attrs: {
    raw: { default: '' },
    target: { default: '' },
    fragment: { default: null },
    label: { default: '' },
    inTable: { default: false },
  },
  parseDOM: [
    {
      tag: 'span[data-inkkit-wiki]',
      getAttrs(dom) {
        const parsed = parseLinkedSyntax(
          dom.getAttribute('data-inkkit-wiki-raw') ?? '',
          dom.getAttribute('data-inkkit-wiki-table') === 'true',
        )
        // Otherwise the element imports as the text it shows.
        return parsed &&
          !parsed.embed &&
          showsWikiTarget(parsed) &&
          showsText(dom, parsed.label)
          ? {
              raw: parsed.raw,
              target: parsed.target,
              fragment: parsed.fragment,
              label: parsed.label,
              inTable: parsed.inTable,
            }
          : false
      },
    },
  ],
  toDOM: (node) => [
    'span',
    {
      'data-inkkit-wiki': node.attrs.target,
      'data-inkkit-fragment': node.attrs.fragment ?? '',
      'data-inkkit-wiki-raw': node.attrs.raw,
      'data-inkkit-wiki-table': String(node.attrs.inTable),
      role: 'link',
      tabindex: '0',
    },
    node.attrs.label,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'inkkitWikiLink',
    runner(state, node, type) {
      state.addNode(type, {
        raw: node.raw,
        target: node.target,
        fragment: node.fragment,
        label: node.label,
        inTable: node.inTable,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'inkkit_wiki_link',
    runner(state, node) {
      state.addNode('inkkitWikiLink', undefined, node.attrs.label, {
        raw: node.attrs.raw,
        target: node.attrs.target,
        fragment: node.attrs.fragment,
        label: node.attrs.label,
        inTable: node.attrs.inTable,
      })
    },
  },
}))

/** The position after a `]` that a composition has just committed. */
interface Composed {
  composition: { pos: number; size: number } | null
  closing: number | null
}
const composed = new PluginKey<Composed>('inkkitWikiLinkComposition')

/**
 * Lets the rule below tell a `]` that a composition committed from text that was already in the
 * note: ProseMirror runs every input rule when a composition ends, with nothing typed.
 */
export const wikiLinkComposition = $prose(
  () =>
    new Plugin<Composed>({
      key: composed,
      state: {
        init: () => ({ composition: null, closing: null }),
        apply(tr, value) {
          const { composition } = value
          value.closing = null
          if (!tr.docChanged || !composition) return value
          // An input method can replace its candidate before committing it.
          if (tr.getMeta('composition') === undefined) value.composition = null
          else if (
            insertedAt(tr, composition.pos) === ']' &&
            tr.doc.content.size === composition.size + 1
          )
            value.closing = composition.pos + 1
          return value
        },
      },
      props: {
        handleDOMEvents: {
          compositionstart(view) {
            const { from, empty } = view.state.selection
            const tracked = composed.getState(view.state)!
            tracked.closing = null
            tracked.composition = empty
              ? { pos: from, size: view.state.doc.content.size }
              : null
            return false
          },
        },
      },
    }),
)

/**
 * A pasted or moved atom retains its original attributes. Stores the spelling
 * its new context saves before preservation and node views observe it, so
 * adapter references and clipboard metadata agree.
 */
export const referenceTableContext = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitReferenceTableContext'),
      appendTransaction(transactions, _before, state) {
        if (!transactions.some((tr) => tr.docChanged)) return null
        let ranges: Array<[number, number]> = []
        for (const transaction of transactions)
          for (const map of transaction.mapping.maps) {
            ranges = ranges.map(([from, to]) => [
              map.map(from, -1),
              map.map(to),
            ])
            map.forEach((_from, _to, from, to) => ranges.push([from, to]))
          }
        const tr = state.tr
        const seen = new Set<number>()
        for (const [from, to] of ranges)
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (
              !['inkkit_wiki_link', 'image', 'image_block'].includes(
                node.type.name,
              ) ||
              seen.has(pos)
            )
              return
            seen.add(pos)
            const $pos = state.doc.resolve(pos)
            let inTable = false
            for (let depth = $pos.depth; depth > 0; depth--)
              if (
                ['table_cell', 'table_header'].includes(
                  $pos.node(depth).type.name,
                )
              )
                inTable = true
            if (node.type.name === 'inkkit_wiki_link') {
              if (inTable !== Boolean(node.attrs.inTable))
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  raw: wikiMarkdown(node, inTable),
                  inTable,
                })
            } else if (inTable !== Boolean(node.attrs.inkkitFileInTable)) {
              const authored = node.attrs
                .inkkitFileSource as AuthoredImage | null
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                inkkitFileRaw: namedFileMarkdown(node, inTable) ?? null,
                inkkitFileSource: authored
                  ? {
                      ...authored,
                      text: pathTableForm(authored.text, inTable),
                    }
                  : null,
                inkkitFileInTable: inTable,
              })
            }
          })
        return tr.steps.length ? tr : null
      },
    }),
)

/**
 * Turns `[[target]]`, as the person types its last bracket, into the wiki link
 * it reads as when the note is opened, so the note keeps the characters that
 * were typed. Left as text, the brackets save as `\[\[target]]`, which no
 * other tool reads as a link. The last bracket has to be the one just typed,
 * or committed by a composition: text already in the note, such as escaped
 * brackets, is never changed, and that includes the run of every rule when a
 * composition ends.
 */
export const wikiLinkInputRule = $inputRule(
  () =>
    new InputRule(
      /\[\[(?:\\.|[^[\]\\\ufffc])*\]\]$/,
      (state, match, start, end) => {
        const { schema, doc } = state
        const type = schema.nodes.inkkit_wiki_link
        // The typed bracket is not in the document yet; a composition's is.
        const caret = state.selection.from
        if (
          start + match[0].length - 1 !== caret &&
          !(
            start + match[0].length === caret &&
            composed.getState(state)?.closing === caret
          )
        )
          return null
        const $start = doc.resolve(start)
        const parent = $start.parent
        if (
          !type ||
          !parent.inlineContent ||
          !parent.canReplaceWith($start.index(), $start.index(), type) ||
          // Escaped, embedded or nested brackets are not the start of a link.
          /[!\\[]/.test(
            doc.textBetween(Math.max($start.start(), start - 1), start),
          )
        )
          return null
        // Only text that was typed as one run, so that the link replaces the
        // characters the person sees and nothing else.
        let marks: readonly Mark[] | undefined
        let plain = true
        doc.nodesBetween(start, end, (node) => {
          if (!node.isInline) return
          if (!node.isText) plain = false
          else if (marks && !Mark.sameSet(marks, node.marks)) plain = false
          else marks ??= node.marks
        })
        if (
          !plain ||
          !marks ||
          marks.some((mark) =>
            ['inlineCode', 'link'].includes(mark.type.name),
          ) ||
          (state.storedMarks && !Mark.sameSet(state.storedMarks, marks))
        )
          return null
        let inTable = false
        for (let depth = $start.depth; depth > 0; depth--)
          if (
            ['table_cell', 'table_header'].includes(
              $start.node(depth).type.name,
            )
          )
            inTable = true
        const parsed = parseLinkedSyntax(
          inTable ? toTable(match[0]) : match[0],
          inTable,
        )
        if (!parsed || parsed.embed) return null
        return state.tr.replaceWith(
          start,
          end,
          type.create(
            {
              raw: parsed.raw,
              target: parsed.target,
              fragment: parsed.fragment,
              label: parsed.label,
              inTable: parsed.inTable,
            },
            undefined,
            marks,
          ),
        )
      },
      { inCodeMark: false },
    ),
)

export function linkedSyntax(wikiLinks: boolean, files: boolean) {
  const syntax: Extension = { text: {} }
  if (wikiLinks)
    syntax.text![91] = {
      name: 'inkkitWikiLink',
      tokenize: linkedTokenizer(false),
      previous: (code) => code !== 33 && code !== 91,
    }
  if (files)
    syntax.text![33] = {
      name: 'inkkitNamedFile',
      tokenize: linkedTokenizer(true),
    }
  const from: FromExtension = {
    enter: {
      inkkitLinkedSyntax(token) {
        const inTable = this.stack.some((node) => node.type === 'tableCell')
        const parsed = parseLinkedSyntax(this.sliceSerialize(token), inTable)
        if (!parsed) {
          this.enter({ type: 'text', value: this.sliceSerialize(token) }, token)
          return
        }
        if (parsed.embed)
          this.enter(
            {
              type: 'image',
              url:
                parsed.target +
                (parsed.fragment != null ? `#${parsed.fragment}` : ''),
              alt:
                parsed.label + (parsed.width != null ? `|${parsed.width}` : ''),
              title: null,
              inkkitFileRaw: parsed.raw,
              inkkitFileTarget: parsed.target,
              inkkitFileFragment: parsed.fragment,
              inkkitFileWidth: parsed.width,
              inkkitFileInTable: inTable,
            },
            token,
          )
        else
          this.enter(
            {
              type: 'inkkitWikiLink',
              value: parsed.label,
              raw: parsed.raw,
              target: parsed.target,
              fragment: parsed.fragment,
              label: parsed.label,
              inTable,
            },
            token,
          )
      },
    },
    exit: {
      inkkitLinkedSyntax(token) {
        this.exit(token)
      },
    },
  }
  const wiki: Handle = (node, _parent, state) =>
    tableForm(
      String(node.raw),
      Boolean(node.inTable),
      state.stack.includes('tableCell'),
    )
  const named: Handle = (node, parent, state, info) => {
    if (node.inkkitFileRaw != null)
      return tableForm(
        String(node.inkkitFileRaw),
        Boolean(node.inkkitFileInTable),
        state.stack.includes('tableCell'),
      )
    if (node.inkkitFileSource != null)
      return pathTableForm(
        node.inkkitFileSource,
        state.stack.includes('tableCell'),
      )
    return defaultHandlers.image(node, parent, state, info)
  }
  // CommonMark owns generated images; authored tokens retain their spelling.
  return $remark(
    'inkkitLinkedSyntax',
    () =>
      function (this: Processor) {
        const data = this.data() as Record<string, unknown[] | undefined>
        ;(data.micromarkExtensions ??= []).push(syntax)
        ;(data.fromMarkdownExtensions ??= []).push(from)
        ;(data.toMarkdownExtensions ??= []).push({
          handlers: {
            inkkitWikiLink: wiki,
            ...(files ? { image: named } : {}),
          },
        })
      },
  )
}
