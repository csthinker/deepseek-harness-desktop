/**
 * Archive the built server payload (`server/`) into a single `server.tar` so
 * the portable installer only carries one payload file instead of tens of
 * thousands of `node_modules` entries (NSIS's `File /r` silently drops files
 * past a large file count). The Electron main extracts it on first launch.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = import.meta.dirname + '/..'
const serverDir = join(root, 'server')
const out = join(root, 'server.tar')

if (!existsSync(join(serverDir, 'lib', 'bin.js'))) {
  console.error('[archive-server] server/lib/bin.js is missing; run `node scripts/build-server.mjs` first.')
  process.exit(1)
}

await rm(out, { force: true })

const child = spawn('tar', ['-cf', out, '-C', root, 'server'], { stdio: 'inherit' })
await new Promise((resolvePromise, reject) => {
  child.once('error', reject)
  child.once('exit', code => (code === 0 ? resolvePromise() : reject(new Error(`tar exited ${code}`))))
})

console.log(`[archive-server] wrote ${out}`)
