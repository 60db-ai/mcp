#!/usr/bin/env node
/**
 * Offline smoke test for the Agents MCP tools (no network, no API key).
 *
 *   npm run build && node scripts/smoke-test-agents-tools-offline.mjs
 *
 * Connects an in-memory MCP client to the real server, checks the 11 agents
 * tools register with valid schemas, and stubs the axios adapter to verify
 * place_call without confirm makes NO HTTP call, with confirm sends
 * x-60db-client: mcp, and phone-line SIP details are never shown.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSixtydbMcpServer } from "../dist/create-sixtydb-mcp-server.js";
import { getApiClient } from "../dist/services/api-client.js";

const EXPECTED = ["list", "get", "create", "update", "delete", "place_call", "start_stream_call", "list_calls", "get_call", "get_transcript", "list_phone_lines"]
  .map((n) => `sixtydb_agents_${n}`);
const UUID = "11111111-1111-4111-8111-111111111111";
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

const api = getApiClient({ baseURL: "http://stub.invalid", apiKey: "sk_test" });
const requests = [];
let nextResponse = { success: true, data: {} };
api.getAxiosInstance().defaults.adapter = async (config) => {
  requests.push(config);
  return { data: nextResponse, status: 200, statusText: "OK", headers: {}, config };
};

const server = createSixtydbMcpServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "agents-smoke", version: "1.0.0" });
await Promise.all([server.connect(st), client.connect(ct)]);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
for (const n of EXPECTED) {
  const t = tools.find((x) => x.name === n);
  check(Boolean(t) && t.inputSchema?.type === "object", `${n} registered with object schema`);
}
check(names.filter((n) => n.startsWith("sixtydb_agents_")).length === 11, "exactly 11 agents tools");
const place = tools.find((t) => t.name === "sixtydb_agents_place_call");
check(place.inputSchema.additionalProperties === false, "place_call schema is strict");
check(place.annotations?.openWorldHint === true, "place_call openWorldHint");
check(tools.find((t) => t.name === "sixtydb_agents_delete").annotations?.destructiveHint === true, "delete destructiveHint");

const text = (r) => r.content[0].text;
const callArgs = { agent_id: UUID, to: "+14155551234", phone_line_id: UUID };

let r = await client.callTool({ name: "sixtydb_agents_place_call", arguments: callArgs });
check(requests.length === 0 && /Confirmation required/.test(text(r)), "place_call without confirm: explanation, no HTTP");
r = await client.callTool({ name: "sixtydb_agents_delete", arguments: { agent_id: UUID } });
check(requests.length === 0 && /Confirmation required/.test(text(r)), "delete without confirm: no HTTP");

nextResponse = { success: true, data: { id: UUID, status: "queued", direction: "outbound", to: "+14155551234", from: "+1" } };
r = await client.callTool({ name: "sixtydb_agents_place_call", arguments: { ...callArgs, confirm: true } });
const req = requests[0];
check(req?.method === "post" && req.url === `/agents/${UUID}/calls`, "place_call with confirm POSTs /agents/:id/calls");
check(req?.headers?.["x-60db-client"] === "mcp", "x-60db-client: mcp header sent");
check(!("confirm" in JSON.parse(req.data)), "confirm not forwarded to backend");

requests.length = 0;
r = await client.callTool({ name: "sixtydb_agents_start_stream_call", arguments: { agent_id: UUID } });
check(requests.length === 0 && /Confirmation required/.test(text(r)), "start_stream_call without confirm: explanation, no HTTP");
nextResponse = { success: true, data: { call: { id: UUID, direction: "stream", status: "dialing", to: "stream", from: "stream" },
  url: `wss://api.60db.ai/ws/agents/stream/${UUID}?token=t`, expires_in: 55 } };
r = await client.callTool({ name: "sixtydb_agents_start_stream_call", arguments: { agent_id: UUID, metadata: { lead: "L-1" }, confirm: true } });
check(requests[0]?.method === "post" && requests[0].url === `/agents/${UUID}/stream-calls`, "start_stream_call with confirm POSTs /agents/:id/stream-calls");
check(requests[0]?.headers?.["x-60db-client"] === "mcp" && JSON.parse(requests[0].data).metadata?.lead === "L-1" && !("confirm" in JSON.parse(requests[0].data)), "stream call sends metadata and the mcp header, not confirm");
check(/wss:\/\/api\.60db\.ai\/ws\/agents\/stream\//.test(text(r)) && /55s/.test(text(r)), "stream call shows the one-time URL and its lifetime");
requests.length = 0;
r = await client.callTool({ name: "sixtydb_agents_list_calls", arguments: { direction: "stream" } });
check(requests[0]?.params?.direction === "stream", "list_calls passes the direction filter");

nextResponse = { success: true, data: { phone_lines: [{ id: UUID, kind: "byo", name: "L", caller_id: "+1", domain: "sip.x.com", username: "secretuser", password: "pw" }] } };
r = await client.callTool({ name: "sixtydb_agents_list_phone_lines", arguments: { response_format: "json" } });
check(!/secretuser|sip\.x\.com|"password"/.test(text(r)), "phone lines hide SIP details");

nextResponse = { success: true, data: { call_id: UUID, turns: [{ speaker: "agent", text: "Hi" }, { speaker: "caller", text: "Hello" }] } };
r = await client.callTool({ name: "sixtydb_agents_get_transcript", arguments: { call_id: UUID } });
check(/Agent: Hi\nCaller: Hello/.test(text(r)), "transcript formatted as Agent/Caller");

requests.length = 0;
nextResponse = { success: true, data: { id: UUID, name: "Front", transfer_targets: [{ name: "Sales", numbers: ["+919800000001"] }] } };
r = await client.callTool({ name: "sixtydb_agents_create", arguments: { name: "Front", script: "s", voice_id: "v1",
  transfer_targets: [{ name: "Sales", numbers: ["+919800000001"] }] } });
check(JSON.parse(requests[0]?.data || "{}").transfer_targets?.[0]?.name === "Sales", "create forwards transfer_targets");
check(/Sales \(1 number\)/.test(text(r)), "agent detail shows transfer targets");
r = await client.callTool({ name: "sixtydb_agents_create", arguments: { name: "x", script: "s", voice_id: "v",
  transfer_targets: [{ name: "Sales", numbers: ["98000"] }] } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
check(r.isError === true, "create rejects a transfer number that is not E.164");

r = await client.callTool({ name: "sixtydb_agents_create", arguments: { name: "x" } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
check(r.isError === true, "create rejects missing required fields");

await client.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
