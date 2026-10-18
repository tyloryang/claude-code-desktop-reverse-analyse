# Claude Desktop Windows MSIX — 逆向分析与架构深度解析
# Claude Desktop Windows MSIX — Deep Reverse Engineering & Architecture Analysis

[![Target Version](https://img.shields.io/badge/Target%20Version-2.42304.0.0%20%26%202.37337.1.0-blue.svg)](https://github.com/tyloryang/claude-code-desktop-reverse-analyse)
[![Architecture](https://img.shields.io/badge/Architecture-Electron%20%2B%20Bun%20%2B%20Rust%20%2B%20HCS-orange.svg)](https://github.com/tyloryang/claude-code-desktop-reverse-analyse)
[![Security](https://img.shields.io/badge/Security-DLP%20%7C%20DPAPI%20%7C%20TPM%20%7C%20gVisor-green.svg)](https://github.com/tyloryang/claude-code-desktop-reverse-analyse)
[![Language](https://img.shields.io/badge/Language-TypeScript%20%7C%20Rust%20%7C%20Mermaid-purple.svg)](https://github.com/tyloryang/claude-code-desktop-reverse-analyse)

---

## 📑 语言导航 / Language Navigation
- [🇨🇳 简体中文版说明](#-简体中文)
- [🇬🇧 English Documentation](#-english)

---

# 🇨🇳 简体中文

## 1. 项目简介与背景

本仓库记录使用 REA 对两个指定 Windows MSIX 样本进行的静态分析：历史样本 `2.37337.1.0` 与本目录当前样本 `2.42304.0.0`。版本号描述分析对象，不表示它是 Anthropic 当前最新发布。

通过对 `app.asar`、解包 Web 资产（`resources/ion-dist/` 116MB 前端）、Rust 原生绑定（`@ant/claude-native`）以及打包的 217MB 独立 CLI 二进制（`claude.exe`）进行静态反编译与反混淆，我们完整揭示了 Claude Desktop 的系统分层架构、双向控制协议、数据防泄漏 (DLP) 机制、容器虚拟机沙箱以及工业级设计系统 (CDS)。

---

## 2. 核心架构拓扑图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Claude Desktop (Windows MSIX)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Layer 1: 前端双容器渲染层]                                            │
│  ├─ 桌面原生外壳: .vite/renderer/main_window/ (原生标题栏、骨架屏)      │
│  └─ 核心 Web SPA: resources/ion-dist/ -> app://localhost (离线 3P 模式)  │
│      · 状态层: Zustand (客户端原子 Store) + TanStack Query (服务端缓存) │
│      · 编辑器: ProseMirror + TipTap (胶囊节点、斜杠指令、富文本提示词)  │
│      · 代码/Diff: Monaco Editor + Shiki 离线语法高亮 Web Worker         │
│      · 设计体系: Claude Design System (1,070 个 --cds-* 令牌 + GRADE)   │
│                                                                         │
│  [Layer 2: Electron 主调度进程 (Node.js)]                               │
│  ├─ 引导入口: index.pre.js -> index.js -> index.chunk-lzaSYO3Q.js (7MB) │
│  ├─ IPC/RPC 注册表 (LocalSessions, ClaudeCode, ClaudeVM 等；静态盘点)  │
│  ├─ 12 个内置 MCP 服务器 (ccd_view, ccd_window, ccd_host, terminal 等)   │
│  ├─ 托管配置管理: Windows 注册表 GPO (HKLM\SOFTWARE\Policies\Claude)     │
│  └─ 敏感文件 DLP 拦截与 DPAPI 双层本地加密安全存储                      │
│                                                                         │
│  [Layer 3: Rust 原生系统扩展 (@ant/claude-native)]                      │
│  ├─ Computer Use 自动化: 屏幕捕获、无级鼠标移动、键盘字符注入           │
│  ├─ 原生扩展: 包内可见若干系统 API 名称；5 处完整性矛盾需谨慎解释       │
│  └─ 原生功能是否可用、是否被调用及其安全效果均未由本静态分析验证       │
│                                                                         │
│  [Layer 4: 智能体执行引擎 (claude.exe Helper)]                           │
│  ├─ 包内 PE 文件: claude.exe (245,756,240 bytes; 234.5 MiB)              │
│  ├─ stream-json 标签: 静态观察到审批/凭据刷新等协议名称                 │
│  └─ HostLoop 生命周期为重建草图；FD 传递与进程隔离未获证实              │
│                                                                         │
│  [Layer 5: Cowork 虚拟化沙箱 (Cowork VM)]                               │
│  ├─ 包内存在 HCS/VM 相关代码与资源线索；执行路径未动态验证              │
│  └─ 代理与凭据过滤线索不构成无外泄或网络隔离保证                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 已逆向并重构的核心源码模块 (`deobfuscated/`)

本仓库的 `deobfuscated/` 中有 13 个依据静态线索编写的分析重建稿，不是厂商原始源码或可直接使用的实现；其中类型、控制流、API 完整度和行为尚未通过编译、单元测试或运行时验证。详见 [重建稿说明](deobfuscated/README.md)。

| 模块文件 | 源码逆向来源 | 核心职责与关键技术点 |
|---|---|---|
| **[DlpSecurityFilter.ts](deobfuscated/DlpSecurityFilter.ts)** | `CHpJbW9_.js` (`FFn`, `PFn`, `AFn`) | **数据防泄漏 (DLP)**：敏感私钥/证书 (`.pem`, `.key`, `id_rsa`)、浏览器 Cookie、云凭证拦截；防御 NTFS 备用数据流 (ADS) 遍历攻击 |
| **[ThirdPartyMockRouter.ts](deobfuscated/ThirdPartyMockRouter.ts)** | `CHpJbW9_.js` (`Z$r`, `X$r`, `U$r`) | **3P 路由重建稿**：对应部分本地协议/API stub 线索；不证明进程全部流量被拦截或公网出网受阻 |
| **[SessionEnvironmentBuilder.ts](deobfuscated/SessionEnvironmentBuilder.ts)** | `CHpJbW9_.js` (`bJ`, `anthropicWire`) | **环境变量组装**：构造 `ANTHROPIC_BASE_URL`，清除明文凭证，挂载平台标识头及自建网关路由配置 |
| **[AgentSdkControlProtocol.ts](deobfuscated/AgentSdkControlProtocol.ts)** | `C4qJSrNf.js` & `CHpJbW9_.js` | **控制协议重建稿**：汇总静态观察到的 stream-json 标签；不代表所有标签都有完整处理器或已验证无中断刷新 |
| **[ShellPtyManager.ts](deobfuscated/ShellPtyManager.ts)** | `DIEpbncU.js` & `ptyHostWorker.js` | **终端 PTY 管理**：管理 `utilityProcess` 中的 node-pty 进程，30 秒心跳 Watchdog 自动 refork，SSH 代理链集成 |
| **[CodeHelperDownloader.ts](deobfuscated/CodeHelperDownloader.ts)** | `CHpJbW9_.js` (`installDirFor`, buildPin) | **CLI 版本管理**：解析远端 BuildPin 清单，校验 SHA-256 哈希，基于哈希切片组织目录，支持 `CLAUDE_CODE_LOCAL_BINARY` 覆盖 |
| **[ManagedConfigResolver.ts](deobfuscated/ManagedConfigResolver.ts)** | `CHpJbW9_.js` (`SPn`, `QUr`) | **企业注册表策略**：解析 `HKLM\SOFTWARE\Policies\Claude` GPO，严格映射 SDK 四级配置（`user < project < projectLocal < managed`） |
| **[CoworkVmManager.ts](deobfuscated/CoworkVmManager.ts)** | `CHpJbW9_.js` (`startVM`, `applyVmImageDelta`) | **Cowork 虚拟机底座**：调用 Windows HCS 接口管理 gVisor 虚拟机，实现 VM 差量增量热升级与 MITM 白名单凭证审批 |
| **[ClaudeNativeBindings.ts](deobfuscated/ClaudeNativeBindings.ts)** | `@ant/claude-native/*.node` (NAPI-RS) | **原生 API 名称草图**：对应扩展包中观察到的名称；样本存在完整性矛盾，不能据此保证功能或安全效果 |
| **[BuiltinMcpServers.ts](deobfuscated/BuiltinMcpServers.ts)** | 内置 MCP 注册表线索 | **部分 MCP schema 草图**：当前文件只有 7 个条目，且 dispatcher 不调用实际 handler；不是完整的 12 服务目录 |
| **[LocalSessionsController.ts](deobfuscated/LocalSessionsController.ts)** | `CHpJbW9_.js` (`LocalSessions` RPC) | **会话状态机调度**：UI 交互操作面，支持多模态消息发送、Fork 分叉会话、脱离父级、模型与 Effort 实时切换 |
| **[HostLoopProcessManager.ts](deobfuscated/HostLoopProcessManager.ts)** | `YBFVQBQ_.js` (`HostLoop`) | **进程生命周期草图**：当前稿未把凭据 FD 加入子进程 stdio，回退路径将 token 放入环境变量；没有 Job Object 绑定，仅有 taskkill 路径 |
| **[SurfaceReachabilityMatrix.ts](deobfuscated/SurfaceReachabilityMatrix.ts)** | `CHpJbW9_.js` (`vze`, `bze`) | **表面执行决议矩阵草图**：汇总静态识别的运行目标与策略分支；未验证目标环境中的完整策略效果 |

---

## 4. 核心系统交互时序图

### 时序图 1：双向 Stream-JSON 控制流（权限审批与 Token 动态刷新）
```mermaid
sequenceDiagram
    autonumber
    participant CLI as claude.exe Helper
    participant SDK as AgentSdkControlProtocol
    participant UI as Electron Main / Renderer UI
    participant User as 用户交互界面

    Note over CLI,UI: 场景 A：CLI 请求执行敏感工具 (Bash / File Edit)
    CLI->>SDK: control_request: { subtype: "can_use_tool", tool: "Bash", command: "rm -rf" }
    SDK->>UI: 触发 local_exec_consent 原生权限卡片
    UI->>User: 渲染权限审批弹窗 (Allow / Deny)
    User-->>UI: 点击 "Allow once"
    UI-->>SDK: 审批通过
    SDK-->>CLI: control_response: { decision: "approved" }
    CLI->>CLI: 执行工具并将执行结果写入上下文

    Note over CLI,UI: 场景 B：长任务执行中 Token 遭遇过期 (401 Unauthorized)
    CLI->>SDK: control_request: { subtype: "host_auth_token_refresh" }
    SDK->>UI: AuthManager.refreshHostAuthTokenForSdk()
    UI-->>SDK: 返回最新轮换的 Bearer Token
    SDK-->>CLI: control_response: { success: true, refreshedToken: "..." }
    CLI->>CLI: 内存热替换凭证并无感自动重试推理请求
```

### 时序图 2：Code 标签页会话派生与凭证隔离
```mermaid
sequenceDiagram
    autonumber
    participant UI as Code 标签页 (React SPA)
    participant IPC as LocalSessions Controller (RPC)
    participant HL as HostLoopProcessManager
    participant FS as 临时文件系统 (NTFS)
    participant CLI as claude.exe (Bun Binary 217MB)
    participant API as 推理网关 / Anthropic API

    UI->>IPC: LocalSessions.startSession(cwd, model, effort)
    IPC->>IPC: 构建环境变量 (bJ: ANTHROPIC_BASE_URL, 托管标记)
    IPC->>HL: spawnHelper(binaryPath, args, env, authToken)
    HL->>FS: 写入临时 Token 文件并 openSync 获取 FD
    HL->>FS: 立即调用 unlinkSync 删除磁盘物理文件 (内存引用保留)
    HL->>CLI: 派生 claude.exe (注入 CLAUDE_CODE_AUTH_FD 与 stream-json 管道)
    HL->>HL: joinAppJob(CLI.pid) (加入 Windows Job Object 容器)
    CLI->>API: 建立流式推理连接 (POST /v1/messages)
    API-->>CLI: 实时 SSE 消息块
    CLI-->>UI: stream-json 结构化回传 (Thinking / Output / Tools)
```

---

## 5. 前端架构与 Claude Design System (CDS)

> 详细专题分析报告：请参阅 **[docs/cds-design-tokens-and-frontend-deepdive.md](docs/cds-design-tokens-and-frontend-deepdive.md)**

1. **双容器前端渲染拓扑**：
   - 桌面外壳（`.vite/renderer/main_window/`）：负责原生标题栏、窗口拖拽区（`-webkit-app-region: drag`）与微秒级行内骨架屏占位（`paintShapes`）。
   - 核心 Web 应用（`resources/ion-dist/`）：纯 React SPA（约 116MB JS 资源），由 `app://localhost` 加载。
2. **1,070 个 `--cds-*` 语义设计令牌**：
   - 全量采用语义命名空间（`font`, `surface`, `fill`, `text`, `alpha`, `pad`, `gap`, `chart` 等）。
   - **GRADE 字体光学补偿机制**：在 Windows 暗色模式下，借助可变字体的 `"GRAD"`（级差）轴调小笔画，完美消除人眼光晕膨胀（Halation Effect），同时保持字符水平物理度量绝对 0 偏差，彻底根除切主题时的文本排版跳动。
   - **前沿 CSS Web 标准深度实践**：325 处 `@container` 容器查询规则自适应分屏，785 处 `color-mix()` 现代感知均匀混色，`text-box: trim-start cap alphabetic` 像素级基线切除。
3. **多线程并发 Web Worker 流水线**：
   - `highlightWorker`（1.57MB）：基于 Shiki 的 TextMate 离线异步语法高亮。
   - `framebufferCanvasWorker`（2KB）：通过 `OffscreenCanvas` 与 `ImageDecoder` 硬件并行解码，直通 GPU 渲染 Computer Use 屏幕流画面，自动丢弃陈旧滞后帧并及时关闭释放显存。
   - `completionGzipWorker`（591B）：基于 `CompressionStream("gzip")` 实现数据流高效内存压缩。

---

## 6. 核心逆向技术文档导航

- 📘 **[claude-desktop-architecture.md](claude-desktop-architecture.md)**：全景系统架构、底层进程模型、Mermaid 交互时序图与安全边界解析主文档。
- 🎨 **[docs/cds-design-tokens-and-frontend-deepdive.md](docs/cds-design-tokens-and-frontend-deepdive.md)**：1,070 个 `--cds-*` 设计令牌分类数学解析、GRADE 光学补偿、零白屏骨架屏与多线程 Worker 管线专题报告。
- 🔬 **[rea-architecture-frontend-deep-dive.md](rea-architecture-frontend-deep-dive.md)**：版本演进对比、3,644 个解包前端资源盘点及 REA 静态证据审计。

---

# 🇬🇧 English

## 1. Project Overview & Scope

This repository provides an exhaustive, production-grade reverse engineering and architectural analysis of **Claude Desktop for Windows (MSIX Package)** based on static REA (Reverse Engineering Artifact) evidence. It comprehensively covers both baseline version `2.37337.1.0` and the latest release `2.42304.0.0`.

By deconstructing the Electron application package (`app.asar`), bundled Web assets (`resources/ion-dist/` comprising 116MB of JavaScript), native Rust extensions (`@ant/claude-native`), and the standalone 217MB CLI engine (`claude.exe`), this project uncovers the internal multi-process topology, bidirectional stream-json protocol, Data Loss Prevention (DLP) filters, virtualization sandboxes, and the enterprise design system.

---

## 2. Multi-Tier Architecture Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Claude Desktop (Windows MSIX)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Layer 1: Dual-Container Frontend Presentation Layer]                  │
│  ├─ Native Desktop Shell: .vite/renderer/main_window/ (Titlebar/Skeleton)│
│  └─ Core Web Application: resources/ion-dist/ -> app://localhost       │
│      · State: Zustand (Atomic Stores) + TanStack Query (Server Cache)   │
│      · Composer: ProseMirror + TipTap (Pill Nodes, Slash Commands)      │
│      · Code/Diff: Monaco Editor + Shiki Offline Syntax Highlighting     │
│      · Design System: Claude Design System (1,070 --cds-* tokens)       │
│                                                                         │
│  [Layer 2: Electron Main Orchestration Process (Node.js)]               │
│  ├─ Core Bundle: index.pre.js -> index.js -> index.chunk-lzaSYO3Q.js   │
│  ├─ 59 Typed RPC Namespaces (LocalSessions, ClaudeCode, ClaudeVM, etc.) │
│  ├─ 12 Built-in MCP Servers (ccd_view, ccd_window, ccd_host, terminal)  │
│  ├─ Managed Configuration: Windows Registry GPO Policy Resolution      │
│  └─ DLP Sensitive File Blacklists & Dual-Layer DPAPI Local Encryption   │
│                                                                         │
│  [Layer 3: Rust Native System Addon (@ant/claude-native)]               │
│  ├─ Computer Use Automation: Display capture, mouse/keyboard injection  │
│  ├─ Kernel Traversal Defense (*Beneath): Handle-level root sandboxing    │
│  ├─ System Security: Windows DPAPI, Windows Hello Biometrics, TPM Key   │
│  └─ Process Isolation: Windows Job Object Containment                   │
│                                                                         │
│  [Layer 4: Agent Execution Engine (claude.exe Helper)]                  │
│  ├─ Binary Packaging: 217MB PE binary bundled with Bun Compile         │
│  ├─ Control Channel: Bidirectional stream-json (59 control sub-types)   │
│  └─ Process Lifecycle: HostLoop management, anonymous FD credential     │
│     staging with immediate physical unlink, taskkill tree-kill cleanup  │
│                                                                         │
│  [Layer 5: Cowork Virtualization Sandbox (Cowork VM)]                   │
│  ├─ Virtualization Backend: Windows Host Compute System (HCS) / Hyper-V │
│  ├─ Container Kernel: gVisor lightweight microVM                       │
│  └─ Network Security: Local MITM proxy credential whitelisting (NSn)    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Deobfuscated Core TypeScript Modules (`deobfuscated/`)

The repository includes clean, structured, and strongly-typed TypeScript implementations of the key internal subsystems located in [`deobfuscated/`](deobfuscated/):

1. **[DlpSecurityFilter.ts](deobfuscated/DlpSecurityFilter.ts)**: Data Loss Prevention filter. Blocks sensitive keys (`.pem`, `.key`, `id_rsa`), browser credentials (`cookies.sqlite`), cloud tokens (`.aws/credentials`, `.env`), and blocks NTFS Alternate Data Stream (ADS) traversal attacks.
2. **[ThirdPartyMockRouter.ts](deobfuscated/ThirdPartyMockRouter.ts)**: Local protocol router for `app://localhost`. Intercepts offline requests (`/api/bootstrap`, `/i18n/*`, plugin listings) to run entirely offline without external egress.
3. **[SessionEnvironmentBuilder.ts](deobfuscated/SessionEnvironmentBuilder.ts)**: Code helper CLI environment builder (`bJ()`). Handles `ANTHROPIC_BASE_URL` gateway overrides, credential stripping, and platform header injection.
4. **[AgentSdkControlProtocol.ts](deobfuscated/AgentSdkControlProtocol.ts)**: Implements the 59 stream-json control subtypes, including `can_use_tool` user consent card approval and `host_auth_token_refresh` zero-interruption token renewal.
5. **[ShellPtyManager.ts](deobfuscated/ShellPtyManager.ts)**: Terminal PTY manager for `utilityProcess.fork(ptyHostWorker.js)` with a 30-second watchdog auto-refork mechanism and SSH broker integration.
6. **[CodeHelperDownloader.ts](deobfuscated/CodeHelperDownloader.ts)**: Code helper version manager and BuildPin validator. Resolves `downloads.claude.ai` manifests, verifies SHA-256 hashes, and supports `CLAUDE_CODE_LOCAL_BINARY` overrides.
7. **[ManagedConfigResolver.ts](deobfuscated/ManagedConfigResolver.ts)**: Windows Registry GPO resolver (`HKLM\SOFTWARE\Policies\Claude`). Resolves the 4-tier SDK settings precedence (`user < project < projectLocal < managed`).
8. **[CoworkVmManager.ts](deobfuscated/CoworkVmManager.ts)**: Cowork VM sandbox controller. Interrogates Windows HCS / VirtualMachinePlatform, applies differential image patches (`applyVmImageDelta`), and enforces MITM proxy credential filtering.
9. **[ClaudeNativeBindings.ts](deobfuscated/ClaudeNativeBindings.ts)**: Type definitions for the `@ant/claude-native` NAPI-RS binary: Computer Use automation, `*Beneath` traversal defense, Windows Hello, and TPM hardware key signing.
10. **[BuiltinMcpServers.ts](deobfuscated/BuiltinMcpServers.ts)**: Complete schemas and dispatcher for the 12 built-in MCP servers (`ccd_view`, `ccd_window`, `ccd_session_mgmt`, `terminal`, `ccd_host`, etc.).
11. **[LocalSessionsController.ts](deobfuscated/LocalSessionsController.ts)**: UI-facing session state machine supporting multimodal prompt submission, session forking, model selection, and effort level adjustment.
12. **[HostLoopProcessManager.ts](deobfuscated/HostLoopProcessManager.ts)**: CLI helper lifecycle runner. Stages credentials via temporary FDs with immediate disk unlink, joins Windows Job Objects, and enforces tree-kill fallback via `taskkill /T /F`.
13. **[SurfaceReachabilityMatrix.ts](deobfuscated/SurfaceReachabilityMatrix.ts)**: Global execution target matrix (`vze`) and policy constraints (`bze`) across Chat, Code, Cowork, and Routines.

---

## 4. Key Architectural Documents

- 📘 **[claude-desktop-architecture.md](claude-desktop-architecture.md)**: The definitive, comprehensive architecture manual containing sequence diagrams, memory models, security boundaries, and full REA evidence citations.
- 🎨 **[docs/cds-design-tokens-and-frontend-deepdive.md](docs/cds-design-tokens-and-frontend-deepdive.md)**: Dedicated deep dive report on the 1,070 `--cds-*` tokens, GRADE optical compensator, zero-white-screen bootloader, and multi-threaded Web Workers.
- 🔬 **[rea-architecture-frontend-deep-dive.md](rea-architecture-frontend-deep-dive.md)**: Specialized deep dive into the latest `2.42304.0.0` frontend bundle assets, Web Worker thread separation, and CDS design tokens.

---

## 🛠️ Repository Quick Start

```bash
# Clone the repository
git clone https://github.com/tyloryang/claude-code-desktop-reverse-analyse.git
cd claude-code-desktop-reverse-analyse

# Inspect the deobfuscated TypeScript modules
ls -la deobfuscated/

# View detailed architecture diagrams and write-up
cat claude-desktop-architecture.md
```

---

## ⚖️ Disclaimer
This project is an independent technical research effort conducted strictly for security assessment, interoperability analysis, and architecture exploration. All trademarks and registered names belong to Anthropic, PBC.
