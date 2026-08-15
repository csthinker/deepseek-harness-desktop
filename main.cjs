'use strict'

/**
 * Electron main process for the DeepSeek Harness desktop app.
 *
 * It does not run any harness code in Electron's own Node runtime: the harness
 * requires real Node >= 22.19 (with ABI-matched native addons), so this shell
 * spawns a bundled `node.exe` against the bundled server payload and renders
 * the served web UI in a native BrowserWindow. No browser is involved and no
 * terminal command is needed — the window IS the app.
 */

const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

let serverProcess = null
let mainWindow = null
let quitting = false

/** Directory holding `server/` (dev) or `server.tar`/`node/` (packaged). */
function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : __dirname
}

function nodeExe() {
  return path.join(resourcesDir(), 'node', 'node.exe')
}

/**
 * The directory whose `lib/bin.js` boots the web server. In dev it is the
 * loose `desktop/server/`; packaged builds extract `resources/server.tar` into
 * userData once and reuse it on later launches.
 */
function serverRoot() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'server')
    : path.join(__dirname, 'server')
}

function serverBin() {
  return path.join(serverRoot(), 'lib', 'bin.js')
}

/** Extract `resources/server.tar` into the server root once. */
function ensureServerExtracted() {
  if (!app.isPackaged) return
  if (fs.existsSync(serverBin())) return
  const tar = path.join(resourcesDir(), 'server.tar')
  if (!fs.existsSync(tar)) {
    throw new Error(`Server payload is missing: ${tar}`)
  }
  const root = serverRoot()
  const parent = path.dirname(root)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(parent, { recursive: true })
  const tarExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  // The archive's top-level entry is `server/`, so extract into the parent so
  // it materializes as `<userData>/server/`.
  const result = spawnSync(tarExe, ['-xf', tar, '-C', parent], { stdio: 'ignore' })
  if (result.status !== 0) {
    throw new Error(`Failed to extract the DeepSeek Harness server payload (tar exit ${result.status}).`)
  }
}

/** Kill the server process tree on Windows; POSIX uses a plain SIGTERM. */
function stopServer() {
  if (serverProcess === null) return
  const child = serverProcess
  serverProcess = null
  if (process.platform === 'win32' && child.pid !== undefined) {
    // /T kills the whole tree so worker/subprocess children do not linger.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function showFatal(message) {
  dialog.showErrorBox('DeepSeek Harness', message)
  app.quit()
}

/**
 * Start the bundled dsh web server and resolve with its HTTP origin once the
 * `dsh web:` line is printed. The port is OS-assigned (`--port 0`) so two
 * instances never collide.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    // Port 0 lets the OS assign a free port; DSH_DESKTOP_PORT pins one for tests.
    const port = process.env.DSH_DESKTOP_PORT || '0'
    const child = spawn(nodeExe(), [serverBin(), 'web', '--host', '127.0.0.1', '--port', port], {
      cwd: serverRoot(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    serverProcess = child

    let settled = false
    let buffer = ''
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('Timed out waiting for the DeepSeek Harness server to start.'))
      }
    }, 120_000)

    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      const match = buffer.match(/dsh web:\s+(http:\/\/\S+)/)
      if (match !== null && !settled) {
        settled = true
        clearTimeout(timeout)
        resolve(match[1])
      }
    })

    child.stderr.on('data', chunk => {
      process.stderr.write(chunk)
    })

    child.once('error', error => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
    })

    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(`DeepSeek Harness server exited before startup (code ${code ?? signal}).`))
      } else if (!quitting) {
        // The server died while the app was running.
        if (mainWindow !== null && !mainWindow.isDestroyed()) {
          dialog.showMessageBoxSync(mainWindow, {
            type: 'error',
            title: 'DeepSeek Harness',
            message: 'The DeepSeek Harness server stopped unexpectedly.',
            detail: `Exit code: ${code ?? signal}.`,
          })
        }
        app.quit()
      }
    })
  })
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the OS browser, never in the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadURL(origin).catch(error => {
    showFatal(`Failed to load the DeepSeek Harness UI: ${error.message}`)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      ensureServerExtracted()
      const origin = await startServer()
      createWindow(origin)
    } catch (error) {
      showFatal(error instanceof Error ? error.message : String(error))
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    stopServer()
  })
}
