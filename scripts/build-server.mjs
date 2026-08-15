/**
 * Build the self-contained Node server payload for the desktop app.
 *
 * Produces `<repo>/server/`: a production `pnpm deploy` closure of the
 * `@deepseek-ai/dsh` web CLI from a DeepSeek Harness checkout, then
 * re-materializes every `@deepseek-ai/*` workspace package (vendor + packages)
 * as real, symlink-free copies so the tree is portable and Electron can bundle
 * it as-is. The entry point is `<repo>/server/lib/bin.js`:
 *
 *   node server/lib/bin.js web --port <port>
 *
 * `pnpm deploy --legacy --prod --config.auto-install-peers=false` omits
 * workspace packages reachable only through peerDependencies or the `link:`
 * overrides in pnpm-workspace.yaml (cosmokit, schemastery, dsh-scope,
 * dsh-timeout, dsh-fs, ...). The runtime launcher resolves those names through
 * its maintained profiles/node_modules fallback (dsh-app-boot's
 * healProfilesModuleFallback), so this script walks the exact same
 * dependencies + peerDependencies graph and copies every `@deepseek-ai/*`
 * package into the deployed node_modules, then replaces any remaining symlink
 * with real files.
 *
 * Usage: node scripts/build-server.mjs --harness <path/to/deepseek-harness>
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const staging = join(root, 'server')
const DEPLOY_FILTER = '@deepseek-ai/dsh'

const parsed = parseArgs({
  options: { harness: { type: 'string' }, help: { type: 'boolean', default: false } },
})
if (parsed.values.help) {
  console.log('Usage: node scripts/build-server.mjs --harness <path/to/deepseek-harness>')
  process.exit(0)
}
const harness = resolve(parsed.values.harness ?? join(root, '..', 'deepseek-harness'))
const REPO_ANCHOR = join(harness, 'apps', 'cli', 'package.json')

if (!existsSync(REPO_ANCHOR)) {
  console.error(`[build-server] harness anchor not found: ${REPO_ANCHOR}`)
  console.error('[build-server] pass --harness <path> to a deepseek-harness checkout.')
  process.exit(1)
}

/** Quote one argv token for cmd.exe when it contains spaces or quotes. */
function quoteWin(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Run a subprocess with inherited stdio; fail loudly on a non-zero exit. */
function run(command, args, label, cwd = harness) {
  const printable = `${command} ${args.join(' ')}`
  console.log(`[build-server] ${label}: ${printable}`)
  return new Promise((resolvePromise, reject) => {
    const isWin = process.platform === 'win32'
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', `${command} ${args.map(quoteWin).join(' ')}`], {
        cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' },
      })
      : spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
    child.once('error', error => reject(new Error(`[build-server] ${label} failed to spawn: ${error.message}`)))
    child.once('exit', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`[build-server] ${label} failed (exit ${code})`))
    })
  })
}

const pnpm = () => (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')

/** Refuse to wipe a path that contains the repo root. */
function assertSafeToClear(dir) {
  if (dir === root || root.startsWith(dir + sep)) {
    throw new Error(`[build-server] refusing to clear ${dir}: it contains the repo root`)
  }
}

/** Resolve a package dir from one anchor using Node's lookup order. */
function packageDirFromAnchor(anchor, packageName) {
  const paths = createRequire(anchor).resolve.paths(packageName)
  if (paths == null) return undefined
  for (const searchPath of paths) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** Copy one workspace package's runtime artifacts into the deployed closure. */
async function copyPackage(src, dest) {
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  await cp(join(src, 'package.json'), join(dest, 'package.json'))
  for (const file of ['lib', 'dist', 'cordis.patch.yml', 'config']) {
    const from = join(src, file)
    if (existsSync(from)) await cp(from, join(dest, file), { recursive: true })
  }
}

/** Walk deps + peerDeps from the dsh app and copy every @deepseek-ai/* package. */
async function copyWorkspaceClosure() {
  const destRoot = join(staging, 'node_modules', '@deepseek-ai')
  await mkdir(destRoot, { recursive: true })
  const queue = [REPO_ANCHOR]
  const seen = new Map()
  while (queue.length > 0) {
    const anchor = queue.shift()
    const manifest = JSON.parse(await readFile(anchor, 'utf8'))
    const deps = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]
    for (const dep of deps) {
      if (!dep.startsWith('@deepseek-ai/')) continue
      if (seen.has(dep)) continue
      const src = packageDirFromAnchor(anchor, dep)
      if (src === undefined) {
        console.warn(`[build-server] warning: could not resolve ${dep} from ${anchor}`)
        continue
      }
      seen.set(dep, src)
      queue.push(join(src, 'package.json'))
    }
  }
  for (const [name, src] of seen) {
    await copyPackage(src, join(destRoot, name.split('/').pop()))
    console.log(`[build-server] materialized ${name}`)
  }
  console.log(`[build-server] copied ${seen.size} @deepseek-ai workspace packages`)
}

/** Copy koffi and its platform FFI binding so JS and native halves match. */
async function copyKoffiNative() {
  const store = join(harness, 'node_modules', '.pnpm')
  const entries = await readdir(store, { withFileTypes: true })

  let koffiSrc
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('koffi@')) {
      const candidate = join(store, entry.name, 'node_modules', 'koffi')
      if (existsSync(join(candidate, 'package.json'))) { koffiSrc = candidate; break }
    }
  }
  if (koffiSrc !== undefined) {
    const koffiDest = join(staging, 'node_modules', 'koffi')
    await rm(koffiDest, { recursive: true, force: true })
    await cp(koffiSrc, koffiDest, { recursive: true, dereference: true })
    console.log('[build-server] materialized koffi (from harness store)')
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('@koromix+koffi-')) continue
    const rest = entry.name.slice('@koromix+'.length)
    const basename = rest.split('@')[0]
    if (!basename.endsWith(`-${process.platform}-${process.arch}`)) continue
    const src = join(store, entry.name, 'node_modules', '@koromix', basename)
    if (!existsSync(join(src, 'package.json'))) continue
    const dest = join(staging, 'node_modules', '@koromix', basename)
    await rm(dest, { recursive: true, force: true })
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest, { recursive: true, dereference: true })
    console.log(`[build-server] materialized @koromix/${basename}`)
  }
}

async function materializeLink(linkPath) {
  const source = await realpath(linkPath)
  const nestedNodeModules = join(source, 'node_modules')
  await rm(linkPath, { recursive: true, force: true })
  await cp(source, linkPath, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
  })
}

async function findSymlink(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return path
    if (stat.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeStagedLinks() {
  const nodeModules = join(staging, 'node_modules')
  let link = await findSymlink(nodeModules)
  while (link !== undefined) {
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      await materializeLink(link)
    }
    link = await findSymlink(nodeModules)
  }
}

async function trimStagingDocs() {
  await Promise.all(['README.md', 'README.zh.md', 'README.i18n.yaml'].map(name => rm(join(staging, name), { force: true })))
}

async function main() {
  assertSafeToClear(staging)
  await rm(staging, { recursive: true, force: true })
  await run(pnpm(), [
    '--filter', DEPLOY_FILTER, 'deploy',
    '--prod',
    '--legacy',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    staging,
  ], 'pnpm deploy')
  await trimStagingDocs()
  await copyWorkspaceClosure()
  await copyKoffiNative()
  await materializeStagedLinks()
  const entry = join(staging, 'lib', 'bin.js')
  if (!existsSync(entry)) {
    throw new Error(`[build-server] expected entry ${entry} is missing; the deploy did not produce the dsh CLI`)
  }
  console.log(`[build-server] done. Entry: ${entry}`)
}

await main()
