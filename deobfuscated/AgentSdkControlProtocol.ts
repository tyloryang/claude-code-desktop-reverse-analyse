/**
 * @file AgentSdkControlProtocol.ts
 * @description Analyst sketch of selected Agent SDK control-request and Stream-JSON labels
 * Origin: Claude Desktop index.chunk-C4qJSrNf.js & index.chunk-CHpJbW9_.js
 */
/**
 * Analyst reconstruction from static evidence; not verbatim vendor source or REA output.
 * Names, types, control flow, and security semantics may be inferred or incomplete.
 * This file has not been compiled, unit-tested, or runtime-validated.
 */


export namespace AgentSdkControlProtocol {
  /**
   * Selected subtype names observed in static evidence; this list is not known to be complete.
   */
  export const CONTROL_REQUEST_SUB_TYPES = [
    'apply_flag_settings',
    'background_tasks',
    'cancel_async_message',
    'channel_enable',
    'claim_session',
    'claude_authenticate',
    'claude_oauth_callback',
    'claude_oauth_wait_for_completion',
    'error',
    'export_conversation',
    'generate_session_title',
    'get_chrome_browsers',
    'get_context_usage',
    'get_hooks_listing',
    'get_memory_dialog',
    'get_plan',
    'get_sandbox_dialog',
    'get_settings',
    'get_skills_dialog',
    'get_status',
    'get_task_output',
    'get_usage',
    'initialize',
    'interrupt',
    'list_permission_rules',
    'mcp_authenticate',
    'mcp_clear_auth',
    'mcp_message',
    'mcp_oauth_callback_url',
    'mcp_read_resource',
    'mcp_reconnect',
    'mcp_set_servers',
    'mcp_status',
    'mcp_toggle',
    'message_rated',
    'mirror_error',
    'read_file',
    'reload_output_styles',
    'reload_plugins',
    'reload_skills',
    'remote_control',
    'rename_session',
    'rewind_files',
    'seed_read_state',
    'select_chrome_browser',
    'set_chrome_browser_hints',
    'set_cwd',
    'set_max_thinking_tokens',
    'set_mcp_permission_mode_override',
    'set_model',
    'set_permission_mode',
    'set_prompt_suggestions_paused',
    'side_question',
    'stop_task',
    'submit_feedback',
    'success',
    'ultrareview_launch',
    'update_settings',
    'can_use_tool',
    'host_auth_token_refresh',
    'elicitation'
  ] as const;

  export type ControlRequestSubtype = typeof CONTROL_REQUEST_SUB_TYPES[number];

  export interface ControlMessageFrame {
    type: 'system' | 'control_request' | 'control_response';
    subtype: ControlRequestSubtype;
    session_id: string;
    payload?: any;
    request_id?: string;
  }

  /**
   * Handles incoming control requests from the CLI helper process.
   * Particularly handles runtime token refresh (`host_auth_token_refresh`) and
   * interactive tool permission prompts (`can_use_tool`).
   */
  export async function handleControlRequest(frame: ControlMessageFrame): Promise<any> {
    switch (frame.subtype) {
      case 'host_auth_token_refresh':
        // Triggers background token refresh via Desktop auth manager
        return { success: true, refreshedToken: 'mock-refreshed-token' };

      case 'can_use_tool':
        // Renders native confirmation card in UI and awaits user decision
        return { decision: 'approved', tool: frame.payload?.tool };

      default:
        console.warn(`[AgentSdkControl] Unhandled control request subtype: ${frame.subtype}`);
        return { success: false, error: 'Unknown control subtype' };
    }
  }
}
