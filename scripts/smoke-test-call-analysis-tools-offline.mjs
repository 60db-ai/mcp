#!/usr/bin/env node
/**
 * Offline smoke test for the Call analysis MCP tools (no network, no API key).
 *
 *   npm run test:call-analysis
 *
 * Connects an in-memory MCP client to the real server, checks the tools register
 * with valid schemas, and stubs the axios adapter to verify method/path/body
 * mapping, the confirm gates and input validation.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSixtydbMcpServer } from "../dist/create-sixtydb-mcp-server.js";
import { getApiClient } from "../dist/services/api-client.js";

const EXPECTED = ["list_analyzers", "create_analyzer", "get_analyzer", "update_analyzer", "archive_analyzer", "add_recording_urls",
  "analyze", "list_recordings", "get_problems", "get_analytics", "get_call_analysis", "suggest_agent_fix", "apply_agent_fix", "undo_agent_fix"]
  .map((n) => `sixtydb_call_analysis_${n}`);
const A = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const HASH = "a".repeat(64);
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

const api = getApiClient({ baseURL: "http://stub.invalid", apiKey: "sk_test" });
const requests = [];
let responder = () => ({ success: true, data: {} });
api.getAxiosInstance().defaults.adapter = async (config) => {
  requests.push(config);
  return { data: responder(config), status: 200, statusText: "OK", headers: {}, config };
};

const server = createSixtydbMcpServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "call-analysis-smoke", version: "1.0.0" });
await Promise.all([server.connect(st), client.connect(ct)]);
const call = (name, args) => client.callTool({ name: `sixtydb_call_analysis_${name}`, arguments: args })
  .catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
const text = (r) => r.content[0].text;
const reset = () => { requests.length = 0; };

const { tools } = await client.listTools();
for (const n of EXPECTED) check(tools.find((t) => t.name === n)?.inputSchema?.type === "object", `${n} registered`);
check(tools.filter((t) => t.name.startsWith("sixtydb_call_analysis_")).length === EXPECTED.length, `exactly ${EXPECTED.length} tools`);
const ann = (n) => tools.find((t) => t.name === `sixtydb_call_analysis_${n}`).annotations;
check(ann("archive_analyzer").destructiveHint === true && ann("list_analyzers").readOnlyHint === true, "archive destructive, list read-only");

// simple mappings
await call("list_analyzers", {});
check(requests[0].method === "get" && requests[0].url === "/deep-analytics/analysis-agents", "list -> GET /analysis-agents");
reset(); await call("create_analyzer", { name: "QA", instructions: "Check greeting" });
check(requests[0].method === "post" && requests[0].url === "/deep-analytics/analysis-agents" && JSON.parse(requests[0].data).name === "QA"
  && !("response_format" in JSON.parse(requests[0].data)), "create -> POST, no response_format in body");
reset(); await call("update_analyzer", { agent_id: A, language: null });
check(requests[0].method === "put" && requests[0].url === `/deep-analytics/analysis-agents/${A}` && JSON.parse(requests[0].data).language === null, "update -> PUT, null kept");
reset(); let r = await call("update_analyzer", { agent_id: A });
check(requests.length === 0 && /at least one field/.test(text(r)), "update with no fields: no HTTP");
r = await call("get_analyzer", { agent_id: "nope" });
check(r.isError === true, "get rejects non-UUID id");

// archive gate
reset(); r = await call("archive_analyzer", { agent_id: A });
check(requests.length === 0 && /Confirmation required/.test(text(r)), "archive without confirm: no HTTP");
await call("archive_analyzer", { agent_id: A, confirm: true });
check(requests[0].method === "delete" && requests[0].url === `/deep-analytics/analysis-agents/${A}`, "archive -> DELETE");

// add_recording_urls: batch then fetch loop
reset();
let fetchCalls = 0;
responder = (c) => {
  if (c.url.endsWith("/batches")) return { success: true, data: { id: "B1", total: 2, valid: 2, invalid: 0 } };
  fetchCalls++;
  return { success: true, data: fetchCalls === 1 ? { attempted: 2, stored: 2, failed: 0, skipped: 0 } : { attempted: 0 } };
};
r = await call("add_recording_urls", { agent_id: A, urls: ["https://x.test/a.mp3", "https://x.test/b.mp3?x=1&y=2"] });
const batchBody = JSON.parse(requests[0].data);
check(requests[0].url === `/deep-analytics/analysis-agents/${A}/batches` && batchBody.source_kind === "csv_urls", "add_urls creates csv_urls batch");
check(batchBody.csv_text.startsWith("external_call_ref,recording_url\n") && batchBody.csv_text.includes('"https://x.test/b.mp3?x=1&y=2"'), "csv header and quoted URL cell");
check(requests[1].url === "/deep-analytics/imports/batches/B1/fetch-recordings" && fetchCalls === 2, "fetch loop stops when attempted is 0");
check(/2 stored/.test(text(r)), "summary shows stored count");
r = await call("add_recording_urls", { agent_id: A, urls: ["ftp://x/a.mp3"] });
check(r.isError === true, "add_urls rejects non-http URL");
r = await call("add_recording_urls", { agent_id: A, urls: [] });
check(r.isError === true, "add_urls rejects empty list");

// analyze: preview vs confirm
reset(); responder = () => ({ success: true, data: { total: 3, items: [] } });
r = await call("analyze", { agent_id: A });
check(requests.length === 1 && requests[0].method === "get" && requests[0].params.status === "ready" && /confirm_count: 3/.test(text(r)), "analyze preview reads ready count, no POST");
reset(); responder = () => ({ success: true, data: { committed: 3 } });
await call("analyze", { agent_id: A, confirm_count: 3 });
check(requests[0].method === "post" && requests[0].url === `/deep-analytics/analysis-agents/${A}/analyze` && JSON.parse(requests[0].data).confirm_count === 3, "analyze -> POST with confirm_count");

// reads
reset(); await call("list_recordings", { agent_id: A, status: "done", severity: "high", limit: 10 });
check(requests[0].url === `/deep-analytics/analysis-agents/${A}/recordings` && requests[0].params.status === "done" && requests[0].params.limit === 10 && !("q" in requests[0].params), "list_recordings filters");
r = await call("list_recordings", { agent_id: A, limit: 500 });
check(r.isError === true, "list_recordings rejects limit > 100");
reset(); await call("get_problems", { agent_id: A, from: "2026-11-01" });
check(requests[0].url.endsWith("/problems") && requests[0].params.from === "2026-11-01", "get_problems");
reset(); await call("get_analytics", { days: 7 });
check(requests[0].url === "/deep-analytics/analysis-agents-analytics" && requests[0].params.days === 7, "analytics overview");
reset(); await call("get_analytics", { agent_id: A });
check(requests[0].url === `/deep-analytics/analysis-agents/${A}/analytics` && requests[0].params.days === 30, "analyzer analytics default 30");
r = await call("get_analytics", { days: 14 });
check(r.isError === true, "analytics rejects days 14");
reset(); await call("get_call_analysis", { call_id: C });
check(requests[0].url === `/deep-analytics/calls/${C}/analysis`, "get_call_analysis");

// fix agent
reset(); await call("suggest_agent_fix", { call_id: C });
check(requests[0].method === "post" && requests[0].url === `/deep-analytics/calls/${C}/agent-fix/suggest`, "suggest -> POST");
reset(); r = await call("apply_agent_fix", { call_id: C, base_hash: HASH, script: "new" });
check(requests.length === 0 && /Confirmation required/.test(text(r)), "apply without confirm: no HTTP");
await call("apply_agent_fix", { call_id: C, base_hash: HASH, script: "new", confirm: true });
const ab = JSON.parse(requests[0].data);
check(requests[0].url === `/deep-analytics/calls/${C}/agent-fix/apply` && ab.base_hash === HASH && ab.script === "new" && !("confirm" in ab), "apply -> POST body without confirm");
r = await call("apply_agent_fix", { call_id: C, base_hash: "short", script: "x", confirm: true });
check(r.isError === true, "apply rejects bad base_hash");
reset(); r = await call("undo_agent_fix", { call_id: C, fix_id: A });
check(requests.length === 0 && /Confirmation required/.test(text(r)), "undo without confirm: no HTTP");
await call("undo_agent_fix", { call_id: C, fix_id: A, confirm: true });
check(requests[0].url === `/deep-analytics/calls/${C}/agent-fix/${A}/undo`, "undo -> POST");

// error mapping
api.getAxiosInstance().defaults.adapter = async (config) => {
  const e = new Error("403"); e.isAxiosError = true; e.config = config;
  e.response = { status: 403, data: { message: "Forbidden", code: "POLICY_DENY" }, headers: {}, config };
  throw e;
};
r = await call("suggest_agent_fix", { call_id: C });
check(/POLICY_DENY/.test(text(r)) && /agents. permission/.test(text(r)), "403 POLICY_DENY maps to the agents-permission hint");

api.getAxiosInstance().defaults.adapter = async (config) => {
  const e = new Error("403"); e.isAxiosError = true; e.config = config;
  e.response = { status: 403, data: { message: "Forbidden", code: "DA_API_KEY_SCOPE_MISSING" }, headers: {}, config };
  throw e;
};
r = await call("list_analyzers", {});
check(/DA_API_KEY_SCOPE_MISSING/.test(text(r)) && /Enable the Call analysis permission/.test(text(r)) && /Developers/.test(text(r)), "403 DA_API_KEY_SCOPE_MISSING maps to the enable-permission hint");

await client.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
