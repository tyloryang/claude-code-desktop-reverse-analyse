# TypeScript 分析重建稿说明

`deobfuscated/` 中的 13 个 TypeScript 文件是根据 Electron/ASAR、解包 bundle 和 REA 静态线索编写的阅读辅助稿。它们不是 Anthropic 原始源码、REA 自动生成的反编译结果或可直接替代产品的实现。命名、类型、控制流和安全语义可能经过推断或简化；没有进行编译、单元测试或运行时验证。

## 已知缺口

- **HostLoopProcessManager.ts**：示意稿将 token 写入临时文件并打开 FD，随后只以三个标准 pipe 调用 `spawn`，未将额外 FD 加入子进程 stdio。环境变量中的 FD 数字不能单独证明子进程继承了该描述符。暂存失败时示意稿将 token 放入 `ANTHROPIC_AUTH_TOKEN` 环境变量；稿内没有 Job Object 绑定调用，只有 `taskkill` 路径。不能作为安全凭据传递或进程隔离实现。
- **BuiltinMcpServers.ts**：只定义七个 schema 条目；dispatch 分支没有调用具体 handler，却会返回通用成功结果。不能视为完整的 12 服务目录或可执行 MCP dispatcher。
- **ThirdPartyMockRouter.ts**：注册函数在草图中只输出日志，未实现 Electron 协议注册；少数本地 stub 也不能证明整个进程的出站网络被阻断。
- **ClaudeNativeBindings.ts**：接口声明只是 API 名称/形态草图。当前 MSIX 样本有原生文件完整性矛盾，不能据此确认接口签名、功能或安全效果。

## 如何引用这些文件

架构结论应优先引用 `rea-architecture-frontend-deep-dive.md`、`claude-desktop-architecture.md` 中对应版本的 REA Evidence、原始包清单与静态片段，并说明观察、推断和未验证项。不要把本目录的伪代码作为厂商源码引用，也不要用于生产安全控制。