/**
 * Builds a fully-registered 60db McpServer.
 * Shared by the stdio entry (index.ts) and the hosted HTTP entry (http-server.ts).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";

import { registerVoiceTools } from "./tools/voices.js";
import { registerTTSTools } from "./tools/tts.js";
import { registerSTTTools } from "./tools/stt.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { register60DBTools } from "./tools/sixtydb.js";
import { registerMeetingAndAnalyticsTools } from "./tools/meetings.js";
import { registerBillingTools } from "./tools/billing.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerJudgeTools } from "./tools/judge.js";
import { registerAuthzTools } from "./tools/authz.js";
import { registerMusicTools } from "./tools/music.js";
import { registerDialerTools } from "./tools/dialer.js";

export interface CreateServerOptions {
  /**
   * Hosted multi-tenant mode (mcp.60db.ai): disables every tool path that reads
   * or writes the server's own filesystem.
   */
  hosted?: boolean;
}

export function createSixtydbMcpServer(options: CreateServerOptions = {}): McpServer {
  const allowLocalFiles = !options.hosted;
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerVoiceTools(server);
  registerTTSTools(server);
  registerSTTTools(server);
  registerWorkspaceTools(server);
  register60DBTools(server);
  registerMeetingAndAnalyticsTools(server);
  registerBillingTools(server);
  registerMemoryTools(server, { allowLocalFiles });
  registerJudgeTools(server);
  registerAuthzTools(server);
  registerMusicTools(server, { allowLocalFiles });
  registerDialerTools(server);

  return server;
}
