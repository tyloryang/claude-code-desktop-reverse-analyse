Claude Desktop Third-Party Zero-Config Package
===============================================

1. Start an OpenAI-compatible local model server:
   - Ollama      http://127.0.0.1:11434/v1
   - LM Studio   http://127.0.0.1:1234/v1
   - vLLM        http://127.0.0.1:8000/v1
   - LocalAI     http://127.0.0.1:8080/v1
2. Run Start-Claude-ThirdParty.cmd.
3. The script registers this loose MSIX layout and starts the packaged app.
4. Claude Desktop automatically enters 3P gateway mode and discovers models.

If Add-AppxPackage reports 0x80073CFF, enable Windows Developer Mode manually,
then run Start-Claude-ThirdParty.cmd again. The script never changes that setting.

Optional environment variables:
  CLAUDE_THIRD_PARTY_BASE_URL   Custom OpenAI-compatible /v1 base URL
  CLAUDE_THIRD_PARTY_API_KEY    API key for that endpoint
  CLAUDE_THIRD_PARTY_MODEL      Force one upstream model ID
  CLAUDE_ZERO_CONFIG_PORT       Preferred local gateway port
  CLAUDE_ZERO_CONFIG_USER_DATA_DIR  Override the seeded config directory
  CLAUDE_ZERO_CONFIG_DISABLE=1  Start without the injected gateway

Local state is stored in %LOCALAPPDATA%\Claude-3p-ZeroConfig.
The injected gateway binds only to 127.0.0.1 and never stores the upstream API key.
Run Uninstall-Claude-ThirdParty.ps1 to remove the package registration.
This is an independently modified research build, not an official Anthropic release.
