/**
 * @file ShellPtyManager.ts
 * @description Deobfuscated PTY Terminal Host Worker & Shell Manager
 * Origin: Claude Desktop index.chunk-DIEpbncU.js & ptyHostWorker.js
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
 */


export namespace ShellPtyManager {
  export interface PtySpawnOptions {
    file: string;
    args: string[];
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
  }

  /**
   * Manages terminal PTY utility process spawning, watchdog timers,
   * and fallback mechanisms (ConPTY / PowerShell / SSH broker).
   */
  export class ShellPtyHostController {
    private watchdogTimer: NodeJS.Timeout | null = null;
    private isAlive: boolean = false;

    constructor(private workerPath: string) {}

    /**
     * Initializes the utilityProcess worker with a 30-second heartbeat watchdog.
     */
    public startWatchdog(): void {
      this.isAlive = true;
      this.watchdogTimer = setInterval(() => {
        if (!this.isAlive) {
          console.warn('[ShellPtyHost] PTY worker unresponsive; triggering forced refork.');
          this.restartWorker();
        }
        this.isAlive = false; // Reset for next tick
      }, 30000);
    }

    public ping(): void {
      this.isAlive = true;
    }

    private restartWorker(): void {
      // Terminate existing unresponsive worker and refork ptyHostWorker.js
      this.stop();
      this.startWatchdog();
    }

    public stop(): void {
      if (this.watchdogTimer) {
        clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      this.isAlive = false;
    }

    /**
     * Builds SSH broker command for remote terminal sessions:
     * `ssh -t -o EscapeChar=none [-p port] [-i key] -- <nonce-cmd> && exec $SHELL -l`
     */
    public buildSshCommand(host: string, port?: number, identityKey?: string): string[] {
      const args = ['-t', '-o', 'EscapeChar=none'];
      if (port) {
        args.push('-p', port.toString());
      }
      if (identityKey) {
        args.push('-i', identityKey);
      }
      args.push('--', 'echo "[CCD] SSH Ready"; exec $SHELL -l');
      return args;
    }
  }
}
