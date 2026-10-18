/**
 * @file SessionEnvironmentBuilder.ts
 * @description Deobfuscated Code Helper Environment & Gateway Connection Builder
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (`bJ`, `anthropicWire`)
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
 */


export namespace SessionEnvironmentBuilder {
  export interface SessionConfig {
    apiHost: string;
    apiKey?: string;
    authToken?: string;
    authScheme: 'bearer' | 'x-api-key' | 'custom';
    providerLabel: string;
    managedByHost: boolean;
    gatewayBaseUrl?: string;
  }

  /**
   * Constructs the full environment variables dictionary for spawning the Claude Code helper CLI (`claude.exe`).
   */
  export function buildCodeHelperEnvironment(config: SessionConfig): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      CLAUDE_CODE_ENTRYPOINT: 'DESKTOP_APP',
      ANTHROPIC_BASE_URL: config.gatewayBaseUrl || config.apiHost,
    };

    // Clear raw auth variables prior to secure credential file injection
    env['ANTHROPIC_API_KEY'] = '';
    env['ANTHROPIC_AUTH_TOKEN'] = '';
    env['ANTHROPIC_CUSTOM_HEADERS'] = '';

    if (config.managedByHost) {
      env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] = '1';
      env['CLAUDE_CODE_USE_GATEWAY'] = '1';
    }

    // Append standard platform identifier header
    const existingHeaders = env['ANTHROPIC_CUSTOM_HEADERS'] || '';
    env['ANTHROPIC_CUSTOM_HEADERS'] = existingHeaders
      ? `${existingHeaders},anthropic-client-platform:DESKTOP_APP`
      : 'anthropic-client-platform:DESKTOP_APP';

    return env;
  }
}
