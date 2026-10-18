/**
 * @file CodeHelperDownloader.ts
 * @description Deobfuscated Code Helper Downloader & BuildPin Version Manager
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (`installDirFor`, buildPin)
 */

export namespace CodeHelperDownloader {
  export interface BuildPinManifest {
    version: string;
    sdkWrapperVersion: string;
    platforms: Record<string, {
      binary: string;
      checksum: string;
      size: number;
      bundle?: boolean;
    }>;
  }

  const BASE_DOWNLOAD_URL = 'https://downloads.claude.ai/claude-code-releases';

  /**
   * Resolves the target storage directory for a specific helper binary version and checksum.
   * Format: {storageDir}/{version}/{checksum[:12]}
   */
  export function resolveInstallDirectory(storageDir: string, version: string, checksum: string): string {
    const shortHash = checksum.substring(0, 12);
    return `${storageDir}/${version}/${shortHash}`;
  }

  /**
   * Validates downloaded helper binary against expected SHA-256 checksum.
   */
  export async function verifyChecksum(buffer: ArrayBuffer, expectedChecksum: string): Promise<boolean> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.toLowerCase() === expectedChecksum.toLowerCase();
  }

  /**
   * Checks if local environment overrides the helper binary via `CLAUDE_CODE_LOCAL_BINARY`.
   */
  export function getLocalBinaryOverride(): string | null {
    const override = process.env['CLAUDE_CODE_LOCAL_BINARY'];
    if (override) {
      console.log(`[CCD] LOCAL OVERRIDE active: using binary at ${override}`);
      return override;
    }
    return null;
  }
}
