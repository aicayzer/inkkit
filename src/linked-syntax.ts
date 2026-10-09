import { $node, $remark } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Literal } from 'mdast'
import type { Extension as FromExtension } from 'mdast-util-from-markdown'
import { defaultHandlers, type Handle } from 'mdast-util-to-markdown'
import type { Code, Extension, Tokenizer, State } from 'micromark-util-types'
import type { Processor } from 'unified'
import type { FileReference, WikiLinkReference } from './types'

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
        character.charCodeAt(0) < 32 ||
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
  if (
    embed &&
    (!parts.target.trim() ||
      (hasAlias && (!/^\d{1,5}$/.test(parts.alias) || Number(parts.alias) < 1)))
  )
    return undefined
  return {
    raw,
    target: parts.target,
    fragment: hasFragment ? parts.fragment : null,
    label:
      !embed && hasAlias
        ? parts.alias
        : parts.target + (hasFragment ? `#${parts.fragment}` : ''),
    width: embed && hasAlias ? Number(parts.alias) : null,
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
      raw += String.fromCodePoint(code)
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
      if (code === null || code < 32 || code === 91) return nok(code)
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
    target: String(node.attrs.target),
    ...(node.attrs.fragment != null
      ? { fragment: String(node.attrs.fragment) }
      : {}),
    label: String(node.attrs.label),
  }
}

export function fileReference(node: ProseNode): FileReference {
  const reference = String(node.attrs.src ?? '')
  const named = node.attrs.inkkitFileRaw != null
  const alt = String(node.attrs.alt ?? '')
  const match = /\|(\d{1,5})$/.exec(alt)
  const fragment = named
    ? node.attrs.inkkitFileFragment
    : reference.includes('#')
      ? reference.slice(reference.indexOf('#') + 1)
      : null
  const label = named
    ? String(node.attrs.inkkitFileTarget ?? '') +
      (fragment != null ? `#${fragment}` : '')
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
    ...(fragment != null ? { fragment: String(fragment) } : {}),
    ...(label ? { label } : {}),
    ...(width != null ? { width } : {}),
  }
}

export function namedFileMarkdown(
  node: ProseNode,
  inTable = false,
): string | undefined {
  if (node.attrs.inkkitFileRaw == null) return undefined
  let raw = String(node.attrs.inkkitFileRaw)
  const authoredInTable = Boolean(node.attrs.inkkitFileInTable)
  const width = fileReference(node).width ?? null
  const original = node.attrs.inkkitFileWidth ?? null
  if (width !== original) {
    if (authoredInTable) raw = fromTable(raw)
    if (original != null) raw = raw.replace(/\|\d{1,5}\]\]$/, ']]')
    if (width != null) raw = `${raw.slice(0, -2)}|${width}]]`
    return inTable ? toTable(raw) : raw
  }
  return tableForm(raw, authoredInTable, inTable)
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
        return parsed && !parsed.embed
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
    return defaultHandlers.image(node, parent, state, info)
  }
  // Standard image handling is installed by CommonMark; wrap it only for authored named tokens.
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
