/**
 * @file ManagedConfigResolver.ts
 * @description Deobfuscated Windows Registry Policy & Managed Settings Resolver
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (`SPn()`, `QUr()`, `SettingsResolver`)
 */

export namespace ManagedConfigResolver {
  export interface ManagedPolicy {
    disableAutoUpdates?: boolean;
    disableEssentialTelemetry?: boolean;
    disableNonessentialTelemetry?: boolean;
    disableNonessentialServices?: boolean;
    modelCatalogEnabled?: boolean;
    modelCatalogUrl?: string;
    disableDesktopLocalSessions?: boolean;
    thirdPartyMode?: boolean;
  }

  /**
   * Evaluates Windows registry policy paths:
   * - Desktop: HKLM/HKCU\SOFTWARE\Policies\Claude
   * - Code Session: SOFTWARE\Policies\ClaudeCode
   */
  export function evaluateRegistryPolicies(registryValues: Record<string, any>): ManagedPolicy {
    return {
      disableAutoUpdates: Boolean(registryValues['disableAutoUpdates']),
      disableEssentialTelemetry: Boolean(registryValues['disableEssentialTelemetry']),
      disableNonessentialTelemetry: Boolean(registryValues['disableNonessentialTelemetry']),
      disableNonessentialServices: Boolean(registryValues['disableNonessentialServices']),
      modelCatalogEnabled: registryValues['modelCatalogEnabled'] !== false,
      disableDesktopLocalSessions: Boolean(registryValues['disableDesktopLocalSessions']),
      thirdPartyMode: Boolean(registryValues['thirdPartyMode'])
    };
  }

  /**
   * Maps SDK settings sources to Claude Code Desktop hierarchy:
   * user < project < projectLocal < managed
   */
  export function resolveSettingsTier(source: string): 'user' | 'project' | 'projectLocal' | 'managed' | null {
    switch (source) {
      case 'user':
      case 'project':
      case 'projectLocal':
      case 'managed':
        return source;
      default:
        console.warn(`[SettingsResolver] Ignoring unsupported settings source: ${source}`);
        return null;
    }
  }
}
