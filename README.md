# Claude Desktop Windows MSIX — Reverse Engineering & Architecture Analysis

> **Target Version**: Claude Desktop `2.37337.1` (Windows MSIX)  
> **Repository**: [https://github.com/tyloryang/claude-code-desktop-reverse-analyse.git](https://github.com/tyloryang/claude-code-desktop-reverse-analyse.git)  
> **Analysis Methodology**: Static REA (Reverse Engineering Artifact) analysis of `app.asar`, native binaries, and unpacked Web SPA resources.

---

## 🏗️ Architectural Overview

Claude Desktop follows a hybrid **Electron Multi-Process + Independent CLI Agent Engine + Virtualized Sandbox** architecture:

```
┌────────────────────────────────────────────────────────────────────┐
│  Claude Desktop (Electron MSIX: Claude_2.37337.1.0_x64)            │
├────────────────────────────────────────────────────────────────────┤
│  · Main Process (Node.js) - Orchestrates lifecycle, IPC, policies   │
│  · Renderer Windows (sandbox:!0) - Main UI, Cowork, Code tabs      │
│  · Utility Processes - pty-host (node-pty/ConPTY) & file-index     │
│  · Rust Native Binding (@ant/claude-native) - 100+ Win32 APIs      │
│  · Code Helper CLI (claude.exe) - 217MB Bun-compiled binary        │
└────────────────────────────────────────────────────────────────────┘
```

---

## 📂 Deobfuscated Core Modules (`deobfuscated/`)

The repository includes fully deobfuscated and structured TypeScript implementations of the core subsystems extracted from the obfuscated ASAR chunks:

1. **[DlpSecurityFilter.ts](deobfuscated/DlpSecurityFilter.ts)**  
   * Data Loss Prevention (DLP) & Sensitive File Blacklist filter. Blocks private keys (`.pem`, `.key`, `.ppk`), SSH keys (`id_rsa`), credential databases, `.env` files, and NTFS Alternate Data Stream (ADS) traversal attacks.
2. **[ThirdPartyMockRouter.ts](deobfuscated/ThirdPartyMockRouter.ts)**  
   * Custom-3P local API stub and protocol router (`app://localhost`). Intercepts local requests (`/api/bootstrap`, `/i18n/*`, etc.) to run entirely offline without external egress.
3. **[SessionEnvironmentBuilder.ts](deobfuscated/SessionEnvironmentBuilder.ts)**  
   * Code helper CLI environment builder (`bJ()`). Constructs `ANTHROPIC_BASE_URL`, injects gateway parameters, clears raw auth tokens for secure file staging, and sets host-managed flags.
4. **[AgentSdkControlProtocol.ts](deobfuscated/AgentSdkControlProtocol.ts)**  
   * Agent SDK & CLI helper bidirectional `stream-json` control protocol handler. Covers all 59 control sub-types including `can_use_tool` permissions and `host_auth_token_refresh` runtime token renewal.
5. **[ShellPtyManager.ts](deobfuscated/ShellPtyManager.ts)**  
   * Terminal PTY host controller. Manages `utilityProcess.fork` of `ptyHostWorker.js` with a 30s heartbeat watchdog, ConPTY/PowerShell fallback, and SSH broker/proxy integration.
6. **[CodeHelperDownloader.ts](deobfuscated/CodeHelperDownloader.ts)**  
   * Code Helper version manager & BuildPin validator. Handles release manifest checks (`downloads.claude.ai`), SHA-256 binary verification, version-hash directory routing, and `CLAUDE_CODE_LOCAL_BINARY` overrides.
7. **[ManagedConfigResolver.ts](deobfuscated/ManagedConfigResolver.ts)**  
   * Windows Registry Policy & Managed Settings resolver. Reads enterprise GPO/policies from `HKLM\SOFTWARE\Policies\Claude` and `ClaudeCode`, mapping SDK settings tiers (`user < project < projectLocal < managed`).
8. **[CoworkVmManager.ts](deobfuscated/CoworkVmManager.ts)**  
   * Cowork VM sandbox & HCS virtualization controller. Interrogates Host Compute System status, applies differential image patches (`applyVmImageDelta`), and enforces MITM proxy credential whitelisting (`NSn`).

---

## 🛡️ Key Security & System Subsystems

* **Windows Native Extension (`@ant/claude-native`)**: NAPI-RS native DLL providing Computer Use automation (mouse/keyboard injection), Directory Traversal Defense (`*Beneath`), Windows Hello biometrics, TPM cryptographic key signing (`hardwareKeySign`), and Windows Job Object containerization.
* **Built-in MCP Server Ecosystem**: 12 native MCP servers (`ccd_view`, `ccd_window`, `ccd_session`, `ccd_session_mgmt`, `ccd_sidebar`, `ccd_settings`, `ccd_host`, `ccd_pr`, `terminal`, `scheduled-tasks`, `Claude Browser`) plus GitHub MCP and Office 365 Graph MCP.
* **Claude Design System (CDS)**: 1045 semantic `--cds-*` design tokens, semantic dark/light mode mapping, optical font GRADE compensation, and Anthropic variable fonts (`AnthropicSans`, `AnthropicSerif`).

---

## 🚀 Repository Usage

Clone the repository and inspect the deobfuscated TypeScript modules and full architecture report:

```bash
git clone https://github.com/tyloryang/claude-code-desktop-reverse-analyse.git
cd claude-code-desktop-reverse-analyse
```
