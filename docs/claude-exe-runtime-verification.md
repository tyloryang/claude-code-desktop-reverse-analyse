# Claude Third-Party Zero-Config EXE 运行面验证

日期：2026-11-04。平台：Windows 11 Pro 10.0.26200，x64。

**结论：PASS**

**声明：** `Claude-ThirdParty-ZeroConfig.exe` 应当在不安装、不注册、不导入任何证书、不要求管理员或开发者模式的前提下启动 Claude Desktop 4.4212 研究构建；应用启动时即加载隔离配置（`deploymentMode: "3p"` 与 gateway profile），第三方模型进入模型选择器，重复启动不干扰第一实例，官方 `Claude-3p` 配置、系统证书库与包注册保持不变。

**方式：** `zero-config/test/verify-exe.ps1` 直接以双击语义运行 EXE（`Start-Process`，无参数），并用真实运行产物（进程、HTTP 端点、应用日志、窗口截图、证书库快照）断言。上游用 `zero-config/test/runtime-mock-openai.cjs` 在 `127.0.0.1:8000/v1` 提供 OpenAI-compatible mock。

## 被测产物

```text
Claude-ThirdParty-ZeroConfig.exe        272,805,376 字节
SHA-256  87396ba11428a6e587739a688efc555d5b4f4ee656f8e3039df471d7879a0a66
内嵌 payload.zip SHA-256  e9f60c80af635b583915f59b574410f9519ad26a5614de19eb989b84be5cf535
```

解压后的 `app/Claude.exe`（`e297ea2d…`）经 REA `inspect_electron_fuses` 复核（证据 `ev_58379644bcb9bc08ad7648db77e1d2a82544631833f315397cd87116fb314f9a`）：

```text
EnableEmbeddedAsarIntegrityValidation  disabled   ← 允许修改 app.asar
OnlyLoadAppFromAsar                  enabled    ← 仍以 app.asar 为应用入口
RunAsNode / EnableNodeCliInspectArguments         disabled   ← 与官方包一致，未放宽
```

## 步骤

1. ✅ 双击语义启动 EXE（`Start-Process`，无任何环境变量注入到应用之外） → 启动器解压 272 MB payload 到 `%LOCALAPPDATA%\Claude-ThirdParty-ZeroConfig\versions\<hash16>\app` 并记录 `started pid=`，退出码 0。
2. ✅ `kernel32!GetPackageFullName` 对应用进程返回 `15700`（`ERROR_PACKAGE_NOT_FOUND`） → 进程确认无 MSIX 包身份；应用日志同时出现 `[windows-app-job] skipped: not an MSIX install`。
3. ✅ 应用日志 `[managedConfig] configuration at launch { type: 'local', remote: false, managedKeys: [] }` → 启动时即加载隔离 gateway 配置，而不是空配置（`type: 'none'`，此前失败形态）。
4. ✅ `Loaded app://localhost` 且 `inference apiHost=http://127.0.0.1:51095` → 主窗口加载研究构建 UI 并将推理路由指向自己的隔离网关。
5. ✅ 模型进入选择器：`Model discovery: 1 found in 79ms; picker = 1 (discovery)` → 补丁后的模型校验器让 `runtime-test-model`（非 Anthropic 命名）通过客户端黑名单。修复前同一位置为 `picker = 0 (empty)`。
6. ✅ 经应用实际使用的网关端到端请求：非流式 `/v1/messages` 返回 `runtime message ok`；流式 `/v1/messages` 合并两个 OpenAI delta 得到 `runtime stream ok`，末事件 `message_stop`；`/v1/models` 返回 `runtime-test-model`。
7. ✅ 重复启动同一 EXE：第二个实例探测到已在服务的网关并复用（`gateway-already-running`），`inferenceGatewayBaseUrl` 未被改写，第一实例进程仍然存活；`zero-config.log` 全程只有一个 `started` 事件（单一网关保证）。
8. ✅ UI 存在性：UI Automation 找到标题为 `Claude` 的可见窗口（宽 > 300），`PrintWindow` 截图保存为 `window.png`。
9. ✅ 隔离断言：验证前后 `CurrentUser\Root` 与 `CurrentUser\TrustedPeople` 快照逐字节一致；官方 `%LOCALAPPDATA%\Claude-3p` 的 `claude_desktop_config.json` 与 `configLibrary` 哈希不变；`Get-AppxPackage ClaudeThirdPartyZeroConfig` 前后均为空。

### 试探

- 🔍 首选端口被占用（前一次运行的 TIME_WAIT 残留）：网关退到随机端口，测试改为从隔离 profile 读取实际 `inferenceGatewayBaseUrl` 而不是猜测端口 → 断言仍然成立。
- 🔍 重复启动（第 7 步）本身即对"两个实例同时启动"的试探；第一实例的网关与聊天数据未被第二实例干扰。
- 🔍 启动器缓存复用：第二次启动不再解压（`launcher.log` 只追加一条 `started`），验证同一用户同一构建的互斥锁与缓存路径。
- 🔍 修复回归前的失败样本保留在 `dist/exe-runtime-check-3/`：`configuration at launch { type: 'none' }`，与修复后的 check-4/check-5 形成对照。

## 根因与修复（本轮代码变更）

失败形态：`type: 'none'` + `Loaded https://claude.ai`。证据链：

1. `index.pre.js` 在 Electron 主进程同步求值阶段读取 `claude_desktop_config.json` 与 `configLibrary/_meta.json`（`p0()`/`_0()`/`h4()` 均为同步 `readFileSync`）。
2. 上一版 `bootstrap.cjs` 把 `ensureZeroConfigProfile` 放在"探测已有网关"的 `await fetch` 之后，profile 写盘（17:00:59.386）晚于应用读配置。
3. 修复：profile 与 `deploymentMode` 必须在 `start()` 的第一个 `await` 之前同步写盘；已有 profile 时沿用其地址（不重写活网关端口）；探测到活网关则复用；否则才 bind 端口。
4. 测试侧修复：网关地址一律读自隔离 profile（真实绑定端口），不再从 `TcpListener` 猜测；新增 `picker > 0` 与 `type: 'local'` 断言，防止假绿。

## 报告摘录

```json
{
  "status": "PASS",
  "packageIdentityResult": 15700,
  "windowTitle": "Claude",
  "gateway": "http://127.0.0.1:51095",
  "models": ["runtime-test-model"],
  "nonStreaming": "runtime message ok",
  "streaming": "message_stop",
  "duplicateLaunch": "preserved original gateway",
  "officialConfiguration": "unchanged",
  "certificateStores": "unchanged",
  "packageRegistration": "unchanged"
}
```

## 边界与残余风险

- 上游是 mock OpenAI 服务；真实 Ollama / LM Studio / vLLM / LocalAI 各版本的全部能力仍不在本次断言内。
- `picker = 1` 证明模型通过了客户端过滤进入选择器；UI 内逐条聊天往返由应用自身的推理路径承担，本文只断言到该路径的 HTTP 端到端等价请求与窗口存在性，未逐帧录制 UI 点击。
- Code helper 下载与完整 Cowork 工具循环未验证（与 MSIX 文档同一边界）。
- SmartScreen / 杀软对未签名 EXE 的提示与本报告无关，属于用户环境的独立策略。
- 启动器内嵌 SHA-256 是一致性检查，不是数字签名，不证明发布者身份。
