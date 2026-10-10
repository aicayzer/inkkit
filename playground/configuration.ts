import {
  fixtures,
  configurations,
  type AdapterMode,
} from '../scripts/interop/consumer/fixtures'

export interface Setup {
  fixture: string
  configuration: 'minimal' | 'rich'
  adapterMode: 'normal' | 'reject' | 'hold'
  imageImport: 'normal' | 'reject' | 'hold'
  imageExport: AdapterMode
  fileAdapter: AdapterMode
  editable: boolean
  editors: 1 | 2
  files: boolean
}
export function validateSetup(setup: Setup): Setup {
  if (!Object.hasOwn(fixtures, setup.fixture))
    throw Error(`Unknown fixture: ${setup.fixture}`)
  if (!configurations.includes(setup.configuration))
    throw Error(`Unknown configuration: ${setup.configuration}`)
  for (const key of [
    'adapterMode',
    'imageImport',
    'imageExport',
    'fileAdapter',
  ] as const) {
    const allowed =
      key === 'adapterMode' || key === 'imageImport'
        ? ['normal', 'reject', 'hold']
        : ['normal', 'reject', 'hold', 'corrupt']
    if (!allowed.includes(setup[key]))
      throw Error(`Unknown ${key}: ${setup[key]}`)
  }
  if (setup.editors !== 1 && setup.editors !== 2)
    throw Error('Editors must be 1 or 2')
  if (typeof setup.editable !== 'boolean' || typeof setup.files !== 'boolean')
    throw Error('Editable and files must be boolean')
  return { ...setup }
}
export function readSetup(search: string): Setup {
  const params = new URLSearchParams(search)
  const adapter = params.get('adapter') ?? 'normal'
  return validateSetup({
    fixture: params.get('fixture') ?? 'everyday',
    configuration: (params.get('configuration') ??
      'rich') as Setup['configuration'],
    adapterMode: adapter as Setup['adapterMode'],
    imageImport: (params.get('imageImport') ?? adapter) as Setup['imageImport'],
    imageExport: (params.get('imageExport') ?? adapter) as AdapterMode,
    fileAdapter: (params.get('fileAdapter') ?? adapter) as AdapterMode,
    editable: params.get('editable') !== 'false',
    editors: params.get('editors') === '2' ? 2 : 1,
    files: params.get('files') === 'true',
  })
}
export function setupURL(setup: Setup, href: string): string {
  const url = new URL(href)
  for (const [key, value] of Object.entries(setup)) {
    url.searchParams.set(key === 'adapterMode' ? 'adapter' : key, String(value))
  }
  return url.href
}
