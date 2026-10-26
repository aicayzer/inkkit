import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// A stalled package mirror can hang `playwright install --with-deps` for
// 30 minutes, so each attempt is bounded and the whole process group is killed.
// Playwright runs apt through sudo, so that apt-get belongs to root, survives the
// kill and keeps the dpkg lock, and every later attempt fails at once with
// "Could not get lock". Stop it and let dpkg recover before the next attempt.
export function releasePackageLock() {
  if (process.platform !== 'linux') return
  for (const command of [
    ['pkill', '-KILL', '-x', 'apt-get'],
    ['pkill', '-KILL', '-x', 'dpkg'],
    ['dpkg', '--configure', '-a'],
  ])
    spawnSync('sudo', ['-n', ...command], { stdio: 'ignore', timeout: 60_000 })
}

// A stalled mirror otherwise holds one download open until the whole attempt times
// out. A short network timeout and a few retries make apt give up on a stalled
// connection and ask again, which usually succeeds within seconds.
export function configureApt() {
  if (process.platform !== 'linux') return
  spawnSync('sudo', ['-n', 'tee', '/etc/apt/apt.conf.d/99inkkit-timeouts'], {
    input:
      'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "5";\n',
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 30_000,
  })
}

export async function installBrowsers({
  engines,
  withDeps = true,
  command = [
    process.execPath,
    'node_modules/@playwright/test/cli.js',
    'install',
    ...(withDeps ? ['--with-deps'] : []),
    ...engines,
  ],
  attempts = 3,
  timeoutMs = 300_000,
  recover = releasePackageLock,
  prepare = withDeps ? configureApt : () => {},
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  await prepare()
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
    if (attempt < attempts) await recover()
  }
  return 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // `--no-deps` skips the system packages. The GitHub Ubuntu image already has
  // what Chromium needs, and the package mirror is the part that stalls.
  const args = process.argv.slice(2)
  const withDeps = !args.includes('--no-deps')
  const engines = args.filter((arg) => arg !== '--no-deps')
  if (engines.length === 0) throw Error('Name at least one engine to install.')
  process.exitCode = await installBrowsers({ engines, withDeps })
}
