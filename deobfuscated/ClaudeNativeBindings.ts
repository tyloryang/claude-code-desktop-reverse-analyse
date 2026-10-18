/**
 * @file ClaudeNativeBindings.ts
 * @description Inferred type sketch for selected native-addon API names.
 * Origin: app.asar.unpacked/node_modules/@ant/claude-native/claude-native-binding.node
 *
 * The types below are not verified against an ABI or trusted native implementation.
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
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
  // 2. Directory-operation API names (*Beneath); ABI and behavior unverified
  // ==========================================

  /**
   * Names suggest root-relative directory operations. No implementation, path-containment
   * guarantee, symlink behavior, or Windows handle semantics are verified by this sketch.
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
  // 3. Inferred credential / hardware-related API names; implementation unverified
  // ==========================================

  export interface SystemSecurityApi {
    /** API name suggests DPAPI protection; implementation and data scope are unverified. */
    userDpapiProtect(plaintext: Buffer): Buffer;
    /** API name suggests DPAPI unprotection; implementation and data scope are unverified. */
    userDpapiUnprotect(ciphertext: Buffer): Buffer;

    /** API name suggests a Windows Hello prompt; behavior is unverified. */
    promptWindowsHello(title: string, subtitle: string): Promise<boolean>;
    cancelWindowsHello(): void;
    windowsHelloAvailability(): 'available' | 'notConfigured' | 'unsupported';

    /** API name suggests a hardware-key operation; provider and hardware backing are unverified. */
    hardwareKeyGetOrCreate(keyAlias: string): { publicKeyPem: string; isHardwareBacked: boolean };
    /** API name suggests signing; key storage and signing behavior are unverified. */
    hardwareKeySign(keyAlias: string, payload: Buffer): Buffer;
  }

  // ==========================================
  // 4. Inferred Job Object API names; call sites and behavior unverified
  // ==========================================

  export interface JobObjectIsolationApi {
    /**
     * Inferred API description from names only; this sketch does not verify call sites,
     * process membership, or child termination behavior.
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
