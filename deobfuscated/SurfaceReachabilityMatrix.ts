/**
 * @file SurfaceReachabilityMatrix.ts
 * @description Analyst sketch of execution-target matrix and surface-policy names
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (`vze` surface matrix, `bze` policy gates)
 *
 * The matrix and policy decisions below are an analyst reconstruction, not verified
 * routing behavior or a security boundary.
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
 */


export namespace SurfaceReachabilityMatrix {
  export type SurfaceType = 'chat' | 'code' | 'codeRoutines' | 'cowork' | 'coworkRoutines';
  export type ExecutionTarget = 'device' | 'sshHost' | 'anthropicCloud' | 'selfHostedCloud';

  export interface SurfaceCapability {
    device: boolean;
    sshHost?: boolean;
    cloud?: ('anthropic' | 'self-hosted')[];
  }

  /**
   * Global execution matrix vze extracted from main chunk
   */
  export const SURFACE_MATRIX: Record<SurfaceType, SurfaceCapability> = {
    code: {
      device: true,
      sshHost: true,
      cloud: ['anthropic', 'self-hosted']
    },
    codeRoutines: {
      device: true,
      cloud: ['anthropic', 'self-hosted']
    },
    cowork: {
      device: true, // static matrix value; execution path was not verified
      cloud: ['anthropic', 'self-hosted']
    },
    coworkRoutines: {
      device: true,
      cloud: ['anthropic', 'self-hosted']
    },
    chat: {
      device: true
    }
  };

  export interface PolicyEvaluationContext {
    codeLocalPolicy?: 'enabled' | 'disabled';
    isManagedSettingsValid: boolean;
    isSelfHostedOnly: boolean;
    isVirtualizationAvailable: boolean;
  }

  /**
   * Evaluates policy blockades (bze) to determine if a surface can run on a target
   */
  export function canExecute(surface: SurfaceType, target: ExecutionTarget, ctx: PolicyEvaluationContext): { allowed: boolean; reason?: string } {
    const capability = SURFACE_MATRIX[surface];
    if (!capability) {
      return { allowed: false, reason: `Unknown surface: ${surface}` };
    }

    // 1. Check corrupt or unreadable enterprise policy
    if (!ctx.isManagedSettingsValid) {
      return { allowed: false, reason: 'managed-settings-unreadable: enterprise policy configuration is corrupt' };
    }

    // 2. Check local execution disablement (e.g. enterprise lockdown)
    if (target === 'device' && ctx.codeLocalPolicy === 'disabled' && (surface === 'code' || surface === 'codeRoutines')) {
      return { allowed: false, reason: 'disableDesktopLocalSessions: local device execution blocked by enterprise policy' };
    }

    // 3. Check Cowork VM requirement
    if (surface === 'cowork' && target === 'device' && !ctx.isVirtualizationAvailable) {
      return { allowed: false, reason: 'VirtualMachinePlatform is required for local Cowork execution' };
    }

    // 4. Check self-hosted cloud restrictions
    if (ctx.isSelfHostedOnly && target === 'anthropicCloud') {
      return { allowed: false, reason: 'self-hosted-only: routing to Anthropic public cloud is forbidden' };
    }

    // 5. Evaluate target compatibility against vze
    switch (target) {
      case 'device':
        return { allowed: capability.device };
      case 'sshHost':
        return { allowed: Boolean(capability.sshHost) };
      case 'anthropicCloud':
        return { allowed: Boolean(capability.cloud?.includes('anthropic')) };
      case 'selfHostedCloud':
        return { allowed: Boolean(capability.cloud?.includes('self-hosted')) };
      default:
        return { allowed: false, reason: `Unsupported target: ${target}` };
    }
  }
}
