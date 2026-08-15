# DeepSeek Harness Desktop

A self-contained Windows desktop shell for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web UI. Double-click the exe and the app opens in its own native window — **no
`npx` command and no browser** are needed. The bundled Node server, every
plugin, and the built web frontend all ship inside the package; the target
machine needs no Node.js installation.

> **Built entirely with DeepSeek Harness (`dsh`).**
> This repository — the Electron shell, the payload build pipeline, the CI
> workflow, and this README — was produced end to end by an agent running
> inside DeepSeek Harness (`dsh`).

## Downloads

Every release publishes two artifacts:

| Artifact | Use |
| --- | --- |
| `DeepSeekHarness-<version>-portable.exe` | **Double-click to run.** Self-extracts to a temp dir, no install. |
| `DeepSeekHarness-<version>-x64.zip` | **Extract and run.** Unzip anywhere, then double-click `DeepSeek Harness.exe`. |

The first launch extracts the server payload once (~30 s); later launches start
in a few seconds. App data (sessions, settings, profiles) lives in `~/.dsh`,
exactly as the CLI writes it.

## What this project is

DeepSeek Harness ships a browser UI (`dsh web`, served on `http://127.0.0.1:3080`).
This project wraps it as a desktop app:

- `main.cjs` — the Electron main process. It spawns a bundled `node.exe` against
  the bundled server payload, waits for the `dsh web:` URL line, then opens a
  `BrowserWindow` on that origin. The harness never runs inside Electron's own
  Node runtime (its native addons are ABI-matched to the bundled Node).
- `scripts/build-server.mjs` — produces `server/`, a production `pnpm deploy`
  closure of `@deepseek-ai/dsh` with every `@deepseek-ai/*` workspace package
  (including peer-only and vendored ones, and koffi's native FFI binding)
  re-materialized as real, symlink-free files.
- `scripts/archive-server.mjs` — packs `server/` into a single `server.tar`.
- `scripts/copy-node.mjs` — copies the active Node executable to `node/node.exe`.
- `scripts/sync-version.mjs` — copies the harness version into `package.json`.
- `after-pack.cjs` — electron-builder hook that places `server.tar` and
  `node.exe` into the packaged `resources/`.

### Why the tar archive

The server payload has ~34 000 files under `node_modules`. electron-builder's
`extraResources` filter drops a `node_modules` directory directly under a
`from` directory, and NSIS's `File /r` silently drops files past a large file
count. Shipping one `server.tar` (extracted once into userData on first launch)
keeps the portable installer to a handful of files and sidesteps both limits.

## Build process

### Prerequisites

- Node.js `^22.19 || >=24`
- pnpm `11.x`
- A DeepSeek Harness checkout (cloned and built)

### 1. Build the harness

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
```

### 2. Build the desktop package

```sh
cd deepseek-harness-desktop
npm install                        # electron + electron-builder
node scripts/build-server.mjs --harness ../deepseek-harness
node scripts/copy-node.mjs
node scripts/archive-server.mjs
node scripts/sync-version.mjs ../deepseek-harness
npx electron-builder --win portable zip --publish never
```

Or, once the harness is built, run `npm run dist` (it chains the server payload,
node copy, archive, and packaging steps).

Outputs land in `dist/`:

- `dist/DeepSeekHarness-<version>-portable.exe`
- `dist/DeepSeekHarness-<version>-x64.zip` (electron-builder's `zip` target)

> On a network that cannot reach GitHub directly, set these before `npm install`
> and `electron-builder`:
>
> ```sh
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
> ```

## Continuous integration

`.github/workflows/build-release.yml` keeps releases in sync with upstream:

- **Monitor** — a scheduled job polls
  [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
  (its `master` branch `package.json` version) every 6 hours.
- **Version sync** — the desktop release uses the exact upstream version
  (e.g. `0.1.0-rc.6`); a build runs only when the version has moved (or on
  `workflow_dispatch`, optionally with `force`).
- **Build** — on `windows-latest`: checkout the harness, `pnpm install` +
  `pnpm run build`, build the server payload, then `electron-builder` the
  portable exe and the zip.
- **Release** — publishes a GitHub release tagged `v<version>` with both
  artifacts (marked prerelease when the version contains `-`).

## License

[MIT](LICENSE). This project is a desktop packaging of
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), which is
itself MIT licensed.

---

## 中文说明

**DeepSeek Harness 桌面版**：把 DeepSeek Harness 的 Web UI 封装成独立的
Windows 桌面程序，双击即可在原生窗口中使用，**无需 `npx` 命令、无需浏览器**。
程序内置了 Node 运行时、全部插件和已构建的前端，目标机器无需安装 Node.js。

> 本仓库（Electron 外壳、载荷构建脚本、CI 工作流、本 README）**全程由
> DeepSeek Harness（`dsh`）中的 agent 完成**。

每次 Release 提供两种产物：`-portable.exe`（双击即用）与 `-win64.zip`
（解压即用）。构建流程见上文；CI 会每 6 小时监控上游版本，版本更新时自动编译
exe 与 zip 并发布同名版本号的 Release。项目采用 MIT 协议开源。
