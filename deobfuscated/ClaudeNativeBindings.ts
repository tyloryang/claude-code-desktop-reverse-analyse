/**
 * @file ClaudeNativeBindings.ts
 * @description Deobfuscated Native Rust Addon Interface (@ant/claude-native)
 * Origin: app.asar.unpacked/node_modules/@ant/claude-native/claude-native-binding.node
 *
 * Based on NAPI-RS compiled binaries exporting 100+ Win32 kernel, security,
 * and display automation APIs for Windows.
 */

export namespace ClaudeNativeBindings {
  // ==========================================
  // 1. Computer Use (Screen & Input Automation)
  // ==========================================

  export interface DisplayInfo {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
    isPrimary: boolean;
  }

  export interface WindowRect {
    handle: number;
    title: string;
    processId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    isVisible: boolean;
  }

  export interface MouseButtonEvent {
    button: 'left' | 'right' | 'middle';
    down: boolean;
  }

  export interface NativeComputerUseApi {
    cuListDisplays(): DisplayInfo[];
    cuDisplayForPid(pid: number): DisplayInfo | null;
    cuListOpenWindows(): WindowRect[];
    cuMaskedWindowRects(excludePids: number[]): WindowRect[];
    cuExcludedWindowRects(): WindowRect[];
    moveMouse(x: number, y: number): void;
    mouseButton(button: 'left' | 'right' | 'middle', action: 'down' | 'up' | 'click'): void;
    mouseScroll(deltaX: number, deltaY: number): void;
    typeText(text: string): void;
    typeTextPaced(text: string, delayMs: number): void;
    cuGetAppIcon(exePath: string): Buffer | null;
    cuListInstalledApps(): Array<{ name: string; path: string; iconBase64?: string }>;
    cuFocusedControl(): { handle: number; className: string; text: string } | null;
    cuAppUnderPoint(x: number, y: number): { pid: number; exePath: string } | null;
  }

  // ==========================================
  // 2. Kernel-Level Path Traversal Defense (*Beneath)
  // ==========================================

  /**
   * Prevents directory traversal attacks (symlink dereference, `..\..\` path hops)
   * at the Windows NT handle level by strictly pinning operations beneath a root file descriptor.
   */
  export interface DirectoryTraversalDefenseApi {
    openRootDir(absoluteRootPath: string): number; // returns root directory handle
    openBeneath(rootFd: number, relativeSubpath: string, flags: number, mode?: number): number;
    statBeneath(rootFd: number, relativeSubpath: string): { isDirectory: boolean; isFile: boolean; size: number; mtimeMs: number };
    mkdirBeneath(rootFd: number, relativeSubpath: string, recursive: boolean): void;
    renameBeneath(rootFd: number, oldRelativeSubpath: string, newRelativeSubpath: string): void;
    rmdirBeneath(rootFd: number, relativeSubpath: string): void;
    unlinkBeneath(rootFd: number, relativeSubpath: string): void;
    closeRootDir(rootFd: number): void;
  }

  // ==========================================
  // 3. System Credentials & TPM Hardware Attestation
  // ==========================================

  export interface SystemSecurityApi {
    /** Encrypts arbitrary buffer via Windows Data Protection API (DPAPI) */
    userDpapiProtect(plaintext: Buffer): Buffer;
    /** Decrypts DPAPI-protected ciphertext using current Windows user session credentials */
    userDpapiUnprotect(ciphertext: Buffer): Buffer;

    /** Requests biometric authentication prompt via Windows Hello */
    promptWindowsHello(title: string, subtitle: string): Promise<boolean>;
    cancelWindowsHello(): void;
    windowsHelloAvailability(): 'available' | 'notConfigured' | 'unsupported';

    /** Generates or loads client key pair inside TPM via Windows Platform Crypto Provider */
    hardwareKeyGetOrCreate(keyAlias: string): { publicKeyPem: string; isHardwareBacked: boolean };
    /** Signs payload with TPM-backed private key */
    hardwareKeySign(keyAlias: string, payload: Buffer): Buffer;
  }

  // ==========================================
  // 4. Windows Job Object Process Containment
  // ==========================================

  export interface JobObjectIsolationApi {
    /**
     * Binds child CLI process (claude.exe) into the parent application's Windows Job Object.
     * Ensures all subprocesses terminate cleanly when Claude Desktop exits or crashes.
     */
    joinAppJob(childPid: number): boolean;
    isProcessInAppJob(pid: number): boolean;
  }

  // ==========================================
  // 5. Host Compute System (HCS) & Hyper-V
  // ==========================================

  export interface HyperVContainerControlApi {
    getHcsStatus(): { isHcsAvailable: boolean; vmpInstalled: boolean; hyperVRunning: boolean };
    enableWindowsOptionalFeature(featureName: 'VirtualMachinePlatform' | 'Microsoft-Hyper-V'): Promise<{ rebootRequired: boolean }>;
  }

  // ==========================================
  // 6. Direct Win32 Registry Access (No Subprocess)
  // ==========================================

  export interface NativeRegistryApi {
    readRegistryValues(rootKey: 'HKLM' | 'HKCU', subKey: string): Record<string, string | number | boolean>;
    writeRegistryValue(rootKey: 'HKLM' | 'HKCU', subKey: string, valueName: string, data: string): void;
    writeRegistryDword(rootKey: 'HKLM' | 'HKCU', subKey: string, valueName: string, data: number): void;
    deleteRegistryKey(rootKey: 'HKLM' | 'HKCU', subKey: string): void;
  }

  /**
   * Consolidated Claude Native Binding contract
   */
  export type ClaudeNativeBindingModule =
    NativeComputerUseApi &
    DirectoryTraversalDefenseApi &
    SystemSecurityApi &
    JobObjectIsolationApi &
    HyperVContainerControlApi &
    NativeRegistryApi;
}
