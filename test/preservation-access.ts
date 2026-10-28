import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Preservation } from '../src/preserve'

// Differential tests must exercise the fast paths independently of the
// fallback, and must not silently pass when every edit takes the fallback.
export const localEditsOf = (preservation: Preservation, doc: ProseNode) =>
  preservation['localEdits'](doc)
export const regionsOf = (preservation: Preservation, doc: ProseNode) =>
  preservation['regions'](doc)

export function withoutLocalEdits(preservation: Preservation): Preservation {
  preservation['localEdits'] = () => undefined
  return preservation
}

export function withoutFastPaths(preservation: Preservation): Preservation {
  withoutLocalEdits(preservation)
  preservation['regions'] = () => undefined
  return preservation
}
