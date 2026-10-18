# Claude Desktop 2.37337.1 (Windows MSIX) — REA 静态分析架构图
> **版本提示（2026-10-18）：** 本稿对应 Claude Desktop 2.37337.1.0，是历史版本分析。本目录当前 `Claude.msix` 为 2.42304.0.0；新版 REA 与前端分析见 [rea-architecture-frontend-deep-dive.md](rea-architecture-frontend-deep-dive.md)。旧稿中的 bundle 名、资源数量和配置细节不应直接视作新版事实。

> 证据来源：`app.asar`（SHA-256 `6290a54e…`）静态解析 + 解包文本检索。
> 所有结论为静态观察/推断（REA Evidence `ev_b646af…`），不证明运行时行为。

## 1. 总体架构

```
┌────────────────────────────────────────────────────────────────────┐
│  Claude Desktop  (Electron, MSIX: Claude_2.37337.1.0_x64)          │
│  package.json: @ant/desktop  main = .vite/build/index.pre.js        │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Main 进程 (Node)                                                   │
│  index.pre.js ─→ index.js ─→┬─ index.chunk-CC6MOcaE.js  (引导/公共) │
│                            └─ index.chunk-CHpJbW9_.js (核心,6.7MB)│
│                                        │  require 142 个 chunk      │
│  ┌─────────────────────────────────────┴──────────────────────┐    │
│  │ 主进程子系统（均在 index.chunk-CHpJbW9_.js 内观察到）        │    │
│  │                                                            │    │
│  │  · 托管配置   registry/GPO `HKLM\SOFTWARE\Policies\Claude`  │    │
│  │                + `Policies\ClaudeCode`（Code 会话检测）     │    │
│  │  · Provider 抽象 anthropic / gateway / vertex / bedrock /   │    │
│  │                foundry（inferenceProvider 配置键）          │    │
│  │  · 模型目录   https://downloads.claude.ai/                  │    │
│  │                model-catalog/v1/catalog.json（签名,5–15min 轮询）│
│  │  · 自动更新   autoUpdater / Squirrel-MSIX updater,          │    │
│  │                disableAutoUpdates 键可阻断                  │    │
│  │  · Code helper 下载管理 buildPin 清单(版本+校验和+大小),    │    │
│  │                baseUrl https://downloads.claude.ai/         │    │
│  │                claude-code-releases,claude-ssh-releases     │    │
│  │                CLAUDE_CODE_LOCAL_BINARY 可本地覆盖          │    │
│  │  · Cowork VM  userData/claude-code-vm (vmStorageDir)        │    │
│  │  · OAuth 登录  claude.ai / platform.claude.com /v1/oauth/*   │    │
│  │  · 遥测       Sentry + Datadog intake + 可配 OTLP 导出       │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                    │
│  Renderer 窗口（sandbox:!0, contextIsolation:!0, nodeIntegration:0)│
│  ├─ main_window        主 UI（Chat/Cowork/Code 标签页所在）        │
│  ├─ buddy_window / quick_window / about_window                     │
│  ├─ find_in_page       查找栏（preload: .vite/build/findInPage.js）│
│  └─ local_exec_consent / computerUse* 等辅助窗口                   │
│                                                                    │
│  Utility Process 子进程                                             │
│  ├─ pty-host/ptyHostWorker.js  node-pty 终端宿主                   │
│  │    （消息端口通信; Windows 默认 powershell.exe,                  │
│  │     失败回退 conpty; SSH 会话经 ssh -t … exec $SHELL）          │
│  └─ file-index-worker/fileIndexWorker.js  文件索引                 │
│                                                                    │
│  外置辅助二进制（app\resources\，均在 ASAR 外）                    │
│  ├─ claude-ssh-broker.exe / claude-ssh-proxy.exe / askpass        │
│  ├─ github-mcp\github-mcp-server.exe（内置 MCP 服务器）            │
│  └─ office365-mcp\*.node + msalruntime.dll（M365 MCP）             │
└────────────────────────────────────────────────────────────────────┘
                          │ IPC（$eipc_message$_UUID_$_通道名, 前缀校验）
                          ▼
┌────────────────────────────────────────────────────────────────────┐
│  Code 标签页 = Claude Code CLI（独立原生 helper）                    │
│                                                                    │
│  1) 会话启动时 Desktop 在 userData 下管理 claude.exe 副本：        │
│     buildPin 版本 52d82f0a…, 平台清单(每平台 checksum+size),        │
│     win32-x64: claude.exe.zst (~91.9MB 压缩)                       │
│     下载源 https://downloads.claude.ai/claude-code-releases        │
│     校验失败→离线安装包内置组件/回退已装版本                        │
│                                                                    │
│  2) Desktop 用组装 env 启动 helper：函数 bJ() 设置                  │
│     ANTHROPIC_BASE_URL = e.apiHost ← getApiHost()                  │
│       = provider.apiHostOverride() ?? 默认 anthropic API            │
│     (gateway provider: apiHostOverride = creds.baseUrl =           │
│      inferenceGatewayBaseUrl 配置值; E2E 测试可被                   │
│      CLAUDE_E2E_INFERENCE_BASE_URL 覆盖,默认 api.anthropic.com)    │
│     另注入 ANTHROPIC_API_KEY/AUTH_TOKEN(清空后由 secrets 落盘)、    │
│     CLAUDE_CODE_OAUTH_TOKEN、CLAUDE_CODE_HOST_AUTH_ENV_VAR 等      │
│                                                                    │
│  3) 凭证经 writeSessionSecrets 物化到 CCD session-secrets 目录,    │
│     按 authScheme 决定 env 变量名: bearer→ANTHROPIC_AUTH_TOKEN,    │
│     x-api-key→ANTHROPIC_API_KEY; anthropicWire() 统一携带         │
│     baseUrl/defaultAuthScheme/adminHeaders/providerLabel           │
│                                                                    │
│  4) helper 自身即完整 Claude Code CLI 打包:                         │
│     端点 /v1/messages(含 beta)、/v1/messages/batches、              │
│     count_tokens、/v1/complete、files、models、organizations/*、    │
│     agents/sessions/skills/vaults…（Admin/OAuth 套件完整内置）     │
│     内置 env 白名单: ANTHROPIC_BASE_URL、ANTHROPIC_API_KEY…        │
│     多 provider 变量: *_BEDROCK_/*_VERTEX_/*_FOUNDRY_BASE_URL      │
│     allowedProviders/custodians 由 managed settings 钉死          │
│                                                                    │
│  5) 标题生成等一次性调用可不经 helper: 主进程直接 POST              │
│     /v1/messages（Prn() 构造 requestUrl+headers,                   │
│     anthropic-version 2023-06-01）                                 │
└────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────────┐
│  出网端点（仅列代码中字符串证据）                                   │
│  api.anthropic.com · platform.claude.com · claude.ai/claude.com    │
│  downloads.claude.ai (helper/SSH二进制+model-catalog+更新)         │
│  releases.claude.com (updateViaUpdatesHost 时) · sentry.io ·       │
│  *.ingest.us.sentry.io · browser-intake-*.datadoghq.com ·          │
│  storage.googleapis.com · www.google.com/*.gstatic.com (favicon)   │
│  + inferenceGatewayBaseUrl 指向的自建网关                          │
└────────────────────────────────────────────────────────────────────┘
```

## 2. 关键文件—子系统对照

| 文件（ASAR 内路径） | 角色 |
|---|---|
| `package.json` | `@ant/desktop` 2.37337.1, main 入口 |
| `.vite/build/index.pre.js` | 主进程引导（Sentry 初始化 → index.js） |
| `.vite/build/index.chunk-CHpJbW9_.js` | 核心：配置/Provider/网关/更新/helper 下载/认证（6.7MB） |
| `.vite/build/index.chunk-C4qJSrNf.js` | Claude Code CLI SDK 主体（env 变量、OAuth 常量、managed-settings 逻辑）（1.2MB） |
| `.vite/build/index.chunk-Csli2d_D.js` | Anthropic API 客户端类（/v1/* 全端点） |
| `.vite/build/index.chunk-DIEpbncU.js` | pty-host 宿主 + ShellPtyManager（终端） |
| `.vite/build/pty-host/ptyHostWorker.js` | node-pty worker（utilityProcess.fork） |
| `.vite/build/mainWindow.js` / `mainView.js` | 主窗口 preload/视图桥 |
| `.vite/build/findInPage.js` | 查找窗口 preload |
| `.vite/build/code-*/` 等其余 chunk | Code 会话、Cowork、SSH 等按需加载 |
| `node_modules/@ant/claude-native/*.node` | 桌面原生扩展（unpacked，签名校验有 6 处 contradiction 记录） |
| `resources/github-mcp/`, `resources/office365-mcp/` | 内置 MCP 服务器二进制 |

## 3. 与"离线内网部署"相关的静态结论（2.37337.1.0）

- **网关**：`inferenceProvider:"gateway"` + `inferenceGatewayBaseUrl`（readers 含 `code`）→
  Desktop 以 `ANTHROPIC_BASE_URL` 传给 Code helper；`GET /v1/models` 可选，用于自动发现模型。
- **关闭 Anthropic 出网**（与 telemetry 文档一致的代码键）：
  `disableAutoUpdates`、`disableEssentialTelemetry`、`disableNonessentialTelemetry`、
  `disableNonessentialServices`、`modelCatalogEnabled:false`（或 `modelCatalogUrl` 内网镜像）。
- **helper 下载**：Code 会话依赖 `downloads.claude.ai/claude-code-releases` 的 buildPin 清单；
  离线安装包把 workspace+CLI 打进 MSIX。运行时也可用 `CLAUDE_CODE_LOCAL_BINARY`
  指向本地可执行文件做覆盖（`[CCD] LOCAL OVERRIDE` 日志标记）。
- **托管配置**：Windows 读 `HKLM/HKCU\SOFTWARE\Policies\Claude`（Desktop 键）与
  `SOFTWARE\Policies\ClaudeCode`（Code 会话托管设置）；MDM/GPO 值类型不合法会整块忽略。

## 4. 深入分析补充（第二轮，静态证据）

### 4.1 双渲染模式：`app://localhost`（3P）vs `claude.ai`（1P）

- `iu = "app://localhost"`：custom-3p 部署下主视图的固定 origin。
- `Z$r()` 安装 `app://` protocol handler：仅接受 `hostname === "localhost"`，
  `Origin` 不等于 `app://localhost` 返回 403；文件从
  `userData/../ion-dist`（ASAR 内 `resources/ion-dist`，即"bundled local web application"）读取。
  剩余路径由 custom-3p stub 响应（失败返回 503）。
- 标准模式（1P）：`QD() = getMainWindowUrl()` → `https://claude.ai`，重定向由
  claudeURLHandler 处理（`claude://` 深链白名单协议）。
- 登录态切换：`c=LJn()`（已登录）；`u = c ? "app" : "login"`；未登录时用 `GJn(e)` 恢复登录窗口布局。
- 主窗口 preload：`.vite/build/mainWindow.js`，`additionalArguments` 携带 window token。

### 4.2 Privileged schemes（注册于 app ready 前）

`cowork-artifact://`、`cowork-file://`（stream）、`claude-media://`（bypassCSP）、
`claude-simulator://`（corsEnabled）+ 动态 `e_n`（含 `app`）。

### 4.3 IPC 桥（帧级安全）

- 通道前缀：`$eipc_message$_7e53d64a-…-…$_claude.internal.ui_$_<Window>_$_<method>`。
- mainWindow preload 暴露的通道（实测 11 个）：
  `AboutWindow_$_{openHelp,getSupport,getAppName,getBuildProps,ancientJournal}`、
  `MainWindowTitleBar_$_{titleBarReady,requestRestartApp,requestReloadMainView,requestMainMenuPopup}`、
  `QuickWindow_$_{requestDismiss,requestSkooch}`。
- preload 自带 **帧一致性校验**：`webFrame.top.frameToken === webFrame.frameToken`
  （fallback `routingId`）；main 侧另有 `frame-id`/`process-id`/`sender-frame` 校验
  （`index.chunk-CHpJbW9_.js` 的 sender-validation-candidate 观测）。

### 4.4 custom-3p 的 Provider 工厂（配置 → creds）

`switch(t.provider)`：`anthropic` / `gateway` / `vertex` / `bedrock` / `mantle` / `foundry`。
- `gateway`: `baseUrl = t.baseUrl ?? du.gatewayBaseUrl`（默认 anthropic.com 不适用——
  构造时 `CLAUDE_E2E_INFERENCE_BASE_URL ?? "https://api.anthropic.com"`），
  凭证类型 static / interactive(=sso) / external-idp(OIDC)；
  `gatewayManagedClaudeCode`（flatKey `inferenceGatewayManagedClaudeCode`，
  2.9939.2+，public-undocumented）开启后由 Desktop 全面托管 Code 路由。
- `getApiHost() = provider.apiHostOverride() ?? bgn`；3P anthropic/gateway 的
  `apiHostOverride() = creds.baseUrl`。
- 主进程一次性探测（如标题生成）直接 `POST {baseUrl}/v1/messages`，
  headers 含 `anthropic-version: 2023-06-01`。

### 4.5 网关模型发现

`t6t()`：`GET {gateway}/v1/models?limit=1000`（分页 `after_id`，最多若干页，
失败保留已读行）。未实现时用 `inferenceModels` 静态列表（1–200 项，gatewayServable:!1）。
当 `managesProviderRouting` 时强制 `CLAUDE_CODE_MODEL_CATALOG:"0"`（禁 CLI 目录拉取）。

### 4.6 Code helper 启动环境（`bJ()` 全量 env）

```
CLAUDE_CODE_ENTRYPOINT=<surface>
ANTHROPIC_BASE_URL=<apiHost>            ← gateway 时即 inferenceGatewayBaseUrl
ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_CUSTOM_HEADERS = ""（先清空，
                                        再由 ccd-session-secrets 物化注入）
CLAUDE_CODE_OAUTH_TOKEN / _SCOPES / _SUBSCRIPTION_TYPE / _RATE_LIMIT_TIER
CLAUDE_CODE_DESKTOP_APP_VERSION（非 3P 才带）
CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1（托管路由时）+ CLAUDE_CODE_USE_GATEWAY=1
  （helper < NRr 版本则撤销，PRr() 检查）
CLAUDE_CODE_DISABLE_CRON / ENABLE_ASK_USER_QUESTION_TOOL / DISABLE_TERMINAL_TITLE …
ANTHROPIC_CUSTOM_HEADERS 追加 anthropic-client-platform: DESKTOP_APP
```

凭证投递：`writeSessionSecrets` → `ccd-session-secrets` 目录（runExclusive 互斥、
fork superseded 清扫）；按 authScheme 选 env 变量名（bearer→`ANTHROPIC_AUTH_TOKEN`，
x-api-key→`ANTHROPIC_API_KEY`；vertex workforce/helper-script→`ANTHROPIC_CUSTOM_HEADERS`）。
`LRr()` 支持运行中刷新 bearer（refreshHostAuthTokenForSdk）。
3P 下另有 `writeHostCredsFile`（env + `CLAUDE_CODE_HOST_AUTH_ENV_VAR` + 可选
`ANTHROPIC_BASE_URL` 覆盖，带过期时间与 pid）。

### 4.7 Code helper 下载/校验（buildPin 管理）

- 清单（编译进 bundle 的 JSON）：`version "52d82f0a…"`；每平台
  `{binary:"claude.exe.zst", checksum, size[, bundle]}`；win32-x64 ≈ 91,878,666 B 压缩。
- 两份 baseUrl：`https://downloads.claude.ai/claude-code-releases`（helper）与
  `…/claude-ssh-releases`（SSH 侧 helper）；下载按 checksum 校验，
  失败 → 回退已装版本 / 离线安装包内置 / `CLAUDE_CODE_LOCAL_BINARY` 本地覆盖。
- 下载安装目录：`storageDir = OOr()`、`vmStorageDir = userData/claude-code-vm`；
  `installDirFor(platform, version, checksum)`。
- 运行中多版本管理：`hostVersionsInUseThisRun`、marker mismatch 检测、
  exec-kill 失效重查。

### 4.8 终端（pty）子系统

- `ShellPtyManager`（`index.chunk-DIEpbncU.js`）→ `utilityProcess.fork("pty-host/ptyHostWorker.js")`
  + `MessageChannelMain` 端口，带 30s watchdog（无响应 kill refork）。
- worker 内 `node-pty.spawn(file,args,{name,cols,rows,cwd,env})`；
  Windows 默认 `powershell.exe`（`CLAUDE_DESKTOP_*` 环境变量可指定 pwsh.exe），
  spawn 失败自动 `swapToFallback`；退出批量 `taskkill /pid /T /F`。
- SSH 会话：`ssh -t -o EscapeChar=none [-p port] [-i key] -- <nonce-cmd> && exec $SHELL -l`，
  ready nonce 防注入；`claude-ssh-broker/proxy/askpass.exe`（ASAR 外）配合。
- scrollback 独立日志（可 redact）。

### 4.9 Cowork VM 边界

- Cowork 的 shell/文件操作在 hardened Cowork VM；`vmClaudeDir`（`claude-code-vm`）
  供 SSH/远程会话内运行 helper；`cliRunsOnThisHost` 决定 env 是否直传（`Wdr` 过滤 SSH 侧）。
- MITM 代理凭证审批：`NSn()` 仅对 localhost/私有网段的 `ANTHROPIC_BASE_URL` 放行
  `ANTHROPIC_AUTH_TOKEN/API_KEY` 进 VM approved oauth-token 列表。

### 4.10 托管配置读取（Windows）

- Desktop 键：`HKLM/HKCU\SOFTWARE\Policies\Claude`（`SPn()`：任一值存在即 machine policy）。
- Code 会话托管设置：`SOFTWARE\Policies\ClaudeCode`（枚举 registry 值>0 视为有策略）。
- MDM 描述：plist / GPO registry / `/etc/claude-desktop/managed-settings.json`。
- `QUr()`：仅 3P（或 cliRunsOnThisHost）时把 `gWt(managed, {thirdParty}, surface)`
  组成 flagSettings（可含 otel headers helper），经 `--settings` 传给 helper。

### 4.1.1 3P 模式下的本地 API stub 路由（`X$r()` 内 `h` 数组）

custom-3p 下 ion-dist 发出的 `/api/*` 请求由 `app://` handler 本地应答（不触网）：

- `/api/bootstrap`（及 `…/app_start`、`…/system_prompts`、`…/current_user_access`）
- `/api/organizations/<id>/library_submissions(…)`（`sgn` 正则；可被 `plugins.sharingEndpoint` URL 覆盖）
- `/api/organizations/<id>/library/discover/browse`（`cgn` 正则）
- `…/plugins/list-plugins`、`…/dust/command_display_names`、
  `…/dust/generate_session_title`、`…/dust/generate_title_and_branch`
- `/i18n/*`（本地语言包）
- `/v1/code/github/*`（经 gated imports 清单，`office365/github` MCP 侧）

`index.html` 注入 `window.__DESKTOP_3P_PUBLIC_CONFIG__`（如 `userContentRendererUrl.origin`）；
账户设置读改经 `accountSettingsReader` / `gatedImportsManifestReader` 文件桥接。

### 4.11 ion-dist 的物理位置

`ZOa()` = `process.resourcesPath`（打包后），即 MSIX 内
`app\resources\ion-dist\`（本机解包树只有 ASAR 内四类资源——ion-dist 在
`app.asar.unpacked` 之外的 `resources/` 由安装包提供，见 AppxBlockMap；静态清单共 635 模块）。

### 4.12 主进程 ↔ 渲染器的类型化 RPC（59 个命名空间）

`go(uv,"<Namespace>",…,{methods,stores,events})` 注册表（`index.chunk-CHpJbW9_.js`）：
Account、Auth、AutoUpdater、BrowserNavigation、CCDScheduledTasks、ChromeExtension、
**ClaudeCode**、ClaudeVM、CliSessionImport、CloudMove、ComputerUse*、Cowork*、
CustomPlugins、DeepLink、DesktopNotifications、DeviceRegistry/Storage、Dictation、
FileSystem、FindInPageProvider、GitState、Launch、LocalPlugins、**LocalSessions**、
LocalSessionEnvironment/Presets、ManagedConfig、Navigation、OsOpenHandlers、
PluginBridgeMcp、QuickEntry、RemoteControlServing、Resources、SessionPopouts、
Toast、WebBuild、WindowControl/Layout/State 等 59 个。

Code 标签页相关的两个关键面：
- `ClaudeCode`：getStatus / prepare / checkGitAvailable / resolveLocalSettings /
  patchUserSettings / setEnableWorkflows / getPeriodUsage / sandbox 三方法。
- `LocalSessions`：start / forkSession / detachFromParent / sendMessage（含 images、
  attachments、steeringGates、paneHolds…）/ setModel / setEffort / setFastMode /
  applyFlagSettings / createOutputStyle / toggleRemoteControl / shareSession …
  （即 Code 标签页 UI 的完整会话操作面）。

### 4.13 更新器（Windows）

- 安装检测：`kfe()` → `"msix"`（`process.execPath` 含 `windowsapps`，`jfe()`）或
  `"squirrel"`；MSIX 包用户代理附加 `MSIX`。
- 更新 feed 端点（egress 计算表）：
  - 默认：`{anthropicHost}/api/desktop/…/update`（renderer origin）+
    `api.anthropic.com/api/desktop/…/update`；
  - `updateViaUpdatesHost=true` 时改走 `releases.claude.com/api/desktop/…/update`（main origin）；
  - 二进制更新：`downloads.claude.ai/releases/`（followRedirects）。
- 阻断条件（诊断串）：`disableAutoUpdates=true`、`dangerousMaxVersion`（3P 公开但未记档键）、
  `not packaged`、`no squirrel/MSIX updater`。
- 72 小时重启强制（`autoUpdaterEnforcementHours` 可调 1–72，设了变严格不再等空闲）。

### 4.14 Chrome 扩展桥

`wss://bridge.claudeusercontent.com`（staging: bridge-staging），feature flag
`chromeExtensionEnabled`（org 348738776 控制，`admin_off` 可关）；
3P 下 `shouldEnableSessionsBridge()=false`、`usesHostedChromeBridge()=false`
（custom-3p 不用 hosted 桥）。

### 4.15 ion-dist（3P 本地 web 应用，MSIX 内 `app/resources/ion-dist/`）

- `index.html`：`data-build-id="spa-dev"`，SPA 与 claude.ai 同构（vendor-frame / shared-* 分块）。
- `custom-3p-gated-imports.json`：`{buildId:"spa-dev", imports:{}}`（本版本无放行的额外 import）。
- Code 标签页 UI 块（静态字符串证据）：`c01b6d4ec-…`（侧栏 codeSession→"Code" 图标映射）、
  `c0a41a7b3-…`（code/cowork/cloudTask 可达性路由）、`c16f7df8c-…`（36KB 会话模块）。
- SPA 与主进程通信走 4.12 的 RPC（由 ion-dist 的 shared 帧实现，未见 ipcRenderer 直用）。

### 4.16 配置源层级与 SettingsResolver

SDK 设置层级 `s_`：`user < project < projectLocal < managed`；
Desktop 的 `lPn()` 把 SDK sources 映射到 CCD 层级（`cPn` 表），未识别的 source 直接忽略并告警
（`[SettingsResolver] Ignoring SDK settings source … CCD does not project this tier`）。
远程托管设置（Enterprise Admin Console）经 `index.chunk-CFaQ2YHb.js` 的
`loadRemoteManagedSettings()` 拉取；`VM()` 从 sources 里找 `source==="managed"`。

Bootstrap 服务器（3P 第三种配置分发模式）：
- `bootstrapUrl`（`activatesThirdPartyMode`——设了且未禁用即激活 3P）；
  `bootstrap.enabled` 默认 `true`；远程策略 `remote-disabled`（MDM 可禁用 bootstrap 路径）。
- 轮询：`CLAUDE_E2E_BOOTSTRAP_POLL_MS` 覆盖，默认 分钟×60e3，带 ±10% 抖动；
  失败退避 30s→15min 指数 + 0.75–1.25 抖动。
- `Vl(url)` 校验 bootstrap host：仅接受 `api.anthropic.com` 系或与 `Bze()`
  （当前 apiHost）同 host——即 bootstrap 端点必须与推理端点同源。
- org 级桌面接口：`{apiHost}/v1/desktop/orgs/{org}/{…}`（`Vze()`）。

### 4.17 其余关键 RPC 面（补充 4.12）

- `ClaudeVM`（Cowork VM 生命周期）：download / startVM / restartVM /
  getDownloadStatus / getRunningStatus / checkVirtualMachinePlatform /
  enableVirtualMachinePlatform / restartAfterVMPInstall / setForceDisableHostLoop /
  setYukonSilverConfig；stores: apiReachability, hostIPv6Notice。
- `RemoteControlServing`：requestEnable/disable、folder pin/worktree、
  disconnectCloudSession、requestServeSessionFolder/GrantedFolder。
- `Auth`：doAuthInBrowser / prepareForSignedIn。

### 4.18 Code 标签页会话 = 内嵌 Claude Agent SDK 0.3.295（`index.chunk-C4qJSrNf.js`）

Desktop 的 Code/Cowork 会话不是裸起 CLI 交互终端，而是把 **Claude Agent SDK**
（version `0.3.295`，与 helper buildPin 的 `sdkWrapperVersion:"0.3.295"` 对齐、
`sdkCompat.testedWrapperVersions` 0.3.252–0.3.285 兼容表）编译进主进程，
由 SDK 把 `query()` 选项翻译成 helper CLI 参数：

```
--output-format stream-json --verbose --input-format stream-json
--thinking adaptive|disabled [--max-thinking-tokens N] [--thinking-display …]
--effort <e> --max-turns N --max-budget-usd --task-budget <tokens>
--model <id> [--fallback-model] [--agent] [--betas csv] [--json-schema …]
--debug / --debug-file / --permission-prompt-tool stdio|<tool> [--permission-prompts …]
--continue | --resume <id> [--channels …] [--fork-session] [--resume-session-at …]
[--session-id] [--add-dir …]* [--plugin-dir[-no-mcp] …] [--await-initialize]
--allowedTools csv --disallowedTools csv [--tools default|csv]
--mcp-config {json} [--strict-mcp-config] [--setting-sources csv]
--permission-mode <m> [--allow-dangerously-skip-permissions]
--include-hook-events / --include-partial-messages / --session-mirror
--project-config-root / --max-budget-usd …
```

即：Code 标签页 UI（LocalSessions.sendMessage/steeringGates/paneHolds…）→
Agent SDK 选项 → 上述参数 → helper `claude.exe`（stream-json 双向管道）。
`CLAUDE_CODE_HOST_AUTH_ENV_VAR` + `ANTHROPIC_BASE_URL` env 同 4.6。

### 4.19 SDK ↔ helper 的 stream-json 控制协议（59 个 subtype）

消息帧：`{type:"system", subtype:"…", session_id, …}`；MCP over SDK 走标准
`initialize`/`notifications/initialized`/`ping` 握手（JSON-RPC 形）。控制子类型全集
（静态字符串证据）：

`apply_flag_settings、background_tasks、cancel_async_message、channel_enable、
claim_session、claude_authenticate、claude_oauth_callback、
claude_oauth_wait_for_completion、error、export_conversation、generate_session_title、
get_chrome_browsers/dialog、get_context_usage、get_hooks_listing、get_memory_dialog、
get_plan、get_sandbox_dialog、get_settings、get_skills_dialog、get_status、
get_task_output、get_usage、initialize、interrupt、list_permission_rules、
mcp_authenticate、mcp_clear_auth、mcp_message、mcp_oauth_callback_url、
mcp_read_resource、mcp_reconnect、mcp_set_servers、mcp_status、mcp_toggle、
message_rated、mirror_error、read_file、reload_output_styles、reload_plugins、
reload_skills、remote_control、rename_session、rewind_files、seed_read_state、
select_chrome_browser、set_chrome_browser_hints、set_cwd、set_max_thinking_tokens、
set_mcp_permission_mode_override、set_model、set_permission_mode、
set_prompt_suggestions_paused、side_question、stop_task、submit_feedback、
success、ultrareview_launch、update_settings`

（与 4.12 的 `ClaudeCode`/`LocalSessions` RPC 一一对应：UI 按钮 → RPC → SDK 控制帧 → helper。）
双向能力按需启用：SDK 内建 MCP servers / hooks / canUseTool / onElicitation 时
才开 stdin 控制流（`hasBidirectionalNeeds()`）。

### 4.20 内嵌 SDK 的环境变量面（静态字符串统计）

`index.chunk-C4qJSrNf.js` 内出现 `CLAUDE_CODE_*` 变量 **629 个**（含 feature-flag），
按前缀聚类：DISABLE×75（含 DISABLE_NONESSENTIAL_TRAFFIC 等）、ARTIFACT×37、
ENABLE×23、SKIP×16、REMOTE×14、SYNC×12、FORCE×11、HOST×11、MAX×11、
PLUGIN×10、RESUME×10、USE×10、BRIDGE×9、MCP×9、SESSION×8、OTEL×5、
OAUTH×6、SUBAGENT×6、3P×5 …。Desktop 只把 `GJe` 白名单里的十余个
（4.6 `bJ()` 表 + `PATH`/`CLAUDE_CODE_ENTRYPOINT`/PROCESS_WRAPPER 等）注入会话；
其余变量属 CLI 自身运行时开关，不在 Desktop 注入路径上。

### 4.21 helper/VM 的安装目录与离线 preseed 机制

- 目录命名：`installDirFor(target, version, checksum)`：
  host → `{storageDir}/{version}/{checksum[:12]}`（`MOr/jOr`，校验和必须是 64 位 sha256，
  取前 12 位十六进制命名安装夹）；vm → `{vmStorageDir}/{version}`。
- preseed（离线安装包）：`BG() = process.resourcesPath/preseed`；
  `{preseed}/vm_bundle/{r}.zst`（VM bundle 缓存）与 `{preseed}/claude-code/{platform}/{name}`
  （helper 二进制，`mkr/ukr="claude-code"`）。`ykr()` 把包内 `.zst` 暂存为缓存
  （`.{r}.zst.origin` 记录来源，避免重复暂存）；`vkr()` 启动时检查包内路径，
  命中即用包内二进制（`getHostPreseedInPlacePath`）。
- **本机这份 MSIX 无 `preseed/` 目录 → 是在线版**；离线版（`/offline/latest/redirect`）
  的 MSIX 内含 `preseed/claude-code/…` + `preseed/vm_bundle/…`，即官方文档所述
  "两组件打进安装包、checksum 编译进应用"的落点。
- 安装检测：`Yr()` = `process.windowsStore` 或 execPath 含 `windowsapps`（`jfe()`）→
  `kfe()` 返回 `"msix"`（否则 `"squirrel"`）；MSIX 下 UA 附加 `MSIX`。

### 4.22 执行目标矩阵与表面(Surface)隔离

在 `index.chunk-CHpJbW9_.js` 中取证到全局执行矩阵 `vze` 与约束表 `bze`：

```js
vze = {
  code:           { device: true, sshHost: true, cloud: ["anthropic", "self-hosted"] },
  codeRoutines:   { device: true,                cloud: ["anthropic", "self-hosted"] },
  cowork:         { device: true,                cloud: ["anthropic", "self-hosted"] },
  coworkRoutines: { device: true,                cloud: ["anthropic", "self-hosted"] },
  chat:           { device: true }
}
```

- **表面分流**：
  - `code`（Code 标签页）：在本地通过 `[HostLoop]`（宿主进程循环）直接运行于 Windows 宿主环境；支持切换至远程 `sshHost`。
  - `cowork`（Cowork 智能体）：强制在本地 Cowork VM（基于 Hyper-V / VirtualMachinePlatform 的轻量虚拟沙箱）中运行，经 MITM 代理白名单审批网络与凭据。
- **策略阻断条件**（`bze`）：
  - `disableDesktopLocalSessions`：当 `codeLocalPolicy() === "disabled"` 时，直接拒绝在 `device`（宿主）上启动 Code 会话。
  - `managed-settings-unreadable`：托管策略解析损坏时，拒绝宿主启动。
  - `self-hosted-only`：强制所有表面只能路由至自建云基础设施。

### 4.23 宿主循环 HostLoop 与生命周期管理（`index.chunk-YBFVQBQ_.js`）

Code 会话在宿主上通过 `HostLoop` 管理：
1. **启动与命令包装**：调用 `Se.binaryPath`（已安装或下载的 `claude.exe`），通过 `t.o0` 拆解为 `Ce.cmd` + `Ce.args`，并挂载 `spawnClaudeCodeProcess = ue`。
2. **进程组控制与强杀**：
   - Windows 下记录 PID，应用退出时若子进程未正常退出，先发 `SIGTERM`，超时 `5000ms` 后使用 `taskkill /pid <PID> /T /F` 强制树状终止，避免孤儿 CLI 滞留后台。
3. **敏感凭据文件描述符隔离**：尝试将 OAuth token / API key 写入临时文件并打开只读 FD，随后立即从磁盘 unlink 删除原文件（`Failed to stage OAuth token fd; falling back to env`）。
4. **工作目录与保护挂载**：自动探测并初始化 `.claude/projects/` 项目记忆与缓存目录。

### 4.24 双向控制流 Control Request 与运行时凭据无缝刷新

内嵌 Claude Agent SDK 与 `claude.exe` helper 之间通过 `stream-json` 维护强类型双向控制通道。取证到完整的 `control_request` 子类型集：

- `host_auth_token_refresh`：**关键内网特性**。当 CLI helper 在长任务中遭遇 API 401/403 或网关 Token 过期时，不退出会话，而是向父进程 Desktop 发送 `control_request`；Desktop 调用 `refreshHostAuthTokenForSdk()` 触发后台刷新并返回新 Token，CLI 收到后立即在内存中切换凭据重试。
- `can_use_tool`：当 CLI 需要执行 Bash、文件写入或 MCP 工具且处于交互许可模式时，向 Desktop 发起工具权限请求，Desktop 渲染原生确认卡片并回传用户决策。
- `elicitation`：用户提问与表单参数交互。
- `mcp_message`：MCP 协议双向中继。
- `ui_copy` / `ui_prompt_fill` / `ui_prompt_read` / `ui_prompt_suggest`：桌面端输入框与剪贴板的深层集成。

### 4.25 内置 MCP 服务生态（Desktop ↔ Code 协同控制面）

桌面端的主进程向 Code helper 进程注入了一整套内置 MCP 服务器（每个具备固定 UUID），这些工具构成了 Desktop 界面与 Agent 的直接控制接口：

| MCP 服务器 | 核心工具 (Tools) | 业务职责 |
|---|---|---|
| `ccd_view` | `show_pane`, `close_pane`, `get_layout`, `set_transcript_view` | 控制侧边面板（diff, file, terminal, pr, tasks, plan, artifact）与查看模式 |
| `ccd_window` | `open_session_in`, `close_split`, `get_window_layout`, `set_sidebar_collapsed` | 桌面分屏、独立弹窗、侧边栏折叠展开 |
| `ccd_directory` | `change_directory`, `request_directory` | 动态切换会话工作目录、申请额外访问目录授权 |
| `ccd_session` | `spawn_task`, `dismiss_task`, `mark_chapter`, `read_widget_context` | 建议卡片、大纲章节标记、交互小部件上下文 |
| `ccd_session_mgmt` | `list_sessions`, `get_session`, `list_events`, `search_session_transcripts`, `send_message`, `stop_session`, `archive_session`, `delete_session` 等 19 个 | 多会话管理、跨会话发消息、会话搜索与导出 |
| `ccd_sidebar` | `list_groups`, `create_group`, `move_sessions`, `set_pinned`, `set_view` | 侧边栏自定义分组、Pin、筛选与排序视图 |
| `ccd_settings` | `get_settings`, `set_setting` | 读写 Code 标签页偏好设置（如 auto-archive 等） |
| `ccd_host` | `get_storage_usage`, `clean_up_worktrees`, `discard_kept_worktree`, `sync_with_base_branch`, `open_in_editor`, `reveal_path`, `request_keep_awake` | 存储分析、工作树清理、Base分支合并、系统编辑器联动、防止休眠 |
| `ccd_pr` | `get_status`, `bind_pr`, `unbind_pr`, `set_monitor`, `set_auto_merge` | PR 状态感知、CI 监控与自动合并 |
| `terminal` | `list_terminal_tabs`, `open_terminal_tab`, `run_in_terminal`, `read_terminal`, `stop_terminal_tab` | 桌面内置终端标签页交互与输出读取 |
| `scheduled-tasks` | `list_scheduled_tasks`, `create_scheduled_task`, `update_scheduled_task`, `run_scheduled_task` | 自动化例行任务（Routines）调度与执行 |
| `Claude Browser` | `preview_click`, `preview_fill`, `preview_snapshot`, `preview_network` 等 | 浏览器沙箱预览与页面交互自动化 |

### 4.26 Rust 原生扩展层（`@ant/claude-native`）深度逆向

位于 `app.asar.unpacked/node_modules/@ant/claude-native/claude-native-binding.node`，基于 NAPI-RS 编写，向 Electron 导出 100+ 个底层 Windows API：

1. **Computer Use (屏幕自动化)**：
   - 捕捉与几何：`cuListDisplays`, `cuDisplayForPid`, `cuListOpenWindows`, `cuMaskedWindowRects`, `cuExcludedWindowRects`
   - 控制注入：`moveMouse`, `mouseButton`, `mouseScroll`, `typeText`, `typeTextPaced`
   - 进程与图标：`cuGetAppIcon`, `cuListInstalledApps`, `cuFocusedControl`, `cuAppUnderPoint`
2. **内核级路径逃逸防护（Directory Traversal Defense）**：
   - 导出 `*Beneath` 族函数：`openBeneath`, `statBeneath`, `mkdirBeneath`, `renameBeneath`, `rmdirBeneath`, `unlinkBeneath`, `openRootDir`。
   - 确保文件系统工具只能在允许的根目录下递归操作，在 Windows NT 句柄/内核级切断 `..\..\` 符号链接及路径跳跃逃逸。
3. **系统凭据与硬件证明（Windows Security & TPM）**：
   - 本地加密：`userDpapiProtect` / `userDpapiUnprotect`（调用 Windows DPAPI 保护本地持久化会话秘密）。
   - 生物识别：`promptWindowsHello`, `cancelWindowsHello`, `windowsHelloAvailability`。
   - TPM 硬件证明：`hardwareKeyGetOrCreate`, `hardwareKeySign`（基于 Windows CNG / Platform Crypto Provider 生成并签署客户端硬件密钥）。
4. **作业对象容器（Job Object Isolation）**：
   - `joinAppJob`, `isProcessInAppJob`：将所有 CLI helper 及其派生子进程强绑定进同一个 Windows Job Object，父进程崩溃或退出时由 Windows 内核一次性连带回收。
5. **系统虚拟化状态控制（Hyper-V / HCS）**：
   - `getHcsStatus`, `enableWindowsOptionalFeature`：底层直连 Host Compute System，无需调用外部 powershell 即可查询和启用 Windows 容器虚拟化。
6. **无子进程注册表读写**：
   - `readRegistryValues`, `writeRegistryValue`, `writeRegistryDword`, `deleteRegistryKey`，原生 Win32 API 读写策略，规避外部 `reg.exe` 触发的安全监控拦截。

### 4.27 内置外挂 MCP 服务与技能包

- **GitHub MCP 独立服务**：`resources/github-mcp/github-mcp-server.exe`（20MB 原生二进制，独立作为 Stdio MCP Server 运行）。
- **Office 365 / Microsoft Graph MCP**：`resources/office365-mcp/` 内含 `office365-mcp-stdio.mjs`（7.0MB）、`msalruntime.dll`、`msal-node-runtime.node`，通过微软官方身份库直连企业 Microsoft Graph。
- **内置预打包技能（Bundled Skills）**：`resources/bundled-skills/`：
  - `docx.skill` (160KB)、`pptx.skill` (169KB)、`xlsx.skill` (153KB)、`pdf.skill` (22KB)、`pdf-reading.skill` (7.9KB)、`frontend-design.skill` (8KB)
  - `manifest.json` 声明全部属于 `tier: "always"`，装机即具备办公文档生成与多模态解析能力。

### 4.28 敏感文件黑名单与数据防泄漏 (DLP) 机制

在 `index.chunk-CHpJbW9_.js:3069000` 取证到了完整的敏感文件拦截系统：
- **静态拦截名录**（函数 `FFn` / 数组 `wFn`, `TFn`, `EFn`）：
  - **私钥与证书**：`.pem`, `.key`, `.p12`, `.pfx`, `.keychain`, `.keychain-db`, `.kdbx`, `.ppk`, `.jks`, `.p8`, `.ovpn`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`。
  - **密码与浏览器隐私**：`cookies`, `cookies.sqlite`, `login data`, `logins.json`, `web data`, `local state`, `key4.db`, `cert9.db`, `signons.sqlite`。
  - **云服务与包管理器凭证**：`.aws/credentials`, `application_default_credentials.json`, `credentials.db`, `msal_token_cache.json`, `.netrc`, `.git-credentials`, `.npmrc`, `.pypirc`, `.pgpass`, `.my.cnf`, `.databrickscfg`, `.vault-token`, `wallet.dat`, `kubeconfig`。
  - **环境配置**：所有以 `.env` 开头或结尾的文件。
- **高级绕过防御算法 (`AFn` / `PFn`)**：
  - 自动解包剥离点文件伪装前缀（如将 `dot_env` 还原为 `.env`，剥离 `encrypted_`, `private_`, `literal_`, `create_` 等前缀）。
  - 剥离 `.tmpl`、`.literal` 等模板后缀后再做敏感性判定。
  - **Windows 专用防护**：阻断 NTFS 备用数据流（ADS, Alternate Data Streams，检测包含 `:` 的路径）和 macOS `..namedfork` 穿透。
  - **触发动作**：在 Agent 文件读取及文件预览启动时做拦截，上报 `desktop_launch_preview_file_access_prompt`，对高危文件直接判为 `decision: "admin_policy_deny"`。

### 4.29 本地凭据双层加密存储体系 (DPAPI & safeStorage)

- **跨 Profile 交换凭据**：通过原生模块 `@ant/claude-native` 的 `userDpapiProtect` / `userDpapiUnprotect` 进行保护，密文附加前缀 `anthropic.claude.crossProfileSecret.v1:`，利用当前 Windows 用户的登录凭据进行加解密。
- **持久化配置加密存储 (`ex` / `tx` 类, 偏移 2113813)**：
  - 基于 Electron 的 `safeStorage`（在 Windows 上底层基于 DPAPI），封装函数 `lGt(e)`（加密输出 base64）和 `uGt(e)`（输入 base64 解密）。
  - 加密覆盖范围：网关 SSO Token、MSAL 微软身份缓存（`msal-cache-v1:`）、Bedrock SSO Token（`rT`）、GitHub 插件 Token、自建 MCP 授权凭据。
  - **故障降级与安全策略**：若 `safeStorage.isEncryptionAvailable()` 为 `false`，代码会抛出 `SafeStorageUnavailableError` 或警告 `safeStorage unavailable; not persisted (process-memory only)`，**绝不允许将未加密的鉴权信息写入持久化磁盘**。

### 4.30 Cowork 虚拟机沙箱架构与生命周期 (`startVM`)

在 `index.chunk-CHpJbW9_.js:4294000` 取证到了轻量虚拟化环境的完整底层细节：
- **虚拟化内核**：Cowork VM 内部采用 **gVisor** 容器内核，启动命令调用 `g.startVM(i, _, v, "gvisor", ...)`。
- **Windows 虚拟化接口 (HCS)**：
  - Windows 环境通过微软 Host Compute System (HCS) 管理轻量 VM。
  - 原生调用 `Ci()?.getHcsStatus()` 检测缺失的 Windows 虚拟机功能，异常时捕获 HCS 错误码并提示开启 `VirtualMachinePlatform`。
- **镜像差量热更新 (`applyVmImageDelta`)**：
  - 虚拟机镜像包 `claudevm.bundle` 存放在 `userData/vm_bundles/`。
  - 原生代码支持 `applyVmImageDelta`：当本地存在旧版 VM 基础镜像时，仅下载差量 patch 并在本地应用合成，大幅降低网络流量消耗。
- **MITM 凭据拦截网 (`NSn`)**：
  - 宿主与虚拟机内部的通信通过内部代理拦截，宿主明确只对同源或私有地址放行凭证注入，防止凭证从虚拟机内部逃逸到公网。

### 4.31 数据保留周期与合规审计冻结 (Retention & Legal Hold)

在配置 Schema 中发现了企业级数据生命周期管理：
- `codeSessionRetentionDays`：Code 标签页会话的本地保留天数（默认 90 天）。
- `coworkSessionRetentionDays`：Cowork 智能体任务会话的本地保留天数（默认 90 天）。
- `sessionRetentionHold: true`（司法冻结 / 审计保护）：开启后 `failClosedValue: true`，全局暂停并阻断所有后台清理和过期丢弃任务，确保会话数据完全固化用于离线审计。

### 4.32 CLI Helper 底层封装解密：基于 Bun Compile 的单一原生二进制

对本机实际落盘的 217MB `claude.exe`（位于 `%APPDATA%\Claude\claude-code\2.1.260\claude.exe`）进行 PE 头部与段表（Section Table）逆向分析证实：

```text
Machine: 0x8664 (x64), Sections: 13, OptionalHeader Magic: 0x20b (PE32+)
  .text      raw_size=66,724,864   virt_size=66,724,766   (原生机器码)
  .rdata     raw_size=20,957,184   virt_size=20,956,840   (只读常量与运行时符号)
  .data      raw_size=117,248      virt_size=2,325,504
  .pdata     raw_size=935,936      virt_size=935,628
  .bunblt    raw_size=2,618,880    virt_size=2,618,826    (Bun 内建加载器)
  .fptable / .tls / _RDATA / __DATA,* / .rsrc / .reloc
  .bun       raw_size=125,942,784  virt_size=125,942,674  (Bun 编译打包资产段)
```

- **底层打包机制**：`claude.exe` 并非传统的使用 pkg 或 Node.js SEA (Single Executable Application) 打包，而是**通过 `bun build --compile` 直接将整个 Claude Code CLI 工具集与 JavaScript 模块深度编译为单一二进制文件**。
- **签名证据**：在偏移 `0x5790a00` 处的 `.bun` 段末尾，精准抓取到了 **`---- Bun! ----`** 标志性尾随签名。该段占据了高达 125.9MB 的空间，封装了 CLI 运行所需的全部脚本逻辑、依赖库及嵌入式资产。
- **四层物理隔离体系**：
  ```text
  [Layer 1: 本地视图层]  app://localhost (React SPA，预编译在 resources/ion-dist/)
         │ (通过 59 个强类型 RPC 命名空间通信)
  [Layer 2: 桌面调度层]  Electron 主进程 (node.exe 宿主，执行 app.asar 业务调度)
         │ (通过 stdio 管道交换双向 stream-json 协议，包含 59 个控制子类型)
  [Layer 3: 智能体引擎]  独立的 217MB claude.exe (Bun 编译的原生二进制，运行于宿主)
         │ (当处于 Cowork 智能体模式时，向下一层下沉)
  [Layer 4: 容器隔离层]  Cowork VM (Hyper-V / gVisor 微虚拟机，走本地 MITM 白名单代理)
  ```

## 5. 覆盖与未定项（REA limitation 摘要）

- 语义图 partial：81580 个语义 unknown、437 应用图 unknown；`index.chunk-CHpJbW9_.js`
  语义预算超限，仅保留静态/模块事实。
- 6 个 unpacked 原生二进制与 ASAR 声明校验和不一致（标记 observed-untrusted，
  常见于打包后再签名；不代表被篡改的结论）。
- 635 个模块中 7 个选中深析，其余 436 个仅清单级覆盖。
- 所有结论均为静态语法观察：IPC 动态通道、运行时注册、执行顺序未验证。

## 6. 核心模块源码美化与反混淆落地文件 (TypeScript)

已将主进程与 SDK 核心逻辑反混淆、变量重命名、补充强类型及业务注释，固化于 `rea-reports/deobfuscated/` 目录下：

1. **[DlpSecurityFilter.ts](deobfuscated/DlpSecurityFilter.ts)** (7.8KB)
   - 还原 `PFn`, `FFn`, `AFn`, `DFn`, `bE`。
   - 包含 Unicode NFKC 规范化、尾随空白/点剥离、dotfile 解混淆、NTFS ADS 备用数据流阻断、以及完整敏感文件名/路径序列黑名单。
2. **[ThirdPartyMockRouter.ts](deobfuscated/ThirdPartyMockRouter.ts)** (7.4KB)
   - 还原 `Z$r`, `X$r`, `U$r`。
   - 包含 `app://localhost` 协议安装、`window.__DESKTOP_3P_PUBLIC_CONFIG__` 动态 HTML 注入、以及 3P 纯内网模式对 `/api/bootstrap`、`/i18n`、`/library` 的本地拦截 Mock 路由表。
3. **[SessionEnvironmentBuilder.ts](deobfuscated/SessionEnvironmentBuilder.ts)** (5.2KB)
   - 还原 `bJ` 环境组装器与 `anthropicWire()` 网关连接上下文。
   - 包含 `ANTHROPIC_BASE_URL` 网关注入、API Key 清空脱敏、`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 托管标记、以及标准 `/v1/messages` 请求头构建。
4. **[AgentSdkControlProtocol.ts](deobfuscated/AgentSdkControlProtocol.ts)** (7.2KB)
   - 还原 `handleControlRequest`、`processControlRequest` 及双向 `stream-json` 管道调度。
   - 包含 `can_use_tool` 权限卡片审批调度、`host_auth_token_refresh` 运行时无感 Token 动态刷新通道。



## 7. 前端架构与界面设计细节深度剖析

基于 `resources/ion-dist/`（约 78MB 本地 Web 应用产物）与 `.vite/renderer/main_window/`（主窗口渲染外壳）的全面反混淆与逆向解构：

### 7.1 双容器前端渲染拓扑 (Dual-Container Architecture)

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ Electron 主窗口外壳 (.vite/renderer/main_window/)                              │
│                                                                                │
│  ├─ 原生窗口边框控制: -webkit-app-region: drag (窗口拖拽区)                     │
│  ├─ 标题栏 (TitleBar): MainWindowPage-Dg0RuIiZ.js (暗色/亮色自适应标题栏)       │
│  ├─ 骨架屏占位器: index.html (行间注入 SVG 骨架形状，首帧即刻绘制避免白屏)      │
│  │                                                                            │
│  └─ 核心内容视图容器 (WebContentsView / iframe)                               │
│      │                                                                        │
│      ▼                                                                        │
│ ┌──────────────────────────────────────────────────────────────────────────┐  │
│ │ 核心 Web 应用 (resources/ion-dist/ -> app://localhost)                   │  │
│ │                                                                          │  │
│ │ ├─ 状态中枢: Zustand (响应式 Store) + TanStack Query (服务端状态缓存)     │  │
│ │ ├─ 编辑系统: TipTap + ProseMirror (富文本提示词输入框)                   │  │
│ │ ├─ 代码/Diff: Monaco Editor + Shiki (Web Worker 离线语法高亮)            │  │
│ │ ├─ 动画引擎: Framer Motion (弹窗、抽屉折叠与微交互)                      │  │
│ │ └─ 渲染引擎: Tailwind CSS + Claude Design System (1045 个 --cds-* 令牌)     │  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

1. **首屏渲染零白屏技术（Boot Placeholder）**：
   在 `main_window/index.html` 头部，直接使用微秒级原生 JS 在 `document.documentElement` 执行形状绘制（`paintShapes`），计算屏幕 DPI 缩放并绘制侧边栏与骨架屏轮廓，完全绕过了 React 初始化和 CSS 加载时间。
2. **多窗口分流机制**：
   除了 `main_window`，前端拆分了独立的轻量级渲染窗口：
   - `find_in_page`: 页面内查找栏（独立 `WebContentsView` 悬浮子视图，预加载 `findInPage.js`）。
   - `local_exec_consent`: 危险命令或工具执行时的系统原生级确认弹窗。
   - `quick_window`: 快捷唤起悬浮窗（类似 Spotlight）。
   - `about_window` / `buddy_window`。

### 7.2 状态管理与数据流架构

在 `resources/ion-dist/assets/v1/vendor-*.js` 依赖块中提取出核心状态体系：
1. **客户端全局状态：Zustand (`vendor-all-0-GGdiWMtM.js`)**
   - 采用原子 Store 模式（`getState()`, `subscribe()`, `useStore()`），负责侧边栏伸缩、活动侧边窗格（`diff` / `file` / `terminal` / `tasks` / `plan`）、输入框草稿以及会话布局记忆。
2. **服务端异步状态与流式缓存：TanStack React Query (`vendor-query-D2BgdJkH.js`)**
   - 负责历史会话列表分页、项目文件索引、知识库与动态设置的缓存及自动失效重拉。
3. **可达性与表面决议器（Reachability Reducer，`c0a41a7b3-DnAy6YSK.js`）**：
   ```typescript
   function useReachability() {
     return {
       reach: {
         code: isCodeAllowed,           // 是否允许进入 Code 标签页
         cowork: isCoworkAllowed,       // 是否启用 Cowork 虚拟机沙箱
         cloudTaskViaHub: isCloudActive // 是否允许将任务分发至云端
       },
       codeSettled: isCodeSettled,
       codeSessionRoute: activeSessionRoute
     };
   }
   ```

### 7.3 Claude Design System (CDS) 视觉设计体系深度解析

在 `MainWindowPage-BD9CWQ83.css`（239KB）与核心全局样式表 `c6a992d55-CNGsCU46.css`（1.72MB）中，反编译提取出了完整的 **Claude Design System (CDS)** 工业级工程实现：

#### 7.3.1 1045 个 `--cds-*` 深度语义设计令牌全景分类

CDS 摒弃了硬编码 HEX/RGB，全量采用层次分明的语义令牌网络：

| 命名空间 (Prefix) | 令牌数量 | 典型令牌与职责 | 设计体系解析 |
|---|---|---|---|
| **`--cds-font-*`** | 63 个 | `--cds-font-sans`, `--cds-font-mono`, `--cds-font-axis-wght`, `--cds-font-grad` | 可变字体多轴联动控制器，统管全局字阶、字重与级差补偿 |
| **`--cds-bg-*`** / **`--cds-fill-*`** | 102 个 | `--cds-bg-accent`, `--cds-fill-brand-hover`, `--cds-fill-git-added` | 背景填充与按压/悬浮态状态色，配合 `--cds-fill-brand` 表达主品牌质感 |
| **色彩梯度矩阵**<br>(10 大核心色相) | 各 35 个<br>(共 350 个) | `aqua`, `blue`, `gray`, `green`, `magenta`, `neutral`, `orange`, `red`, `violet`, `yellow` | 每个色相提供从 `0` 到 `650` 的 35 档极细色标 (0, 10, 20...550, 600, 650)，支撑精密对比度计算 |
| **Anthropic 专属特征色** | 10 个 | `--cds-clay`, `--cds-cactus`, `--cds-heather`, `--cds-mineral`, `--cds-plum` | 赋予暖色调纸张感与自然矿物感的人文主义色彩标记 |
| **`--cds-surface-*`** | 6 个 | `--cds-surface-0` (纯底), `--cds-surface-1` (基底背景), `--cds-surface-2` (气泡卡片), `--cds-surface-3` (浮层菜单) | 构筑基于海拔高度 (Elevation) 的物理表面系统 |
| **`--cds-text-*`** | 27 个 | `--cds-text-primary`, `--cds-text-secondary`, `--cds-text-muted`, `--cds-text-git-*` | 排版文本色与 Git 状态语义色（added, removed, modified, merged, conflicting, draft） |
| **`--cds-alpha-*`** | 10 个 | `--cds-alpha-0` 到 `--cds-alpha-9` | 无级不透明度遮罩通道，控制毛玻璃 (Backdrop Blur) 与微发光高亮 |
| **物理动力学 (Motion)** | 19 个 | `--cds-dur-base/fast/sheet/slow`, `--cds-ease-out/overshoot/snap`, `--cds-btn-spring` | 弹簧阻尼与物理动效曲线（超调回弹 overshoot、瞬态捕捉 snap） |
| **控件度量与间距** | 80+ 个 | `--cds-pad-*`, `--cds-gap-*`, `--cds-radius-*`, `--cds-h-control-*`, `--cds-panel-*` | 严格基于 4px/8px 网格的紧凑度量标准 |

#### 7.3.2 原生自适应系统明暗色与光学光晕补偿 (Dark/Light System)

桌面端通过 Electron 的 `nativeTheme.themeSource` 与 `nativeTheme.shouldUseDarkColors` 直连 Windows OS 主题，向 HTML 注入 `<html class="cds-root" data-mode="system">`，并在 CSS 构筑了三重自适应机制：

```
[操作系统偏好: Windows 暗色模式]
       │ 监听 WM_SETTINGCHANGE / Electron nativeTheme
       ▼
<html class="cds-root" data-mode="system">
       │
       ├─ (1) 纯纯浅色硬选: .cds-root[data-mode=light] ─→ 浅色米白高对比令牌
       ├─ (2) 纯纯深色硬选: .cds-root[data-mode=dark]  ─→ 深色极夜高对比令牌
       └─ (3) 系统自适应:   @media (prefers-color-scheme: dark) {
                              :where([data-mode=system] .cds-root) {
                                重新映射全部语义令牌 (零 JS 开销，微秒级瞬时同步)
                              }
                            }
```

1. **差异化非反转重映射 (Semantic Remapping)**：
   绝不使用暴力的 CSS `filter: invert()`，而是为暗色模式精准调配色彩。例如 Git 状态色：
   - 浅色模式：`--cds-text-git-added: #1e9e3c`（深绿保可读性），`--cds-text-git-removed: #cd2054`。
   - 深色模式：`--cds-text-git-added: #32d74b`（荧光亮绿穿透黑底），`--cds-text-git-removed: #ff2c56`。
2. **字体光学膨胀补偿机制（The GRADE Compensator）**：
   在黑色背景上显示白色文本时，人眼会因**光渗效应 (Halation / Irradiation Effect)** 觉得白字比黑字显得更粗、膨胀且刺眼。如果简单降低 `font-weight`，会导致文字换行抖动（Layout Shift）。
   CDS 借助可变字体的 **`"GRAD"`（Grade，级差）轴** 进行补偿：
   ```css
   @media screen and (prefers-color-scheme: dark) {
     :where([data-mode=system] .cds-root) :is(b, strong):where(:not([class*=font])) {
       --cds-font-axis-wght: var(--cds-font-axis-wght-bold);
       font-variation-settings: var(--font-opsz-axis,) var(--cds-font-axis-wght,) "GRAD" var(--cds-font-grad, 0);
     }
   }
   ```
   **在深色模式下，CDS 将文字 Grade 轴调小，使笔画在视觉上收敛、去刺眼，但字符水平度量 (Horizontal Metrics) 绝对保持 0 像素偏差，彻底杜绝明暗切换时的文本跳动！**

#### 7.3.3 全套 Anthropic 专有可变无衬线与衬线排版体系 (Typography)

MSIX 内直接打包并注册了全套专用可变字体：
- **`AnthropicSans` (无衬线)**：`AnthropicSans-Roman-Variable-DDVos-BJ.woff2` (118KB) + `Italic` (129KB)，用于交互界面、代码注释、按钮与导航。
- **`AnthropicSerif` (衬线体)**：`AnthropicSerif-Roman-Variable-2VcCjn5t.woff2` (165KB) + `Italic` (163KB)，用于 Claude 回复的长篇文本与思维链。
- **排版多轴参数 (Multi-Axis Control)**：
  - **`wght` (Weight)**：`font-weight: 300 800;`，支持 300 到 800 之间任意浮点数粗细无级变换。
  - **`opsz` (Optical Size，光学尺寸)**：
    ```css
    .font-claude-response-heading {
      font-family: var(--font-claude-response);
      font-variation-settings: "opsz" 20; /* 1.25rem 标题专属笔画比例 */
    }
    .font-claude-response-title {
      font-family: var(--font-claude-response);
      font-variation-settings: "opsz" 28; /* 1.75rem 大标题强化端庄与衬线锐利感 */
    }
    ```
    光学尺寸根据字号物理缩放微调字怀与字偶距，大字精致庄严，小字宽绰清晰。
  - **禁用特定连字**：`font-feature-settings: "dlig" 0;`，强制关闭歧义偶合连字，确保技术讨论中符号与代码排版的纯粹性。
- **排版分流机制**：
  - 用户界面控件：`--font-claude-response: var(--font-ui)`（`anthropic-sans`）。
  - Claude 输出正文：`--font-claude-response: var(--font-anthropic-serif)`。呈现类似精美出版物与高端文学期刊的阅读体验。
- **前沿 CSS Web 标准深度实践**：
  - **CSS Container Queries**：`@container (width >= 56rem)` 与 `100cqw`，彻底摆脱传统窗口 `@media`，让任何悬浮窗格内部组件按物理像素弹性折叠。
  - **CSS Color Module Level 4**：全量采用 `color-mix(in srgb, var(--neutral) 28%, transparent)` 进行混色。
  - **CSS Text Box Trim**：`text-box: trim-start cap alphabetic`，精准削去大写字母和基线上下方冗余的行间距，实现真正的设计工具级网格贴合。
  - **CSS Anchor Positioning**：`anchor-name: --titlebar-drag-spacer`、`position-anchor`，脱离传统 absolute 计算，实现原生浮动定位。

### 7.4 富文本输入框架构 (The Composer)

输入框基于 **ProseMirror + TipTap**（`vendor-prosemirror-*.js` / `vendor-tiptap-*.js`）打造：
- **胶囊节点（Pill Nodes）**：支持 `@` 唤起结构化引用的文件、文件夹或 MCP 资源胶囊，在光标移动与退格时作为不可分割的原子节点处理。
- **斜杠指令系统**：输入 `/` 触发命令菜单并挂载快捷操作。
- **智能粘贴检测**：大段代码自动识别语法并折叠为代码块片段卡片，图片/PDF 自动识别并在输入框内生成可预览的缩略图挂载块。

### 7.5 代码查看与 Diff 审阅系统

1. **深度嵌入 Monaco Editor (`c5aee9dbd-*.css`)**：
   前端直接嵌入了 VS Code 同款的 Monaco 编辑器内核（`.monaco-diff-editor`），在侧边栏的 `diff` 窗格中提供精准的双栏/单栏文件对比、语法语义高亮与 MiniMap 缩略图。
2. **多线程 Shiki 语法高亮引擎 (`highlightWorker-DC5uhXj0.js`，1.57MB)**：
   长文本代码在主线程进行实时正则高亮会导致打字与滚动掉帧。Claude 将基于 TextMate 语法的 **Shiki 高亮引擎整体移入专用 Web Worker**，流式生成时主线程只做纯文本接收，Worker 异步完成高亮树计算并传回最小 DOM 差异。

### 7.6 多线程并发渲染管线 (Web Workers Pipeline)

在 `resources/ion-dist/assets/` 下提取到了专业的工作线程分工：

| Worker 文件 | 核心职责与工程亮点 |
|---|---|
| **`highlightWorker-DC5uhXj0.js`** (1.57MB) | Shiki 离线语法高亮引擎，解耦代码块解析开销。 |
| **`framebufferCanvasWorker-DX2Rs-io.js`** (2KB) | **Computer Use 零拷贝画布渲染**（细节见下）。 |
| **`completionGzipWorker-Q_JtDKxH.js`** (591B) | 流式数据 gzip 解压，减少进程间传输内存占用。 |
| **`rumEncoder.worker-D2VjCHUL.js`** (64KB) | 用户交互时序日志离线编码与批处理。 |
| **`wasm-B9ZqxnKj-vq9qxLPw.js`** (622KB) | WebAssembly 高性能计算与校验加速。 |
| **`worker-portable-nQ-kv3bB.js`** (213KB) | 便携运行时辅助线程。 |

#### `framebufferCanvasWorker` 的零拷贝渲染实现：
1. **OffscreenCanvas 离线画布接管**：主线程创建 `<canvas>` 并调用 `transferControlToOffscreen()`，直接将 GPU 渲染上下文交付 Worker。
2. **硬件解码与跳帧防御**：
   ```javascript
   if (typeof ImageDecoder !== "undefined") {
     let decoder = new ImageDecoder({ type: mimeType, data: buffer, transfer: [buffer.buffer] });
     let { image } = await decoder.decode();
     ctx.drawImage(image, 0, 0, width, height);
   }
   if (t.seq <= s.paintedSeq) { e.close(); return; } // 抛弃滞后帧
   ```

### 7.7 思考过程 (Thinking Process) 与工具卡片流式渲染器

1. **思维链状态机与折叠判定 (`c05b96c7f-*` / `ca2ef848d-*`)**：
   - 维护 `thinking`（明文思考）与 `redacted_thinking`（密文安全思考）。
   - 内置 `Jf(block)` 函数判定思维块是否为空或包含有效可打印字符。
   - 捕获 `start_timestamp` 与 `stop_timestamp`，在卡片右上角实时动态渲染耗时指示器（如 `Thought for 12 seconds`）。
2. **工具卡片格式化映射表 (`cb6930dae-BT4W5w7v.js`)**：
   前端维护了清晰的字典映射，将底层原始 JSON 转化为交互式卡片：
   - `mcp__ccd_view__show_pane` → 窗格切换标签（Showing the diff pane）
   - `mcp__ccd_host__open_in_editor` → 编辑器联动卡片
   - `mcp__computer-use__app_key` → 原生键帽 UI
   - `mcp__Claude_Browser__preview_screenshot` → 交互式内嵌缩略图

### 7.8 隐藏彩蛋：复古像素游戏引擎 (`clawdQuestEngine-D01k-Uz3.js`)

在 `.vite/renderer/main_window/assets/clawdQuestEngine-D01k-Uz3.js`（1.23MB）中：
- **Clawd Quest**：内置的 2D 像素复古冒险小游戏。
- 文件头部硬编码嵌入了完整的 8-bit Base64 MP3 音频流（`data:audio/mpeg;base64,//tAwA...`）。
- 包含完整的 Sprite 碰撞、计分和关卡引擎，用于在离线等待或特定彩蛋时供用户娱乐。

