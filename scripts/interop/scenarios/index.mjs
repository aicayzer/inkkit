import { scenarios as literalPaste } from './literal-paste.mjs'
import { scenarios as pasteCaret } from './paste-caret.mjs'
import { scenarios as softBreakSpaces } from './soft-break-spaces.mjs'
import { scenarios as sourceRedo } from './source-redo.mjs'
import { scenarios as structuralDeletion } from './structural-deletion.mjs'
import { scenarios as imageDrag } from './image-drag.mjs'

const families = {
  'native-literal-paste': literalPaste,
  'native-paste-caret': pasteCaret,
  'native-soft-break-spaces': softBreakSpaces,
  'native-source-redo': sourceRedo,
  'native-structural-deletion': structuralDeletion,
  'native-image-drag': imageDrag,
}
export const probeScenarios = Object.assign({}, ...Object.values(families))
export const probeGroups = Object.fromEntries(
  Object.entries(families).map(([name, scenarios]) => [
    name,
    Object.keys(scenarios),
  ]),
)
probeGroups['native-editing'] = Object.entries(families)
  .filter(([name]) => name !== 'native-image-drag')
  .flatMap(([, scenarios]) => Object.keys(scenarios))

const contracts = {
  'native-literal-paste':
    'Native pasteboard read through hostPastePlain and trusted AppKit typing; not a native paste shortcut.',
  'native-paste-caret':
    'Public paste followed by trusted AppKit typing; fold setup uses DOM clicks.',
  'native-soft-break-spaces':
    'Trusted AppKit space and beforeinput at a collapsed soft-break boundary.',
  'native-source-redo':
    'Public selection setup and trusted source undo, type and undo in WKWebView.',
  'native-structural-deletion':
    'One AppKit batch of three trusted collapsed Backspaces.',
  'native-image-drag':
    'WKWebView drag data observed by an AppKit destination; drop refused.',
}
for (const [family, scenarios] of Object.entries(families))
  for (const scenario of Object.values(scenarios))
    scenario.contract = contracts[family]
