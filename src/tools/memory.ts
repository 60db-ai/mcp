/**
 * Memory / RAG Tools
 *
 * Exposes 60db's persistent memory layer via MCP:
 *   - Store and recall user memories + knowledge base entries
 *   - Upload documents (PDF, DOCX, XLSX, PPTX, EML, scanned images) with built-in OCR
 *   - Assemble LLM-ready context for agentic RAG
 *   - Manage collections (personal, team, knowledge, hive)
 *   - Track monthly spend and billing
 *
 * All write operations (ingest, upload, search, context) are pay-as-you-go
 * from the workspace wallet. Every billable response includes the
 * x-credit-balance, x-credit-charged, and x-billing-tx headers which this
 * tool surfaces in its formatted output.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import {
  MemoryIngestSchema,
  MemoryIngestBatchSchema,
  MemoryUploadDocumentSchema,
  MemorySearchSchema,
  MemoryContextSchema,
  MemoryCollectionsListSchema,
  MemoryCollectionCreateSchema,
  MemoryUsageSchema,
  MemoryStatusSchema,
  MemoryDeleteSchema,
  MemoryIngestParams,
  MemoryIngestBatchParams,
  MemoryUploadDocumentParams,
  MemorySearchParams,
  MemoryContextParams,
  MemoryCollectionsListParams,
  MemoryCollectionCreateParams,
  MemoryUsageParams,
  MemoryStatusParams,
  MemoryDeleteParams,
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import { formatErrorMessage, truncateIfNeeded } from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

// ─ Local formatters ────────────────────────────────────────
// These intentionally live here rather than in response-formatter.ts to
// keep memory-specific output shapes close to the tools that use them.
// The billing hint surfaces credit spend on every billable response so
// agents can reason about cost.

function fmtBillingHint(billing: any): string {
  if (!billing) return "";
  const parts: string[] = [];
  if (typeof billing.charged === "number") {
    parts.push(`charged **$${billing.charged.toFixed(6)}**`);
  }
  if (typeof billing.balance === "number") {
    parts.push(`balance **$${billing.balance.toFixed(6)}**`);
  }
  if (billing.txId) {
    parts.push(`tx \`${billing.txId}\``);
  }
  return parts.length ? `\n\n_Billing: ${parts.join(" · ")}_` : "";
}

function fmtAsJson(data: unknown): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

function respond(markdown: string, json: unknown, format: ResponseFormat) {
  const body = format === ResponseFormat.JSON
    ? JSON.stringify(json, null, 2)
    : markdown;
  const { content } = truncateIfNeeded(body, format === ResponseFormat.JSON);
  return { content: [{ type: "text" as const, text: content }] };
}

// ─ Response header extraction ─────────────────────────────
// Our api-client wraps responses and discards headers by default. For the
// memory endpoints we need the billing headers, so we poke the underlying
// axios instance directly to get a full response with headers.

async function postWithHeaders<T>(endpoint: string, body: unknown): Promise<{ data: T; headers: Record<string, string> }> {
  const axiosInstance = getApiClient().getAxiosInstance();
  const res = await axiosInstance.post<T>(endpoint, body);
  return { data: res.data, headers: res.headers as Record<string, string> };
}

async function getWithHeaders<T>(endpoint: string, params?: Record<string, unknown>): Promise<{ data: T; headers: Record<string, string> }> {
  const axiosInstance = getApiClient().getAxiosInstance();
  const res = await axiosInstance.get<T>(endpoint, { params });
  return { data: res.data, headers: res.headers as Record<string, string> };
}

function extractBilling(headers: Record<string, string>) {
  const balance = headers["x-credit-balance"] ? parseFloat(headers["x-credit-balance"]) : null;
  const chargedTotal = headers["x-credit-charged-total"] ? parseFloat(headers["x-credit-charged-total"]) : null;
  const charged = headers["x-credit-charged"] ? parseFloat(headers["x-credit-charged"]) : null;
  return {
    balance: Number.isFinite(balance) ? balance : null,
    charged: chargedTotal ?? (Number.isFinite(charged) ? charged : null),
    txId: headers["x-billing-tx"] || null,
  };
}

// ─ Tool registration ──────────────────────────────────────

export interface MemoryToolOptions {
  /**
   * Allow tools that read the MCP host's local filesystem. True for stdio (the
   * user's own machine); MUST be false on the hosted server, where it would
   * expose the server's files to every API-key holder.
   */
  allowLocalFiles?: boolean;
}

export function registerMemoryTools(server: McpServer, options: MemoryToolOptions = {}): void {
  const { allowLocalFiles = true } = options;
  // ── sixtydb_memory_ingest ──────────────────────────────
  server.registerTool(
    "sixtydb_memory_ingest",
    {
      title: "Ingest a single memory",
      description: `Store a single memory in your 60db workspace memory layer.

The memory is processed asynchronously: the response returns immediately with a pending memory ID that you can poll via \`sixtydb_memory_get_status\`.

**Billing**: per 1,000 characters of \`text\` (~$0.0001/1k chars). The charge is deducted upfront from the workspace wallet and automatically refunded if the request fails. If the wallet balance is too low, returns \`402 INSUFFICIENT_CREDITS\` with a shortfall.

**Parameters:**
- \`text\` (string, required): The memory content (max 100,000 chars)
- \`title\` (string, optional): Display title
- \`collection\` (string, optional): Collection ID — defaults to the caller's personal collection
- \`type\` (string, optional): \`user\` | \`knowledge\` | \`hive\` (default: \`user\`)
- \`infer\` (boolean, optional): If true, the memory service extracts structured facts via LLM inference (default: true)
- \`metadata\` (object, optional): Arbitrary metadata attached to the memory

**When to use:**
- Store a user preference or profile fact that should be recalled across sessions
- Record a conversation summary or decision
- Add a single piece of factual reference content

For bulk ingestion, prefer \`sixtydb_memory_ingest_batch\`. For documents, use \`sixtydb_memory_upload_document\`.`,
      inputSchema: MemoryIngestSchema,
      annotations: {
        title: "Ingest memory",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MemoryIngestParams) => {
      try {
        const body: Record<string, unknown> = {
          text: params.text,
          type: params.type,
          infer: params.infer,
        };
        if (params.title) body.title = params.title;
        if (params.collection) body.collection = params.collection;
        if (params.metadata) body.metadata = params.metadata;

        const { data, headers } = await postWithHeaders<any>("/memory/ingest", body);
        const billing = extractBilling(headers);
        if (!data?.success) {
          return respond(
            `**Memory ingest failed**: ${data?.message || "unknown error"}`,
            data,
            params.response_format
          );
        }
        const info = data.data || {};
        const md = [
          `**Memory queued** in collection \`${info.collection_id || "personal"}\``,
          info.collection_label ? `Collection: ${info.collection_label}` : null,
          `Type: ${info.memory_type || params.type}`,
          `Total queued: ${info.total_queued ?? 1}`,
          ...(info.results || []).slice(0, 3).map((r: any) => `- \`${r.id}\` — ${r.status}: ${r.message || ""}`),
          fmtBillingHint(billing),
        ].filter(Boolean).join("\n");
        return respond(md, { ...data, billing }, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_ingest_batch ────────────────────────
  server.registerTool(
    "sixtydb_memory_ingest_batch",
    {
      title: "Batch ingest memories",
      description: `Store up to 100 memories in a single request.

All memories are charged together against the same workspace wallet at $0.0001 per 1,000 characters (summed across all \`memories[*].text\`). If any single memory is invalid, the whole batch is rejected before any charge happens.

**Parameters:**
- \`memories\` (array, required): 1-100 entries with \`text\` (required), optional \`title\`, \`metadata\`, \`infer\`
- \`collection\` (string, optional): Target collection
- \`type\` (string, optional): \`user\` | \`knowledge\` | \`hive\` (default: \`knowledge\`)

Use this for importing a list of facts, FAQ entries, or pre-chunked documents. For arbitrary file uploads (PDF, DOCX), use \`sixtydb_memory_upload_document\` instead.`,
      inputSchema: MemoryIngestBatchSchema,
      annotations: {
        title: "Batch ingest memories",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MemoryIngestBatchParams) => {
      try {
        const body: Record<string, unknown> = {
          memories: params.memories,
          type: params.type,
        };
        if (params.collection) body.collection = params.collection;

        const { data, headers } = await postWithHeaders<any>("/memory/ingest/batch", body);
        const billing = extractBilling(headers);
        if (!data?.success) {
          return respond(
            `**Batch ingest failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const info = data.data || {};
        const md = [
          `**Batch ingest queued**`,
          `Collection: ${info.collection_id || "personal"} (${info.collection_label || ""})`,
          `Memories: ${info.total_queued ?? params.memories.length}`,
          `Type: ${info.memory_type || params.type}`,
          fmtBillingHint(billing),
        ].filter(Boolean).join("\n");
        return respond(md, { ...data, billing }, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_upload_document (local file → memory; stdio only) ──
  const uploadDocumentTool = server.registerTool(
    "sixtydb_memory_upload_document",
    {
      title: "Upload a document to memory",
      description: `Extract text from a document and ingest it into a memory collection.

Supports **91+ formats** including PDF, DOCX, DOC, ODT, RTF, TXT, MD, HTML, EPUB, XLSX, XLS, CSV, ODS, PPTX, PPT, ODP, EML, MSG, PNG, JPG, TIFF, BMP, and more. **OCR is applied automatically** to scanned PDFs and images. Max 200 MB per file.

**File path**: Pass an absolute path on the local filesystem. The tool will read the file and stream it to the 60db API as multipart form-data.

**Billing** (two-stage):
1. Extract fee: $0.003 per MB of file size (pre-charged)
2. Ingest fee: $0.0001 per 1,000 characters of extracted text (post-charged after extraction)

Both fees are automatically refunded on any failure.

**Parameters:**
- \`file_path\` (string, required): Absolute path to the document
- \`collection\` (string, optional): Target collection — defaults to personal
- \`type\` (string, optional): \`user\` | \`knowledge\` | \`hive\` (default: \`knowledge\` — right choice for documents)
- \`title\` (string, optional): Display title; defaults to the filename
- \`chunk_size\` (number, optional): Max characters per chunk (200-8000, default: 1500)
- \`chunk_overlap\` (number, optional): Overlap between chunks (default: 200)

**Tuning tips:**
- Technical docs: chunk_size=1500, overlap=200 (default)
- Long-form prose: chunk_size=2500, overlap=300
- FAQs: chunk_size=800, overlap=100
- Spreadsheets: chunk_size=3000, overlap=0`,
      inputSchema: MemoryUploadDocumentSchema,
      annotations: {
        title: "Upload document",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MemoryUploadDocumentParams) => {
      try {
        const absPath = path.resolve(params.file_path);
        if (!fs.existsSync(absPath)) {
          return {
            content: [{
              type: "text" as const,
              text: `**Error**: File not found at path \`${absPath}\`. Provide an absolute path on the local filesystem.`,
            }],
          };
        }
        const stats = fs.statSync(absPath);
        if (!stats.isFile()) {
          return {
            content: [{
              type: "text" as const,
              text: `**Error**: \`${absPath}\` is not a regular file.`,
            }],
          };
        }
        if (stats.size > 200 * 1024 * 1024) {
          return {
            content: [{
              type: "text" as const,
              text: `**Error**: File is ${(stats.size / 1024 / 1024).toFixed(1)} MB — exceeds the 200 MB upload limit.`,
            }],
          };
        }

        const form = new FormData();
        form.append("file", fs.createReadStream(absPath), {
          filename: path.basename(absPath),
        });
        if (params.collection) form.append("collection", params.collection);
        form.append("type", params.type);
        if (params.title) form.append("title", params.title);
        form.append("chunk_size", String(params.chunk_size));
        form.append("chunk_overlap", String(params.chunk_overlap));

        const axiosInstance = getApiClient().getAxiosInstance();
        const res = await axiosInstance.post<any>("/memory/documents/extract", form, {
          headers: form.getHeaders(),
          timeout: 180_000,
          maxContentLength: 500 * 1024 * 1024,
          maxBodyLength: 500 * 1024 * 1024,
        });
        const data = res.data;
        const billing = extractBilling(res.headers as Record<string, string>);

        if (!data?.success) {
          return respond(
            `**Document upload failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const info = data.data || {};
        const md = [
          `**Document ingested**: \`${info.filename || path.basename(absPath)}\``,
          `Collection: ${info.collection_id || "personal"}${info.collection_label ? ` (${info.collection_label})` : ""}`,
          `Chunks: ${info.chunks} · Characters: ${info.characters}`,
          info.metadata?.page_count ? `Pages: ${info.metadata.page_count}` : null,
          info.metadata?.detected_languages ? `Languages: ${(info.metadata.detected_languages || []).join(", ")}` : null,
          `Type: ${info.memory_type || params.type}`,
          fmtBillingHint(billing),
        ].filter(Boolean).join("\n");
        return respond(md, { ...data, billing }, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );
  if (!allowLocalFiles) {
    uploadDocumentTool.remove();
  }

  // ── sixtydb_memory_search ──────────────────────────────
  server.registerTool(
    "sixtydb_memory_search",
    {
      title: "Search memories",
      description: `Hybrid semantic + keyword search over a memory collection with optional cross-encoder reranking.

Combines vector similarity (semantic) with BM25 keyword scoring, with optional knowledge-graph context. Searches both user memories and knowledge documents in one call.

**Modes:**
- \`fast\` — single-query dense retrieval (~100-200ms). Best for simple lookups.
- \`thinking\` — fetches a wider candidate pool and applies cross-encoder reranking for higher precision (~200-400ms). Best for complex or multi-faceted questions.

**Billing**: flat $0.0003 per query regardless of \`max_results\` or \`mode\`.

**Parameters:**
- \`query\` (string, required): Search query (max 2,000 chars)
- \`collection\` (string, optional): Collection to search — defaults to personal
- \`mode\` (string, optional): \`fast\` or \`thinking\` (default: fast)
- \`max_results\` (number, optional): Max results (1-50, default: 10)
- \`alpha\` (number, optional): 0=keyword only, 1=semantic only (default: 0.8)
- \`recency_bias\` (number, optional): Weight given to newer memories (0-1, default: 0)
- \`graph_context\` (boolean, optional): Include knowledge-graph relationships (default: false)

**Advanced reranker knobs** (optional — override server defaults):
- \`rerank_top_k\` (number): Max candidates to rerank (1-500)
- \`rerank_timeout_ms\` (number): Hard timeout for rerank call (50-5000ms)
- \`min_rerank_score\` (number): Drop results below this score (0-1)
- \`fetch_multiplier\` (number): In thinking mode, fetch N × max_results candidates (1-10)

**Tuning by query type:**
- Exact phrase match → alpha=0.2, mode=fast
- Conceptual question → alpha=0.9, mode=fast
- Complex multi-faceted question → alpha=0.7, mode=thinking
- Latest-events focus → alpha=0.6, recency_bias=0.3`,
      inputSchema: MemorySearchSchema,
      annotations: {
        title: "Search memories",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MemorySearchParams) => {
      try {
        const body: Record<string, unknown> = {
          query: params.query,
          mode: params.mode,
          max_results: params.max_results,
          alpha: params.alpha,
          recency_bias: params.recency_bias,
          graph_context: params.graph_context,
        };
        if (params.collection) body.collection = params.collection;
        if (params.rerank_top_k != null) body.rerank_top_k = params.rerank_top_k;
        if (params.rerank_timeout_ms != null) body.rerank_timeout_ms = params.rerank_timeout_ms;
        if (params.min_rerank_score != null) body.min_rerank_score = params.min_rerank_score;
        if (params.fetch_multiplier != null) body.fetch_multiplier = params.fetch_multiplier;

        const { data, headers } = await postWithHeaders<any>("/memory/search", body);
        const billing = extractBilling(headers);
        if (!data?.success) {
          return respond(
            `**Search failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const d = data.data || {};
        const sources = d.sources || [];
        const rerankerMode = d.trace?.rerank?.mode || "off";
        const md = [
          `**Search results** for "${params.query}"`,
          `Found ${sources.length} sources · ${d.total_chunks ?? 0} chunks · ${d.latency_ms ?? "?"}ms` +
            (rerankerMode !== "off" ? ` · reranker: ${rerankerMode}` : ""),
          "",
          ...sources.slice(0, params.max_results).map((s: any, i: number) => {
            const text = (s.text || "").slice(0, 240);
            const dense = typeof s.score === "number" ? s.score.toFixed(3) : "?";
            const rerank = typeof s.rerank_score === "number" ? ` rerank=${s.rerank_score.toFixed(4)}` : "";
            return `**${i + 1}.** (score ${dense}${rerank})${s.title ? ` _${s.title}_` : ""}\n> ${text}${(s.text || "").length > 240 ? "…" : ""}`;
          }),
          fmtBillingHint(billing),
        ].filter(Boolean).join("\n");
        return respond(md, { ...data, billing }, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_context ─────────────────────────────
  server.registerTool(
    "sixtydb_memory_context",
    {
      title: "Assemble LLM-ready context",
      description: `Assemble a pre-formatted context string ready to prepend to an LLM prompt.

Combines user profile/preferences, relevant memories (hybrid search), graph insights, and recent events into a single \`prompt_ready\` string. Purpose-built for retrieval-augmented generation.

**Billing**: flat $0.0005 per query.

**Returns** a \`prompt_ready\` string and a structured \`context\` object. Prepend \`prompt_ready\` to your system message before calling the LLM.

**Parameters:**
- \`query\` (string, required): The user's query — drives the retrieval
- \`session_id\` (string, optional): Chat session ID for hierarchical context
- \`top_k\` (number, optional): Max memories to pull (default: 10)
- \`max_context_length\` (number, optional): Max assembled tokens (default: 4000)
- \`include_graph\` (boolean, optional): Include entity relationships (default: false)
- \`include_timeline\` (boolean, optional): Include recent events (default: true)

**Graceful degradation**: if the memory layer is unreachable, returns \`prompt_ready: ""\` and \`success: true\` so your chat flow keeps working. The charge is automatically refunded in that case.`,
      inputSchema: MemoryContextSchema,
      annotations: {
        title: "Assemble context",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MemoryContextParams) => {
      try {
        const body: Record<string, unknown> = {
          query: params.query,
          top_k: params.top_k,
          max_context_length: params.max_context_length,
          include_graph: params.include_graph,
          include_timeline: params.include_timeline,
        };
        if (params.session_id) body.session_id = params.session_id;

        const { data, headers } = await postWithHeaders<any>("/memory/context", body);
        const billing = extractBilling(headers);
        if (!data?.success) {
          return respond(
            `**Context assembly failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const d = data.data || {};
        const prompt = d.prompt_ready || "";
        const md = [
          `**LLM-ready context** for "${params.query}"`,
          prompt
            ? "```\n" + prompt.slice(0, 2000) + (prompt.length > 2000 ? "\n…(truncated)" : "") + "\n```"
            : "_No context assembled — memory layer returned empty (graceful degradation)._",
          fmtBillingHint(billing),
        ].filter(Boolean).join("\n\n");
        return respond(md, { ...data, billing }, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_list_collections ────────────────────
  server.registerTool(
    "sixtydb_memory_list_collections",
    {
      title: "List memory collections",
      description: `List all memory collections visible to the caller in the current workspace.

Collections group related memories. Each workspace has automatic per-user personal collections plus any team/knowledge/hive collections created by owners/admins.

**Kinds:**
- \`personal\` — only visible to the owning user
- \`team\` — shared with all workspace members
- \`knowledge\` — read-only reference content, shared
- \`hive\` — cross-collection workspace-wide shared facts

**Unbilled** — this operation is always free, even when the wallet is empty.`,
      inputSchema: MemoryCollectionsListSchema,
      annotations: {
        title: "List collections",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MemoryCollectionsListParams) => {
      try {
        const { data } = await getWithHeaders<any>("/memory/collections");
        if (!data?.success) {
          return respond(
            `**Failed to list collections**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const cols = data.data || [];
        const md = [
          `**Collections** (${cols.length}):`,
          "",
          ...cols.map((c: any) => `- **${c.label || c.collection_id}** — \`${c.collection_id}\` (${c.kind})${c.shared ? " · shared" : ""}`),
        ].join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_create_collection ───────────────────
  server.registerTool(
    "sixtydb_memory_create_collection",
    {
      title: "Create a memory collection",
      description: `Create a new team, knowledge, or hive collection in the current workspace.

**Only workspace owners and admins** can create team/knowledge/hive collections. Personal collections are auto-created on first use by each user and cannot be created via this tool.

**Unbilled**. Returns \`403 POLICY_DENY\` if the caller's role doesn't allow creating the requested kind.

**Parameters:**
- \`collection_id\` (string, required): Unique ID — lowercase, alphanumeric + underscores
- \`label\` (string, required): Human-readable display name
- \`kind\` (string, optional): \`team\` | \`knowledge\` | \`hive\` (default: \`team\`)
- \`shared\` (boolean, optional): Whether the collection is shared with workspace members (default: true)`,
      inputSchema: MemoryCollectionCreateSchema,
      annotations: {
        title: "Create collection",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: MemoryCollectionCreateParams) => {
      try {
        const body: Record<string, unknown> = {
          collection_id: params.collection_id,
          label: params.label,
          kind: params.kind,
          shared: params.shared,
        };
        if (params.metadata) body.metadata = params.metadata;
        const { data } = await postWithHeaders<any>("/memory/collections", body);
        if (!data?.success) {
          return respond(
            `**Collection create failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const c = data.data || {};
        const md = [
          `**Collection created**: \`${c.collection_id}\``,
          `Label: ${c.label}`,
          `Kind: ${c.kind}`,
          `Shared: ${c.shared ? "yes" : "no"}`,
        ].join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_get_usage ───────────────────────────
  server.registerTool(
    "sixtydb_memory_get_usage",
    {
      title: "Get memory usage and spend",
      description: `Return the workspace owner's memory spend over a given period, broken down by operation type.

Always free, works even when the wallet is empty. Use this to:
- Power a "memory spend" widget
- Alert on daily/monthly spend thresholds
- Reconcile refunds against original charges

**Parameters:**
- \`period\` (string, optional): \`current_month\` (default) | \`last_30_days\` | \`all_time\`

**Returns** per-service-type breakdown with \`net_spend_usd\`, \`gross_units\`, \`operation_count\`, and \`refund_count\`, plus the billing owner's current wallet balance.`,
      inputSchema: MemoryUsageSchema,
      annotations: {
        title: "Get usage",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MemoryUsageParams) => {
      try {
        const { data } = await getWithHeaders<any>("/memory/usage", { period: params.period });
        if (!data?.success) {
          return respond(
            `**Usage fetch failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const u = data.data || {};
        const rows = Object.entries(u.by_service || {}).map(([service, info]: [string, any]) => {
          return `| ${service} | $${(info.net_spend_usd || 0).toFixed(6)} | ${info.operation_count || 0} | ${info.refund_count || 0} |`;
        });
        const md = [
          `**Memory usage** (${u.period})`,
          `Workspace: ${u.workspace_id}`,
          u.billing_owner ? `Billing owner: ${u.billing_owner.name} — wallet **$${(u.billing_owner.current_balance_usd || 0).toFixed(6)}**` : null,
          "",
          `**Total**: $${(u.total?.net_spend_usd || 0).toFixed(6)} net spend · ${u.total?.operations || 0} operations · ${u.total?.refunds || 0} refunds`,
          "",
          rows.length ? "| Service | Net spend | Ops | Refunds |" : null,
          rows.length ? "|---|---|---|---|" : null,
          ...rows,
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_get_status ──────────────────────────
  server.registerTool(
    "sixtydb_memory_get_status",
    {
      title: "Get memory ingestion status",
      description: `Poll the processing status of a specific memory by ID.

Memories are ingested asynchronously. After calling \`sixtydb_memory_ingest\` or \`sixtydb_memory_ingest_batch\`, the returned IDs transition through: \`pending\` → \`processing\` → \`ready\` (or \`failed\`).

**Unbilled**.

**Parameters:**
- \`id\` (string, required): Memory ID returned from an ingest call
- \`collection\` (string, optional): Collection the memory belongs to — helps with cross-collection lookups`,
      inputSchema: MemoryStatusSchema,
      annotations: {
        title: "Get memory status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MemoryStatusParams) => {
      try {
        const { data } = await getWithHeaders<any>(
          `/memory/${encodeURIComponent(params.id)}/status`,
          params.collection ? { collection: params.collection } : undefined
        );
        if (!data?.success) {
          return respond(
            `**Status fetch failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        const s = data.data || data;
        const md = [
          `**Memory** \`${s.memory_id || params.id}\``,
          `Status: **${s.status || "unknown"}**`,
          s.memory_type ? `Type: ${s.memory_type}` : null,
          s.created_at ? `Created: ${s.created_at}` : null,
          s.updated_at ? `Updated: ${s.updated_at}` : null,
          s.error_message ? `Error: ${s.error_message}` : null,
        ].filter(Boolean).join("\n");
        return respond(md, data, params.response_format);
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );

  // ── sixtydb_memory_delete ──────────────────────────────
  server.registerTool(
    "sixtydb_memory_delete",
    {
      title: "Delete a memory",
      description: `Soft-delete a memory by ID. A 24-hour undo grace period applies before the memory is hard-deleted.

**Unbilled**.

**Parameters:**
- \`id\` (string, required): Memory ID to delete
- \`collection\` (string, optional): Collection context
- \`type\` (string, optional): Memory type (default: \`user\`)

**Authorization**: You can delete memories you created. Workspace admins and owners can delete any memory.`,
      inputSchema: MemoryDeleteSchema,
      annotations: {
        title: "Delete memory",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: MemoryDeleteParams) => {
      try {
        const axiosInstance = getApiClient().getAxiosInstance();
        const res = await axiosInstance.delete<any>(
          `/memory/${encodeURIComponent(params.id)}`,
          { params: { collection: params.collection, type: params.type } }
        );
        const data = res.data;
        if (!data?.success) {
          return respond(
            `**Delete failed**: ${data?.message || "unknown"}`,
            data,
            params.response_format
          );
        }
        return respond(
          `**Memory deleted** (undoable for 24h): \`${params.id}\``,
          data,
          params.response_format
        );
      } catch (error) {
        return { content: [{ type: "text" as const, text: formatErrorMessage(error as Error) }] };
      }
    }
  );
}
