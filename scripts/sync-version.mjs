/**
 * Copy the DeepSeek Harness version into this project's package.json so the
 * desktop release tracks the upstream version. Run after checking out the
 * harness: `node scripts/sync-version.mjs <path/to/deepseek-harness>`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const harness = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', 'deepseek-harness'))
const root = join(import.meta.dirname, '..')

const harnessManifest = JSON.parse(await readFile(join(harness, 'package.json'), 'utf8'))
const version = harnessManifest.version
if (typeof version !== 'string') {
  console.error('[sync-version] harness package.json has no string version')
  process.exit(1)
}

const manifestPath = join(root, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const previous = manifest.version
manifest.version = version
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`[sync-version] ${previous ?? '(none)'} -> ${version}`)
