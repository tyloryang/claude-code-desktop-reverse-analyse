/**
 * @file DlpSecurityFilter.ts
 * @description Analyst sketch of sensitive-file name and path matching clues (DLP-related)
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (Static REA Analysis)
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
 */


export namespace DlpSecurityFilter {
  // Sensitive file extensions & filename patterns blacklist
  export const SENSITIVE_EXTENSIONS = new Set([
    '.pem', '.key', '.p12', '.pfx', '.keychain', '.keychain-db',
    '.kdbx', '.ppk', '.jks', '.p8', '.ovpn'
  ]);

  export const SENSITIVE_FILENAMES = new Set([
    'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    'cookies', 'cookies.sqlite', 'login data', 'logins.json',
    'web data', 'local state', 'key4.db', 'cert9.db', 'signons.sqlite',
    'credentials.db', 'msal_token_cache.json', '.netrc', '.git-credentials',
    '.npmrc', '.pypirc', '.pgpass', '.my.cnf', '.databrickscfg', '.vault-token',
    'wallet.dat', 'kubeconfig'
  ]);

  export const SENSITIVE_PATH_PREFIXES = [
    '.aws/', '.ssh/', '.gnupg/', '.kube/', '.config/gcloud/'
  ];

  /**
   * Illustrative matcher based on selected static clues; this is not a validated product
   * policy, complete sensitive-file list, or security control.
   */
  export function isFileAccessPermitted(filePath: string): { permitted: boolean; reason?: string } {
    if (!filePath) return { permitted: true };

    // Normalize path separators and lower-case for robust matching
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();

    // 1. Check NTFS Alternate Data Stream (ADS) traversal attempts (e.g. file.txt:secret.key)
    if (normalized.includes(':') && !/^[a-z]:\//i.test(normalized)) {
      return { permitted: false, reason: 'NTFS Alternate Data Stream (ADS) access detected and blocked' };
    }

    // 2. Extract filename and extension
    const parts = normalized.split('/');
    const filename = parts[parts.length - 1] || '';

    // 3. Check exact filenames or .env patterns
    if (SENSITIVE_FILENAMES.has(filename) || filename.startsWith('.env')) {
      return { permitted: false, reason: `Blocked sensitive configuration/credential file: ${filename}` };
    }

    // 4. Check file extensions
    const ext = filename.substring(filename.lastIndexOf('.'));
    if (SENSITIVE_EXTENSIONS.has(ext)) {
      return { permitted: false, reason: `Blocked sensitive private key/certificate extension: ${ext}` };
    }

    // 5. Check directory prefixes
    for (const prefix of SENSITIVE_PATH_PREFIXES) {
      if (normalized.includes(prefix)) {
        return { permitted: false, reason: `Blocked access inside sensitive directory profile: ${prefix}` };
      }
    }

    return { permitted: true };
  }
}
