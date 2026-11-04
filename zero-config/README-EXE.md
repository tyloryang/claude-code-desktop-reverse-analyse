# 无需导入证书的 EXE 版

## 使用

双击 `Claude-ThirdParty-ZeroConfig.exe`。首次运行会显示解压进度，随后启动 Claude Third-Party；后续运行复用同一构建的缓存。

- 不运行 `Add-AppxPackage`，不注册 MSIX。
- 不创建或导入证书，不要求管理员权限或开发者模式。
- 这是非官方、未签名的研究构建。Windows SmartScreen、杀毒软件或组织策略仍可能提示或阻止运行；启动器不会绕过这些保护。
- “免配置”仅指自动接入常见本地模型服务，不附送模型。本机仍须启动 Ollama、LM Studio、vLLM 或 LocalAI 并加载模型。
- 自定义云服务仍需要提供地址、模型 ID 和自己的 API Key。环境变量使用方法见 [完整手册](README.md)。

首次启动需要用户目录有足够空间存放解压后的应用。单文件 EXE 本身不需要 Node.js、Python 或 Windows SDK；启动器使用 Windows 11 自带的 .NET Framework 4.x。

## 存放位置

- 应用缓存：`%LOCALAPPDATA%\Claude-ThirdParty-ZeroConfig\versions\<payload-sha256前16位>\app`
- 启动器日志：`%LOCALAPPDATA%\Claude-ThirdParty-ZeroConfig\launcher.log`
- 独立配置和聊天数据：`%LOCALAPPDATA%\Claude-3p-ZeroConfig`

注意这两个目录名称不同：`Claude-ThirdParty-ZeroConfig` 是解压缓存，`Claude-3p-ZeroConfig` 是用户数据。不要删除官方客户端的 `Claude-3p` 目录。

无需 Windows 卸载操作。关闭此研究版后，删除下载的 EXE 和应用缓存目录即可；用户数据默认保留，如需删除聊天记录和配置，请自行删除独立用户数据目录。

旧 MSIX 安装失败或已安装不影响 EXE 不导入证书的性质；本启动器不会自动卸载旧包或移除用户已经信任的证书。

## 构建

在仓库根目录执行：

```bash
npm --prefix zero-config run build:exe
```

输入为仓库的 `Claude.msix`。构建只生成独立 EXE，不调用 MakeAppx、SignTool 或证书命令。构建机器需要 Node.js 22+ 和 Windows .NET Framework C# 编译器；ASAR/fuse 工具沿用现有 npx 构建流程。

构建器修改两处配置目录选择函数，使它们在环境变量被原程序清理之后仍指向独立目录；匹配不到或出现多个候选时立即失败，避免将补丁误用于新版本。不会伪造 Windows 包身份。

启动器校验内嵌 ZIP 的 SHA-256，在独立临时目录解压成功后才发布缓存，并使用互斥锁串行化同一用户同一构建的解压过程。内嵌摘要用于一致性检查，不是数字签名，也不能证明发布者身份。

## 验证范围

实际启动和请求验证记录见仓库 `docs/claude-exe-runtime-verification.md`。Code helper、Cowork 和所有第三方服务版本的完整功能兼容性不在便携启动验证的保证范围内。
