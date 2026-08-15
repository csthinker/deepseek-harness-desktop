'use strict'

/**
 * electron-builder `afterPack` hook: copy the self-contained server payload
 * archive (`server.tar`) and the bundled `node.exe` into the packaged app's
 * `resources/`.
 *
 * `extraResources` cannot be used for the server's `node_modules` because
 * electron-builder's file filter drops a `node_modules` directory directly
 * under a `from` directory, and NSIS's `File /r` silently drops files past a
 * large file count. Shipping one tar archive keeps the portable installer to a
 * handful of files; the Electron main extracts it on first launch.
 */

const { copyFile, mkdir } = require('node:fs/promises')
const path = require('node:path')

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir
  const resources = path.join(context.appOutDir, 'resources')

  const nodeSrc = path.join(projectDir, 'node', 'node.exe')
  const nodeDst = path.join(resources, 'node', 'node.exe')
  await mkdir(path.dirname(nodeDst), { recursive: true })
  await copyFile(nodeSrc, nodeDst)

  const tarSrc = path.join(projectDir, 'server.tar')
  const tarDst = path.join(resources, 'server.tar')
  await copyFile(tarSrc, tarDst)

  console.log(`[after-pack] copied node.exe and server.tar into ${resources}`)
}
