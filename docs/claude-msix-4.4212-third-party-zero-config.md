# Claude Desktop 4.4212 第三方模型免配置实现与验证（MSIX / 松散包路径）

> 当前默认交付已切换为免证书独立 EXE（`Claude-ThirdParty-ZeroConfig.exe`），其运行验证见 [claude-exe-runtime-verification.md](claude-exe-runtime-verification.md)。本文保留 MSIX 与松散注册包两条可选路径的实现与验证记录。

本文记录仓库当前 `Claude.msix` 的 REA 证据、第三方模型接入设计、构建方式和运行验证结果。结论只适用于本文列出的产物身份；REA 的 JavaScript 应用图覆盖不完整，未覆盖部分不会被解释为功能不存在。

## 产物身份

| 对象 | 版本或 SHA-256 | REA Evidence |
| --- | --- | --- |
| `Claude.msix` | MSIX `4.4212.0.0`；SHA-256 `5e7cd0edfe4a5561e6f69b0249757d23de752a74151e016fe81bc939ddc5439e` | `ev_30c308336d8867602a2b5ca3d96a813103331580118bd174157fe1c53f7be485` |
| `app.asar` | `@ant/desktop` `4.4212.0`；SHA-256 `f0058d0b13c4787a2f2c1684bbb48b7352efffc68a1e35d8ca574698afa90a63` | `ev_db006cd69078f668d1ad0764bb75a8f09179e4b4431043fb189a3d44d373df12` |
| 原始 `Claude.exe` | SHA-256 `f604ea91b306f0a92d8be8af7fdf2ad91c25a520da5aee3178adef593f89bde9` | `ev_c80969004464b25c2accc996eeff74c74dc170811bb0021435971a80f157dde5` |
| 最终修改后 `Claude.exe` | SHA-256 `e297ea2d3ad3a822725872063e172082da66ce8c7cd953e2bad0c309168e9986` | `ev_3d7e9256f8b027887a29c67e9b5af276f7118909b5ec7f9e054ab24b19881d19` |

`app/version` 为 `44.9.3`。REA JavaScript 分析读取 651 个相关文件，其中 586 个 JavaScript 文件成功解析；大体积压缩 bundle 触发资源上限，因此应用图与语义图均为部分覆盖。

## 静态观察

最新版主进程已包含完整的第三方部署分支，无需重写核心 bundle。

- 根配置 `claude_desktop_config.json` 通过 `deploymentMode: "3p"` 进入第三方模式。
- Windows 第三方数据目录原本为 `%LOCALAPPDATA%\\Claude-3p`，配置库位于 `configLibrary/`。
- gateway provider 支持 `inferenceGatewayBaseUrl`、`inferenceGatewayApiKey`、`inferenceGatewayAuthScheme`、`inferenceGatewayManagedClaudeCode` 和 `modelDiscoveryEnabled`。
- 模型发现请求为 `GET <baseUrl>/v1/models?limit=1000`。返回项可用 `anthropic_family_tier`、`is_family_default`、`display_name` 和 `max_input_tokens` 描述非 Anthropic 模型。
- 消息请求走 `/v1/messages`，token 计数走 `/v1/messages/count_tokens`。
- Code helper 和 Cowork 会话从 provider API host 构造 `ANTHROPIC_BASE_URL`，因此同一 gateway 可覆盖聊天与受管理的 Code helper 请求。
- 原始 Electron fuse 启用了 `EnableEmbeddedAsarIntegrityValidation` 和 `OnlyLoadAppFromAsar`。修改 `app.asar` 后必须处理前者；后者可以保留。

进一步检查入口 bundle 时还观察到：生产代码会删除未签名 E2E harness 提供的 `CLAUDE_USER_DATA_DIR`。因此仅设置环境变量不能稳定隔离第三方数据目录。

## 实现

源码位于 [`zero-config/`](../zero-config/)。实现不修改约 6.8 MB 的核心压缩 chunk，只在 `.vite/build/index.pre.js` 文件头注入非阻塞 bootstrap。

bootstrap 在 vendor 主进程初始化前完成以下工作：

1. 将 Electron `userData` 强制指向 `%LOCALAPPDATA%\\Claude-3p-ZeroConfig`，并拦截 vendor 后续对 `app.setPath('userData', ...)` 的重置。
2. 写入 `deploymentMode: "3p"`、配置库 metadata 和固定 gateway profile。
3. 在 `127.0.0.1` 启动本地 Anthropic Messages-compatible gateway；首选端口为 `42121`，占用时自动选择可用端口并更新 profile。
4. 按顺序探测显式环境变量、Ollama、LM Studio、vLLM 和 LocalAI。
5. 把 Anthropic Messages、content blocks、tools 和 SSE 事件转换为 OpenAI-compatible Chat Completions 格式。

本地 gateway 只监听回环地址。云端 API Key 从 `CLAUDE_THIRD_PARTY_API_KEY`、`OPENAI_API_KEY` 或 `OPENROUTER_API_KEY` 读取，不写入 Claude 配置；profile 中的 `local-zero-config` 只是 Claude Desktop 本地 gateway schema 所需的占位值。

## 为什么使用松散包注册

直接运行 MSIX 解包目录时，未修改的原始 `Claude.exe` 与修改版都会在 Chromium cache 权限错误后以状态码 0 退出。该对照说明问题不是注入代码，而是应用脱离 Windows package identity。

构建器因此先输出完整的松散包布局，而不是只复制 `app/`，再用该布局生成独立签名的 MSIX：

- 生成独立包名 `ClaudeThirdPartyZeroConfig` 的最小 manifest；
- 使用独立协议 `claude-3p` 和别名 `claude-3p-desktop.exe`，避免与官方 Claude 冲突；
- 保留 `runFullTrust`、`unvirtualizedResources` 与 `%LOCALAPPDATA%\\Claude-3p-ZeroConfig` 排除规则；
- 删除修改后失效的官方签名和 block map，不伪造 Anthropic 签名；
- 通过 `Add-AppxPackage -Register` 获得松散包 package identity；
- 通过 `IApplicationActivationManager` 激活松散包应用并返回真实 PID；
- 通过 Windows SDK `MakeAppx.exe` 生成真正的 MSIX；
- 用临时自签名代码签名证书签署 MSIX，只发布公开 `.cer` 并在构建后删除私钥。

## 构建与启动

```bash
npm --prefix zero-config test
```

```bash
npm --prefix zero-config run build
```

构建同时输出：

- `dist/Claude-ThirdParty-ZeroConfig-x64.msix`：真正的自签名 MSIX；
- `dist/Claude-ThirdParty-ZeroConfig.cer`：不含私钥的公开签名证书；
- `dist/Claude-ThirdParty-ZeroConfig-MSIX.zip`：MSIX、证书、安装/卸载脚本和说明；
- `dist/Claude-ThirdParty-Package/` 与同级 ZIP：松散包备用路径。

MSIX 安装器会核对签名证书指纹，并在用户明确确认后把自签名证书加入 `CurrentUser\\Root`；Windows 的根证书安全警告不会被绕过。松散包通过 `Start-Claude-ThirdParty.cmd` 注册并启动；如果返回 `0x80073CFF`，需要由用户手动启用 Windows Developer Mode。

## 验证结果

### 自动测试

`node --test` 共执行 6 个测试，全部通过：

- Anthropic 消息、图片块和 tools 到 OpenAI Chat Completions 的转换；
- OpenAI tool calls 到 Anthropic `tool_use` 的转换；
- 文本 SSE 事件序列；
- `Claude-3p` 配置预置与无关字段保留；
- 真实 HTTP 非流式转换；
- 真实 HTTP 流式 function call 转换。

### 真实应用入口

最终产物通过自带脚本注册并启动，激活器返回 PID `39432`。验证期间该进程持续存活，路径为 `dist/Claude-ThirdParty-Package/app/Claude.exe`。

运行中的注入 gateway 返回：

```text
GET /_claude_zero_config/health
status=200
{"ok":true,"service":"claude-third-party-zero-config","provider":null}
```

无本地模型服务时的主动试探返回明确错误：

```text
GET /v1/models
status=503
{"type":"error","error":{"type":"provider_unavailable","message":"No OpenAI-compatible local model server was found. Start Ollama, LM Studio, vLLM, or LocalAI and retry."}}
```

随后在 `127.0.0.1:8000/v1` 启动临时 OpenAI-compatible mock。运行中的应用自动发现模型：

```json
{
  "id": "runtime-test-model",
  "display_name": "runtime-test-model · vLLM",
  "anthropic_family_tier": "sonnet",
  "is_family_default": true
}
```

同一应用实例完成了两条端到端请求：

- 非流式 `/v1/messages` 返回 `runtime message ok`，usage 为 5 个输入 token、3 个输出 token。
- 流式 `/v1/messages` 把两个 OpenAI delta 合并为 `runtime stream ok`，末事件为 `message_stop`。

最终 REA fuse 观察确认：`EnableEmbeddedAsarIntegrityValidation` 为 disabled，`OnlyLoadAppFromAsar` 仍为 enabled。验证后已关闭 mock、卸载测试包注册并删除测试状态；`dist` 构建产物保留。

## 边界与残余风险

- 这是松散注册的研究构建，不是 Anthropic 签名的 MSIX。移动输出目录后需要重新运行注册脚本。
- `/v1/messages/count_tokens` 使用字符数近似，不等同于目标模型 tokenizer。
- tools、视觉、长上下文、reasoning 参数和结构化输出的最终能力取决于上游 OpenAI-compatible 服务。
- 当前转换覆盖常见文本、base64/URL 图片和 function tools；Anthropic 专有 beta content block 不保证可转换。
- `inferenceGatewayManagedClaudeCode: true` 已预置，但本文没有验证 Code helper 下载和完整 Cowork 工具循环。
- 静态 REA 结论来自部分 JavaScript 图覆盖；运行验证只覆盖本文列出的 Windows 11 本机路径与 mock 服务。
