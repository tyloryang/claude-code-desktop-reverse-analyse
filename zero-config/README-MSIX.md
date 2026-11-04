# Claude Desktop 第三方模型自签名 MSIX

## 安装

下载以下文件并放在同一目录：

- `Claude-ThirdParty-ZeroConfig-x64.msix`
- `Claude-ThirdParty-ZeroConfig.cer`
- `Install-Claude-ThirdParty-MSIX.ps1`
- `Install-Claude-ThirdParty-MSIX.cmd`

双击 `Install-Claude-ThirdParty-MSIX.cmd`。脚本会：

1. 检查证书主题必须是 `CN=Claude Third-Party Zero Config`；
2. 检查 MSIX 内的签名证书与附带 `.cer` 指纹一致；
3. 显示证书主题和 SHA-1 指纹；
4. 要求输入 `TRUST`；
5. 明确警告后，把自签名公开证书导入当前用户的 `Root`（受信任的根证书颁发机构）；
6. 使用 `Add-AppxPackage` 安装 MSIX；
7. 从开始菜单应用身份启动 Claude Third-Party。

Windows AppX 部署要求自签名包的签名链根受信任；只放入 `TrustedPeople` 会以 `0x800B0109` 失败。此操作只影响当前用户，不写入 `LocalMachine`。此证书只用于签署独立研究构建，不是 Anthropic 证书。安装前应核对 GitHub Release 页面公布的 MSIX SHA-256；卸载时建议使用 `-RemoveCertificate` 一并移除该受信任根。

## 命令行安装

确认已经核对发布文件后，可以执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Claude-ThirdParty-MSIX.ps1 -TrustCertificate
```

`-TrustCertificate` 只跳过脚本自己的 `TRUST` 文本确认。Windows 仍会显示“安全警告”，要求用户明确确认把自签名证书加入当前用户受信任根；脚本不会隐藏或绕过该系统提示。

## 卸载

只卸载应用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-Claude-ThirdParty-MSIX.ps1
```

卸载应用并移除当前用户信任的发布证书：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-Claude-ThirdParty-MSIX.ps1 -RemoveCertificate
```

## 使用第三方模型

应用会自动探测：

- Ollama：`http://127.0.0.1:11434/v1`
- LM Studio：`http://127.0.0.1:1234/v1`
- vLLM：`http://127.0.0.1:8000/v1`
- LocalAI：`http://127.0.0.1:8080/v1`

自定义 OpenAI-compatible 服务：

```powershell
$env:CLAUDE_THIRD_PARTY_BASE_URL = 'https://provider.example.com/v1'
$env:CLAUDE_THIRD_PARTY_API_KEY = '<your-api-key>'
$env:CLAUDE_THIRD_PARTY_MODEL = 'provider-model-id'
```

完整 REA 解析、架构图和第三方功能流程图见仓库 `zero-config/README.md`。
