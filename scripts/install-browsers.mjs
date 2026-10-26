import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// A stalled package mirror can hang `playwright install --with-deps` for
// 30 minutes, so each attempt is bounded and the whole process group is killed.
export async function installBrowsers({
  engines,
  command = [
    process.execPath,
    'node_modules/@playwright/test/cli.js',
    'install',
    '--with-deps',
    ...engines,
  ],
  attempts = 3,
  timeoutMs = 300_000,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const outcome = await new Promise((done) => {
      const child = spawn(command[0], command.slice(1), {
        detached: true,
        stdio: 'inherit',
      })
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The group already exited.
        }
        done('timed out')
      }, timeoutMs)
      child.on('error', () => {
        clearTimeout(timer)
        done('failed to start')
      })
      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        done(code === 0 ? 'ok' : `exited with ${signal ?? `code ${code}`}`)
      })
    })
    if (outcome === 'ok') return 0
    log(`Browser install attempt ${attempt}/${attempts} ${outcome}.`)
  }
  return 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const engines = process.argv.slice(2)
  if (engines.length === 0) throw Error('Name at least one engine to install.')
  process.exitCode = await installBrowsers({ engines })
}
