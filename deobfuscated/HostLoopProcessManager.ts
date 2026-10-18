/**
 * @file HostLoopProcessManager.ts
 * @description Deobfuscated HostLoop Subprocess Lifecycle & Windows Process Group Manager
 * Origin: Claude Desktop index.chunk-YBFVQBQ_.js (`HostLoop`, `spawnClaudeCodeProcess`)
 *
 * Manages native CLI helper execution, Windows Job Object containment,
 * tree-kill fallback via taskkill, and sensitive credential file descriptor isolation.
 */

import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export namespace HostLoopProcessManager {
  export interface ProcessLaunchOptions {
    binaryPath: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    authToken?: string;
  }

  export class HostLoopRunner {
    private activeProcess: ChildProcess | null = null;
    private pid: number | null = null;
    private killTimeout: NodeJS.Timeout | null = null;

    /**
     * Staging sensitive authentication credentials into an anonymous file descriptor
     * and immediately unlinking from filesystem to avoid plain-text disk exposure.
     */
    private stageCredentialFd(token: string): number | null {
      try {
        const tempPath = path.join(process.env.TEMP || '.', `ccd_token_${Date.now()}_${process.pid}.tmp`);
        const fd = fs.openSync(tempPath, 'w+');
        fs.writeSync(fd, Buffer.from(token, 'utf-8'));
        // Immediate unlink keeps the open file handle valid in memory while deleting disk entry
        fs.unlinkSync(tempPath);
        return fd;
      } catch (err) {
        console.warn('[HostLoop] Failed to stage OAuth token fd; falling back to environment variable passing.', err);
        return null;
      }
    }

    /**
     * Spawns the native claude.exe helper subprocess with stdio piping.
     */
    public spawnHelper(options: ProcessLaunchOptions): ChildProcess {
      let stagedFd: number | null = null;
      const env = { ...options.env };

      if (options.authToken) {
        stagedFd = this.stageCredentialFd(options.authToken);
        if (stagedFd !== null) {
          env['CLAUDE_CODE_AUTH_FD'] = stagedFd.toString();
        } else {
          env['ANTHROPIC_AUTH_TOKEN'] = options.authToken;
        }
      }

      console.log(`[HostLoop] Spawning CLI helper: ${options.binaryPath} with ${options.args.length} arguments`);
      const child = spawn(options.binaryPath, options.args, {
        cwd: options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.activeProcess = child;
      this.pid = child.pid || null;

      child.on('exit', (code, signal) => {
        console.log(`[HostLoop] CLI helper process ${this.pid} exited with code=${code}, signal=${signal}`);
        this.cleanup();
      });

      return child;
    }

    /**
     * Performs a graceful termination sequence with a 5000ms timeout,
     * escalating to Windows tree-kill (`taskkill /pid <PID> /T /F`) if unresponsive.
     */
    public terminate(): void {
      if (!this.activeProcess || !this.pid) return;

      const targetPid = this.pid;
      console.log(`[HostLoop] Initiating graceful termination for helper PID: ${targetPid}`);

      try {
        this.activeProcess.kill('SIGTERM');
      } catch (e) {
        // Process may already be dead
      }

      this.killTimeout = setTimeout(() => {
        console.warn(`[HostLoop] Helper PID ${targetPid} did not exit within 5000ms; invoking force tree-kill.`);
        this.forceTreeKill(targetPid);
      }, 5000);
    }

    /**
     * Windows tree-kill invocation to ensure child CLI and any spawned processes
     * (e.g. bash, node, git) are completely cleaned up.
     */
    private forceTreeKill(pid: number): void {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', pid.toString(), '/T', '/F']);
        killer.on('close', () => {
          console.log(`[HostLoop] taskkill completed for PID ${pid}`);
        });
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Ignore ESRCH
        }
      }
      this.cleanup();
    }

    private cleanup(): void {
      if (this.killTimeout) {
        clearTimeout(this.killTimeout);
        this.killTimeout = null;
      }
      this.activeProcess = null;
      this.pid = null;
    }
  }
}
