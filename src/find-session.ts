import { InkKitError } from './types'
import type {
  FindSession,
  FindState,
  ReadableTextSnapshot,
  TextRange,
} from './types'

/** The part of the editor a session drives. */
export interface FindHost {
  textSnapshot(expectedGeneration?: number): ReadableTextSnapshot
  searchMatches(text: string, expectedGeneration?: number): readonly TextRange[]
  find(text: string, expectedGeneration?: number): boolean
  replace(
    search: string,
    replacement: string,
    expectedGeneration?: number,
  ): boolean
  replaceAll(
    search: string,
    replacement: string,
    expectedGeneration?: number,
  ): number
  selectTextRange(
    range: TextRange,
    options?: { focus?: boolean; reveal?: boolean },
  ): void
}

/** The codes of failures that mean the editor cannot answer now, not that the session is wrong. */
const transient: readonly string[] = [
  'not-ready',
  'stale-document',
  'composition',
  'operation-pending',
]

/** The editor refreshes each open session after every edit, selection change, load and mode change. */
export class EditorFindSession implements FindSession {
  private text = ''
  private reported = ''
  private closed = false
  private busy = false
  private cached?: {
    snapshotId: string
    query: string
    matches: readonly TextRange[]
  }

  constructor(
    private readonly host: FindHost,
    private readonly onChange: (state: FindState) => void,
    private readonly detach: (session: EditorFindSession) => void,
  ) {}

  state(expectedGeneration?: number): FindState {
    this.assertOpen()
    return this.measure(expectedGeneration)
  }

  find(
    query: string,
    options?: { direction?: 'next' | 'previous' },
    expectedGeneration?: number,
  ): boolean {
    this.assertOpen()
    return this.command(expectedGeneration, () =>
      this.select(query, options?.direction, expectedGeneration),
    )
  }

  next(expectedGeneration?: number): boolean {
    this.assertOpen()
    return this.command(expectedGeneration, () =>
      this.select(this.text, 'next', expectedGeneration),
    )
  }

  previous(expectedGeneration?: number): boolean {
    this.assertOpen()
    return this.command(expectedGeneration, () =>
      this.select(this.text, 'previous', expectedGeneration),
    )
  }

  replace(
    query: string,
    replacement: string,
    expectedGeneration?: number,
  ): boolean {
    this.assertOpen()
    return this.command(expectedGeneration, () => {
      const changed = this.restoring(expectedGeneration, () => {
        this.select(query, undefined, expectedGeneration)
        return this.host.replace(query, replacement, expectedGeneration)
      })
      // Even a match that needed no change is passed over, so repeated replacing reaches the end.
      const snapshot = this.host.textSnapshot(expectedGeneration)
      const matches = this.matches(
        query,
        snapshot.snapshotId,
        expectedGeneration,
      )
      const following =
        matches.find((range) => range.from >= snapshot.selection.to) ??
        matches[0]
      if (following) this.host.selectTextRange(following, { reveal: true })
      return changed
    })
  }

  replaceAll(
    query: string,
    replacement: string,
    expectedGeneration?: number,
  ): number {
    this.assertOpen()
    return this.command(expectedGeneration, () =>
      this.restoring(expectedGeneration, () => {
        this.select(query, undefined, expectedGeneration)
        return this.host.replaceAll(query, replacement, expectedGeneration)
      }),
    )
  }

  clear(expectedGeneration?: number): void {
    this.assertOpen()
    this.command(expectedGeneration, () => {
      this.text = ''
      this.host.find('', expectedGeneration)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.detach(this)
    if (!this.text) return
    try {
      this.host.find('')
    } catch (error) {
      if (!(error instanceof InkKitError) || !transient.includes(error.code))
        throw error
    }
  }

  /** Reports the state if it changed. The editor calls this after each of its own updates; nothing
   *  it cannot answer now is reported. */
  refresh(expectedGeneration?: number): void {
    if (this.closed || this.busy) return
    let state: FindState
    try {
      state = this.measure(expectedGeneration)
    } catch (error) {
      if (error instanceof InkKitError && transient.includes(error.code)) return
      throw error
    }
    const key = JSON.stringify([
      state.documentId,
      state.generation,
      state.query,
      state.current,
      state.total,
    ])
    if (key === this.reported) return
    this.reported = key
    this.onChange(state)
  }

  /** Forgets the query after a new document loads. */
  reset(): void {
    this.text = ''
    this.cached = undefined
  }

  /** Highlights the query again where the editor dropped its highlights, such as after a reload or
   *  a mode change, and leaves the selection where it was. */
  reapply(): void {
    if (this.closed) return
    this.cached = undefined
    if (!this.text) return
    this.busy = true
    try {
      const { selection } = this.host.textSnapshot()
      this.host.find(this.text)
      this.host.selectTextRange(selection)
    } catch (error) {
      if (!(error instanceof InkKitError) || !transient.includes(error.code))
        throw error
    } finally {
      this.busy = false
    }
  }

  private assertOpen(): void {
    if (this.closed)
      throw new InkKitError('destroyed', 'The find session was closed')
  }

  /** Runs a command without reporting the editor's intermediate states, then reports the result. */
  private command<T>(expectedGeneration: number | undefined, run: () => T): T {
    this.busy = true
    let failed = true
    try {
      const result = run()
      failed = false
      return result
    } finally {
      this.busy = false
      if (!failed) this.refresh(expectedGeneration)
      else
        try {
          this.refresh(expectedGeneration)
        } catch {
          // The command's own failure is the one to report.
        }
    }
  }

  private select(
    query: string,
    direction: 'next' | 'previous' | undefined,
    expectedGeneration?: number,
  ): boolean {
    const snapshot = this.host.textSnapshot(expectedGeneration)
    const matches = this.matches(query, snapshot.snapshotId, expectedGeneration)
    const changedQuery = query !== this.text
    const selected = matches.findIndex((range) =>
      sameRange(range, snapshot.selection),
    )
    let index = selected
    if (changedQuery || index < 0) {
      if (direction === 'previous') {
        index = -1
        for (let at = matches.length - 1; at >= 0; at -= 1)
          if (matches[at]!.to <= snapshot.selection.from) {
            index = at
            break
          }
        if (index < 0) index = matches.length - 1
      } else {
        index = matches.findIndex(
          (range) => range.from >= snapshot.selection.from,
        )
        if (index < 0) index = 0
      }
    } else if (direction)
      index =
        (index + (direction === 'next' ? 1 : -1) + matches.length) %
        matches.length
    // The highlights change with the query. Stepping only moves the selection.
    if (changedQuery || !query) this.host.find(query, expectedGeneration)
    this.text = query
    const match = matches[index]
    if (match) this.host.selectTextRange(match, { reveal: true })
    return !!match
  }

  /** Runs an edit and, if it fails, puts the query, highlights and selection back. */
  private restoring<T>(
    expectedGeneration: number | undefined,
    run: () => T,
  ): T {
    const before = this.host.textSnapshot(expectedGeneration)
    const previous = this.text
    try {
      return run()
    } catch (error) {
      this.text = previous
      this.host.find(previous, expectedGeneration)
      this.host.selectTextRange(before.selection)
      throw error
    }
  }

  private measure(expectedGeneration?: number): FindState {
    const snapshot = this.host.textSnapshot(expectedGeneration)
    const matches = this.matches(
      this.text,
      snapshot.snapshotId,
      expectedGeneration,
    )
    return {
      documentId: snapshot.documentId,
      generation: snapshot.generation,
      revision: snapshot.revision,
      query: this.text,
      current:
        matches.findIndex((range) => sameRange(range, snapshot.selection)) + 1,
      total: matches.length,
    }
  }

  private matches(
    query: string,
    snapshotId: string,
    expectedGeneration?: number,
  ): readonly TextRange[] {
    if (!query) return []
    if (this.cached?.snapshotId !== snapshotId || this.cached.query !== query)
      this.cached = {
        snapshotId,
        query,
        matches: this.host.searchMatches(query, expectedGeneration),
      }
    return this.cached.matches
  }
}

function sameRange(left: TextRange, right: TextRange): boolean {
  return (
    left.snapshotId === right.snapshotId &&
    left.from === right.from &&
    left.to === right.to
  )
}
