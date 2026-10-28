const assert = (path, equals) => ({ op: 'assert', path, equals })
export const scenarios = {}
for (const [name, count, ending, marker] of [
  ['crlf-task', 5000, '\r\n', '+ [ ]'],
  ['lf-bullet', 20, '\n', '*'],
]) {
  const middle = Math.floor(count / 2)
  const source =
    Array.from(
      { length: count },
      (_, index) => `${marker} Item ${index} café 😀 __kept__.`,
    ).join(ending) + ending
  const at = `Item ${middle} café 😀 kept.`
  const original = `${marker} Item ${middle} café 😀 __kept__.`
  const split = source.replace(original, original + ending + marker + ' x')
  // Turning one paragraph into two uses the existing whole-writer spelling.
  const lifted = source.replace(
    original,
    original.replace('__kept__', '**kept**') + ending.repeat(2) + '  x',
  )
  const joined = source.replace(original, original + 'x')
  scenarios['native-long-list-' + name] = {
    fixture: {
      source,
      historyClock: true,
      configuration: 'minimal',
      operations: [
        { op: 'select', text: at, from: at.length, to: at.length },
        { op: 'nativeInput', keyCode: 36, characters: '\r' },
        { op: 'nativeInput', keyCode: 7, characters: 'x' },
        assert('snapshot.text', split),
        { op: 'select', text: 'x', from: 0, to: 0 },
        { op: 'historyBoundary' },
        { op: 'nativeInput', keyCode: 51, characters: '\u007f' },
        assert('snapshot.text', lifted),
        { op: 'historyBoundary' },
        { op: 'nativeInput', keyCode: 51, characters: '\u007f' },
        assert('snapshot.text', joined),
        { op: 'undo' },
        assert('snapshot.text', lifted),
        { op: 'redo' },
        assert('snapshot.text', joined),
        { op: 'save' },
        { op: 'reopen' },
        assert('snapshot.text', joined),
        assert('error', null),
        assert('diagnostics', []),
      ],
    },
    native: [
      { key: 'Enter', collapsed: true },
      { key: 'x', collapsed: true, beforeinput: 'insertText' },
      { key: 'Backspace', collapsed: true },
      { key: 'Backspace', collapsed: true },
    ],
    strict: true,
  }
}
