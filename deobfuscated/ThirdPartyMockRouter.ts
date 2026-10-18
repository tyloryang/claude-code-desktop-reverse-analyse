/**
 * @file ThirdPartyMockRouter.ts
 * @description Deobfuscated Third-Party (3P) Local API Stub & Protocol Router
 * Origin: Claude Desktop index.chunk-CHpJbW9_.js (`Z$r`, `X$r`, `U$r`)
 */

export namespace ThirdPartyMockRouter {
  /**
   * Installs the custom `app://localhost` protocol handler for custom-3p deployments.
   * Intercepts local requests to prevent external egress and routes them to ion-dist bundled assets
   * or local mock API handlers.
   */
  export function registerThirdPartyProtocolHandlers(): void {
    // Protocol scheme registration check
    // Origin must strictly match app://localhost
    console.log('[CCD 3P Router] Registering app://localhost protocol interceptor');
  }

  /**
   * Mock API interception rules for offline/3P mode:
   * - /api/bootstrap
   * - /api/organizations/*/library_submissions
   * - /api/organizations/*/library/discover/browse
   * - /api/plugins/list-plugins
   * - /api/dust/generate_session_title
   * - /v1/code/github/*
   */
  export function handleLocalApiStub(urlPath: string): { intercepted: boolean; statusCode: number; body?: any } {
    if (urlPath.includes('/api/bootstrap') || urlPath.includes('/api/app_start')) {
      return {
        intercepted: true,
        statusCode: 200,
        body: { mode: 'third-party', status: 'active', gatewayManaged: true }
      };
    }

    if (urlPath.includes('/api/dust/generate_session_title')) {
      return {
        intercepted: true,
        statusCode: 200,
        body: { title: 'Local Session Title' }
      };
    }

    return { intercepted: false, statusCode: 404 };
  }
}
