/**
 * Copy the active Node.js executable into `node/node.exe` so the packaged
 * desktop app can run the harness server without a system Node. The current
 * Node must satisfy the harness engines range (^22.19 || >=24). On CI this
 * runs on `windows-latest`, so `process.execPath` is the Windows node.exe whose
 * ABI matches the native addons built during the harness install.
 */

import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const dest = join(import.meta.dirname, '..', 'node', 'node.exe')
const source = process.execPath

await mkdir(dirname(dest), { recursive: true })
await copyFile(source, dest)
console.log(`[copy-node] copied ${source} -> ${dest}`)
