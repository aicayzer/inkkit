import { copyFile } from 'node:fs/promises'

// Keep the filename used by existing host build recipes. Both entries now
// bundle their dependencies, so the generated package notices cover both.
await copyFile(
  'dist/THIRD-PARTY-NOTICES.txt',
  'dist/THIRD-PARTY-NOTICES-FULL.txt',
)
