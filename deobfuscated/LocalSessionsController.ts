/**
 * @file LocalSessionsController.ts
 * @description Deobfuscated LocalSessions RPC Controller & Agent Session Orchestrator
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (`go(uv, "LocalSessions", ...)` registration)
 *
 * Exposes the full UI-facing session interaction surface between Electron Renderer (React SPA)
 * and the Agent SDK / Helper subprocess.
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
 */


export namespace LocalSessionsController {
  export interface SessionMessagePayload {
    sessionId: string;
    text: string;
    images?: Array<{ mimeType: string; dataBase64: string }>;
    attachments?: Array<{ path: string; name: string }>;
    steeringGates?: string[];
    paneHolds?: string[];
  }

  export interface SessionMetadata {
    sessionId: string;
    parentSessionId?: string;
    title: string;
    model: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    fastMode: boolean;
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';
    worktreePath?: string;
    isRemote: boolean;
    createdAt: number;
    updatedAt: number;
  }

  export class LocalSessionsService {
    private sessions: Map<string, SessionMetadata> = new Map();

    /**
     * Initializes a new session with initial model, effort, and permission settings.
     */
    public async startSession(options: {
      initialPrompt?: string;
      cwd: string;
      model?: string;
      effort?: SessionMetadata['effort'];
      permissionMode?: SessionMetadata['permissionMode'];
    }): Promise<SessionMetadata> {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const meta: SessionMetadata = {
        sessionId,
        title: 'New Session',
        model: options.model || 'claude-opus-5-5',
        effort: options.effort || 'high',
        fastMode: false,
        permissionMode: options.permissionMode || 'default',
        worktreePath: options.cwd,
        isRemote: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      this.sessions.set(sessionId, meta);
      console.log(`[LocalSessionsService] Started session ${sessionId} at ${options.cwd}`);
      return meta;
    }

    /**
     * Sends message turn with multimodal payloads, steering gates, and pane layout holds.
     */
    public async sendMessage(payload: SessionMessagePayload): Promise<{ turnId: string; status: 'queued' | 'active' }> {
      const session = this.sessions.get(payload.sessionId);
      if (!session) {
        throw new Error(`[LocalSessionsService] Session not found: ${payload.sessionId}`);
      }

      session.updatedAt = Date.now();
      const turnId = `turn_${Date.now()}`;
      console.log(`[LocalSessionsService] Dispatched turn ${turnId} to session ${payload.sessionId}`);
      return { turnId, status: 'active' };
    }

    /**
     * Forks an existing session from a specific message node.
     */
    public async forkSession(sourceSessionId: string, messageUuid?: string): Promise<SessionMetadata> {
      const source = this.sessions.get(sourceSessionId);
      if (!source) {
        throw new Error(`[LocalSessionsService] Source session not found: ${sourceSessionId}`);
      }

      const forkedId = `session_fork_${Date.now()}`;
      const forkedMeta: SessionMetadata = {
        ...source,
        sessionId: forkedId,
        parentSessionId: sourceSessionId,
        title: `Fork of ${source.title}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      this.sessions.set(forkedId, forkedMeta);
      console.log(`[LocalSessionsService] Forked session ${sourceSessionId} -> ${forkedId}`);
      return forkedMeta;
    }

    /**
     * Detaches a side session from its parent hierarchy to top-level sidebar.
     */
    public async detachFromParent(sessionId: string): Promise<boolean> {
      const session = this.sessions.get(sessionId);
      if (!session || !session.parentSessionId) {
        return false;
      }
      delete session.parentSessionId;
      session.updatedAt = Date.now();
      return true;
    }

    public async setModel(sessionId: string, model: string): Promise<void> {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.model = model;
        session.updatedAt = Date.now();
      }
    }

    public async setEffort(sessionId: string, effort: SessionMetadata['effort']): Promise<void> {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.effort = effort;
        session.updatedAt = Date.now();
      }
    }

    public async setFastMode(sessionId: string, enabled: boolean): Promise<void> {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.fastMode = enabled;
        session.updatedAt = Date.now();
      }
    }
  }
}
