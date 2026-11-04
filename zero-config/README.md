# Claude Desktop 4.4212 第三方模型免配置 EXE / MSIX 包

这是基于仓库当前 `Claude.msix` 制作的 Windows 研究构建。它保留 Claude Desktop 最新版内置的 `3p/gateway` 分支，在主进程入口前注入一个本地回环兼容层，使 Claude Desktop 可以自动发现并调用 Ollama、LM Studio、vLLM、LocalAI 或其他 OpenAI-compatible 服务。

> 这不是 Anthropic 官方发布包，也不带 Anthropic 的数字签名。默认交付形式是免安装的独立 `Claude-ThirdParty-ZeroConfig.exe`：不注册包、不导入证书、不需要管理员或开发者模式。自签名 MSIX 与松散注册包作为可选路径保留，MSIX 使用独立研究构建证书，安装前必须由用户明确接受当前用户根证书信任。

## 1. 快速使用

### 1.1 准备第三方模型服务

任选一个 OpenAI-compatible 服务并启动：

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | 本地服务通常不需要 API Key |
| LM Studio | `http://127.0.0.1:1234/v1` | 启动 Local Server |
| vLLM | `http://127.0.0.1:8000/v1` | 启动 OpenAI-compatible API |
| LocalAI | `http://127.0.0.1:8080/v1` | 使用 OpenAI-compatible API |

### 1.2 双击 EXE（推荐，免证书）

```text
dist\\Claude-ThirdParty-ZeroConfig.exe
```

双击即可：首次运行显示解压进度并启动 Claude Third-Party，之后复用同一构建的缓存。不运行 `Add-AppxPackage`，不创建或导入任何证书，不需要管理员权限或开发者模式；构建、安装、启动全程不触碰 Windows 证书库。详细使用说明见 [`README-EXE.md`](README-EXE.md)。

### 1.3 安装 MSIX（可选）

如果希望获得正式的 Windows 包安装体验，使用发布包：

```text
dist\\Claude-ThirdParty-ZeroConfig-MSIX.zip
```

解压后双击 `Install-Claude-ThirdParty-MSIX.cmd`。安装器先核对 MSIX 签名与公开 `.cer` 指纹，再要求明确确认自签名证书信任；Windows 还会显示根证书安全警告。完整说明见 [`README-MSIX.md`](README-MSIX.md)。

### 1.4 启动松散 EXE 包（备用）

如果不希望信任自签名根证书，可使用松散包。构建完成后进入：

```text
dist\\Claude-ThirdParty-Package\\
```

构建脚本还会生成同级发布压缩包：

```text
dist\\Claude-ThirdParty-Package.zip
```

该 ZIP 包含 `app\\Claude.exe`、松散包 manifest、安装/卸载脚本和本手册，可作为 GitHub Release 资产分发。

双击：

```text
Start-Claude-ThirdParty.cmd
```

脚本会执行以下动作：

1. 注册 `ClaudeThirdPartyZeroConfig` 松散包；
2. 通过 Windows package identity 启动 `app\\Claude.exe`；
3. 自动创建独立数据目录 `%LOCALAPPDATA%\\Claude-3p-ZeroConfig`；
4. 自动写入 `deploymentMode: "3p"` 和 gateway profile；
5. 启动本机 `127.0.0.1:42121` 兼容网关；
6. 探测第三方模型并通过 `/v1/models` 暴露给 Claude Desktop。

如果 `Add-AppxPackage` 返回 `0x80073CFF`，请在 Windows 设置中手动启用 Developer Mode，然后再次运行脚本。本项目不会自动修改系统安全设置或安装证书。

### 1.5 卸载松散包

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Uninstall-Claude-ThirdParty.ps1
```

卸载脚本只移除 `ClaudeThirdPartyZeroConfig` 包注册，不删除官方 Claude 的 `%LOCALAPPDATA%\\Claude-3p` 数据。

## 2. 自定义第三方服务

默认探测顺序：

1. `CLAUDE_THIRD_PARTY_BASE_URL`；
2. Ollama：`http://127.0.0.1:11434/v1`；
3. LM Studio：`http://127.0.0.1:1234/v1`；
4. vLLM：`http://127.0.0.1:8000/v1`；
5. LocalAI：`http://127.0.0.1:8080/v1`。

云端 OpenAI-compatible 服务可以在启动前设置：

```powershell
$env:CLAUDE_THIRD_PARTY_BASE_URL = 'https://provider.example.com/v1'
$env:CLAUDE_THIRD_PARTY_API_KEY = '<your-api-key>'
$env:CLAUDE_THIRD_PARTY_MODEL = 'provider-model-id'
.\\Start-Claude-ThirdParty.cmd
```

支持的环境变量：

| 环境变量 | 作用 |
| --- | --- |
| `CLAUDE_THIRD_PARTY_BASE_URL` | 自定义 OpenAI-compatible `/v1` 地址 |
| `CLAUDE_THIRD_PARTY_API_KEY` | 自定义服务的 API Key |
| `CLAUDE_THIRD_PARTY_MODEL` | 固定上游模型 ID |
| `OPENAI_BASE_URL` / `OPENAI_API_BASE` | 兼容 OpenAI 客户端的地址变量 |
| `OPENAI_API_KEY` | OpenAI-compatible 服务 API Key |
| `OPENROUTER_API_KEY` | OpenRouter API Key |
| `CLAUDE_ZERO_CONFIG_PORT` | 本地兼容网关首选端口，默认 `42121` |
| `CLAUDE_ZERO_CONFIG_USER_DATA_DIR` | 覆盖独立配置目录 |
| `CLAUDE_ZERO_CONFIG_DISABLE=1` | 禁用注入网关，直接启动 vendor 应用 |

API Key 只从当前进程环境读取，不写入 Claude Desktop 配置。配置 profile 中的 `local-zero-config` 是本地 gateway schema 所需的占位值，不是云端密钥。

## 3. 系统架构

```mermaid
flowchart LR
    U[用户] -->|双击| E[Claude-ThirdParty-ZeroConfig.exe\n自解压启动器，无包身份/无证书]
    E -->|解压缓存后执行| A[app\\Claude.exe\n普通 Win32 进程]
    A --> C[Claude Desktop UI]
    C --> V[官方 vendor 主进程\nindex.pre.js]
    B[zero-config bootstrap] -.入口前置注入.-> V
    V --> G[官方 3p/gateway 路由]
    G -->|GET /v1/models\nPOST /v1/messages| L[本地兼容网关\n127.0.0.1:42121]
    L --> D{自动发现}
    D --> O[Ollama\n11434/v1]
    D --> M[LM Studio\n1234/v1]
    D --> Q[vLLM\n8000/v1]
    D --> LA[LocalAI\n8080/v1]
    D --> X[自定义 BASE_URL]
    L --> T[Anthropic ↔ OpenAI\n请求、工具、SSE 转换]
    T --> D
    V --> P[%LOCALAPPDATA%\\Claude-3p-ZeroConfig\n3p 配置库]
```

架构中的两条边界不同：

- **官方路径**：Claude Desktop 仍负责 UI、会话、模型选择、gateway 路由和 Code helper 环境。
- **注入路径**：本项目只负责预置 3P 配置、启动回环网关、发现上游服务和转换协议，不重写约 6.8 MB 的核心压缩 chunk。

## 4. 请求处理流程

```mermaid
sequenceDiagram
    participant UI as Claude Desktop UI
    participant V as 官方 gateway
    participant Z as zero-config 网关
    participant P as OpenAI-compatible Provider

    UI->>V: GET /v1/models
    V->>Z: GET /v1/models
    Z->>P: GET /v1/models
    P-->>Z: OpenAI model list
    Z-->>V: Anthropic model rows\n含 anthropic_family_tier
    V-->>UI: 可选模型列表

    UI->>V: POST /v1/messages
    V->>Z: Anthropic Messages request
    Z->>Z: 转换 system/messages/tools/tool_choice
    Z->>P: POST /v1/chat/completions
    P-->>Z: JSON 或 OpenAI SSE
    Z->>Z: 转换文本、tool calls、usage、stop reason
    Z-->>V: Anthropic response/SSE
    V-->>UI: 回复或工具调用
```

### 支持的入口

| HTTP 接口 | 用途 | 当前实现 |
| --- | --- | --- |
| `GET /v1/models` | 模型发现 | 自动探测并增加 `anthropic_family_tier` |
| `POST /v1/messages` | 主消息请求 | 非流式和流式转换 |
| `POST /v1/messages/count_tokens` | token 计数 | 字符数近似，不使用上游 tokenizer |
| `GET /_claude_zero_config/health` | 本地健康检查 | 返回当前探测到的 provider |

### 内容转换范围

- system prompt；
- 文本 content block；
- base64 和 URL 图片；
- Anthropic `tool_use` / `tool_result`；
- OpenAI function tools 和 `tool_choice`；
- OpenAI SSE 文本增量到 Anthropic `text_delta`；
- OpenAI SSE tool call 增量到 Anthropic `input_json_delta`；
- stop reason 和基础 usage。

第三方服务是否真正支持视觉、工具、长上下文、reasoning 或结构化输出，取决于具体上游模型。

## 5. 如何用 REA 解析 Claude.msix

REA 分析的目标是先确认最新版包实际包含什么，再决定最小修改点。分析过程没有执行目标 JavaScript，也没有把目标文件中的文本当作指令。

### 5.1 包级分析

1. 使用 `open_binary` 打开仓库根目录的 `Claude.msix`；
2. 使用 `inspect_artifact` 查看 MSIX 成员、版本、完整性和可疑分支；
3. 使用 `extract_artifact` 将 MSIX 解到独立临时目录；
4. 从 `app\\resources\\app.asar` 继续分析 Electron 应用。

### 5.2 JavaScript 应用图分析

对 `app.asar` 使用 `analyze_javascript_application`，重点查看：

- `.vite/build/index.pre.js`：主进程入口、3P userData 路径和启动顺序；
- `.vite/build/index.chunk-2SHPxESV.js`：provider、gateway、model discovery 和 message request；
- `.vite/build/index.chunk-WNSDfQz8.js`：Code/Cowork 会话和 `ANTHROPIC_BASE_URL` 传播。

由于核心 bundle 很大，REA 返回的应用图是部分覆盖。对具体问题使用 `inspect_analysis_view` 分页读取模块和事实；不能把“图中没有命中”当作功能不存在。

### 5.3 关键静态证据

本次分析记录的 Evidence：

| 分析对象 | Evidence ID | 关键结论 |
| --- | --- | --- |
| `Claude.msix` | `ev_30c308336d8867602a2b5ca3d96a813103331580118bd174157fe1c53f7be485` | MSIX `4.4212.0.0`、成员和完整性 |
| `app.asar` | `ev_db006cd69078f668d1ad0764bb75a8f09179e4b4431043fb189a3d44d373df12` | 651 个相关文件、3P/gateway 静态关系 |
| 原始 `Claude.exe` fuse | `ev_c80969004464b25c2accc996eeff74c74dc170811bb0021435971a80f157dde5` | embedded ASAR integrity 原本启用 |
| 修改后 `Claude.exe` fuse | `ev_3d7e9256f8b027887a29c67e9b5af276f7118909b5ec7f9e054ab24b19881d19` | integrity disabled，OnlyLoadAppFromAsar 保留 |

REA 还确认了以下静态事实：

- 官方已经存在 `gateway` provider 和 `deploymentMode: "3p"`；
- 模型发现支持带 `anthropic_family_tier` 的非 Anthropic 模型 ID；
- 消息请求统一经过 `/v1/messages`；
- Code helper 会继承 provider 的 API host；
- 修改 `app.asar` 后必须关闭 embedded-ASAR integrity fuse，否则 Electron 可能拒绝新归档。

## 6. 如何把 Claude Desktop 改成直接支持第三方模型

推荐采用“保留官方 3P 路由，只补协议和自动配置”的方式，而不是重写模型选择或核心会话逻辑。

```mermaid
flowchart TD
    S[开始：获取最新版 Claude.msix] --> R[REA 解析包、ASAR、入口和 fuse]
    R --> E{官方是否已有 3P/gateway？}
    E -- 否 --> H[需要重新实现 provider/session 路由\n维护成本高]
    E -- 是 --> I[保留 index.pre.js 文件身份]
    I --> J[文件头注入 bootstrap]
    J --> K[设置独立 userData\n写 deploymentMode=3p]
    K --> L[写 configLibrary profile\n指向本地 gateway]
    L --> N[启动 127.0.0.1 gateway]
    N --> D[探测 OpenAI-compatible /v1]
    D --> F[GET /v1/models 映射 family tier]
    D --> C[POST /v1/messages 协议转换]
    C --> X[文本、tool calls、SSE、usage 转换]
    X --> U[官方 Claude UI / Code helper 使用现有 gateway]
    U --> V[运行测试、打包、检查 fuse、真实启动验证]
```

实施时应遵循以下顺序：

1. **先用 REA 确认版本和路径**：不要假设旧版 bundle 的文件名或配置字段仍然存在；
2. **优先复用官方分支**：只设置 `deploymentMode`、gateway profile 和 model discovery 所需字段；
3. **入口保持同名**：保留 `.vite/build/index.pre.js`，只在文件头注入，避免改变主模块加载语义；
4. **隔离用户数据**：vendor 会重置 `CLAUDE_USER_DATA_DIR`，因此应拦截 `app.setPath('userData', ...)`，使用独立目录；
5. **实现回环兼容层**：把 Anthropic Messages 转成 OpenAI Chat Completions，再把 JSON/SSE 转回去；
6. **处理 Electron fuse**：重打 `app.asar` 后只关闭 `EnableEmbeddedAsarIntegrityValidation`，保留 `OnlyLoadAppFromAsar`；
7. **选择启动形态**：优先使用独立 EXE 启动器——直接执行解包目录可能因 Windows/Chromium 初始化退出，MSIX 又要求证书信任；自解压启动器以普通 Win32 进程运行 `app\\Claude.exe`，两者都不需要；需要包身份时仍可选松散注册或签名 MSIX；
8. **隔离配置写入顺序**：主进程在同步求值阶段就读取 `claude_desktop_config.json` 与 `configLibrary`，gateway profile 和 `deploymentMode` 必须在启动器任何异步步骤之前写盘，否则应用以空配置启动并退回 claude.ai 登录页；
9. **验证真实入口**：不能只运行 adapter 单测，还要以真实启动方式运行，确认配置加载类型、模型进入选择器、非流式和流式消息路径，以及证书库与官方配置不变。

## 7. 从源码重新构建

仓库根目录需要存在当前输入包：

```text
Claude.msix
```

执行：

```bash
npm --prefix zero-config test
npm --prefix zero-config run build:exe
```

`build:exe` 只生成免证书独立 EXE（不需要 Windows SDK 的 `MakeAppx.exe` / `SignTool.exe`）：

```text
dist\\Claude-ThirdParty-ZeroConfig.exe
```

生成 MSIX 与松散包时使用 `npm --prefix zero-config run build`。

构建脚本会：

1. 用 PowerShell 解包 MSIX；
2. 修复 REA 解包产生的 `%40ant` native binding 路径兼容问题；
3. 解包并重打 `app.asar`；
4. 注入 `bootstrap.cjs`、`adapter.cjs` 和 `server.cjs`；
5. 在 `--exe-only` 模式下补丁两处配置目录函数与两处模型校验函数（匹配数不为 1 时构建直接失败），使隔离目录在 vendor 清理环境变量后仍然生效，并放行第三方模型名；
6. 修改 `Claude.exe` 的 embedded-ASAR integrity fuse；
7. `build:exe`：用 `csc.exe` 编译自解压启动器 `Claude-ThirdParty-ZeroConfig.exe`（内嵌 `payload.zip` 与其 SHA-256、应用 manifest 声明长路径支持），不调用 MakeAppx、SignTool 或任何证书命令；
8. `build`（完整模式）：写入独立 manifest 和安装/卸载脚本，输出松散包 `dist/Claude-ThirdParty-Package/` 和 `dist/Claude-ThirdParty-Package.zip`；使用 Windows SDK `MakeAppx.exe` 生成真正的 `.msix`；用临时自签名代码签名证书签署 MSIX，只导出公开 `.cer`，随后删除私钥；输出 `dist/Claude-ThirdParty-ZeroConfig-MSIX.zip` 发布包。

构建过程使用 Node.js `>=22.0.0`；`build:exe` 额外需要 Windows 自带的 .NET Framework C# 编译器（`csc.exe`），不需要 Windows SDK。ASAR 和 Electron fuse CLI 通过 `npx` 调用，不需要把依赖安装到目标包内。自签名 MSIX 的安装说明和证书信任边界见 [`README-MSIX.md`](README-MSIX.md)。

## 8. 验证和边界

已验证：

- 11 项自动测试全部通过；
- 免证书 EXE 以普通 Win32 进程启动成功（`GetPackageFullName` 返回 `15700` = 无包身份），全程不改动证书库、包注册与官方 `Claude-3p` 配置；
- 应用启动即加载隔离配置（`configuration at launch { type: 'local' }`）并加载研究构建 UI（`Loaded app://localhost`）；
- 第三方模型进入客户端选择器：`Model discovery: 1 found in 79ms; picker = 1`；
- 重复启动复用同一网关，第一实例的 profile 与进程不受干扰；
- MSIX/松散包路径的 package identity 启动成功；
- `GET /_claude_zero_config/health` 返回 `200`；
- 无 provider 时 `/v1/models` 返回明确 `503`；
- mock vLLM 自动发现成功；
- 非流式 `/v1/messages` 转换成功；
- 流式文本 SSE 以 `message_stop` 正常结束；
- 修改后 fuse 状态符合预期；
- `MakeAppx.exe` 成功生成真正的 MSIX，`SignTool.exe` 成功签名；
- MSIX 内签名证书与发布的 `.cer` 指纹一致，构建后私钥未保留。

尚未声称已验证：

- 真实 Ollama、LM Studio、vLLM 和 LocalAI 的所有版本；
- Code helper 下载、完整 Cowork 工具循环；
- Anthropic 专有 beta content block；
- tokenizer 精确 token 数；
- 完全离线运行；
- 用户在 Windows 安全警告中接受当前用户根证书信任后的 MSIX 端到端安装。非交互验证确认只放入 `TrustedPeople` 会以 `0x800B0109` 失败，因此安装脚本明确使用 `CurrentUser\\Root` 并保留系统确认框。

完整 REA 证据和运行记录见：

[`docs/claude-exe-runtime-verification.md`](../docs/claude-exe-runtime-verification.md)（免证书 EXE，本次默认交付形态）

[`docs/claude-msix-4.4212-third-party-zero-config.md`](../docs/claude-msix-4.4212-third-party-zero-config.md)（MSIX / 松散包路径）
