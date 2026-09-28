/**
 * Billing Tools
 * Tools for invoices and billing history.
 * Plans, subscriptions, and wallet top-ups are managed via the Dashboard only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  InvoicesListSchema,
  InvoiceGetSchema
} from "../schemas/index.js";
import {
  InvoicesListParams,
  InvoiceGetParams
} from "../schemas/index.js";
import { getApiClient } from "../services/api-client.js";
import {
  formatInvoice,
  truncateIfNeeded,
  formatErrorMessage
} from "../services/response-formatter.js";
import { ResponseFormat } from "../types/index.js";

/**
 * Register billing tools
 */
export function registerBillingTools(server: McpServer): void {

  // List invoices
  server.registerTool(
    "sixtydb_list_invoices",
    {
      title: "List Invoices",
      description: `List billing invoices with filtering and pagination.

This tool retrieves invoices for the workspace with payment status, amounts, and download links. There is no date-range filter on this endpoint, and the API does not return a total count — pagination is inferred from whether a full page was returned.

**Parameters:**
- status ('paid' | 'pending' | 'failed', optional): Filter by payment status
- limit (number, optional): Maximum results to return (1-100, default: 20)
- offset (number, optional): Number of results to skip for pagination (default: 0)
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For JSON format:
{
  "count": number,
  "offset": number,
  "invoices": [
    {
      "id": string,
      "amount": number,
      "currency": "USD",
      "status": string,
      "plan_name": string,
      "workspace_name": string,
      "period_start": string,
      "period_end": string,
      "payment_method": string | null,
      "invoice_url": string | null,
      "created_at": string
    }
  ],
  "has_more": boolean,       // best-effort: true when a full page of results was returned
  "next_offset": number
}

**Note:** All billing is USD-only. Wallet top-ups and plan management are done via the Dashboard at https://app.60db.ai.

**Examples:**
- Recent invoices: { "limit": 10 }
- Pending only: { "status": "pending" }

**Error Handling:**
- Returns "Error: Authentication required" if API key/JWT is invalid`,
      inputSchema: InvoicesListSchema,
      annotations: {
        title: "List Invoices",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: InvoicesListParams) => {
      try {
        const apiClient = getApiClient();

        const queryParams: Record<string, unknown> = {
          limit: params.limit,
          offset: params.offset
        };

        if (params.status) queryParams.status = params.status;

        // GET /billing/invoices returns { success, message, data: [...] } —
        // no `total` count is provided by the API.
        const data = await apiClient.get<{ data: unknown[] }>("/billing/invoices", queryParams);

        const invoices = data.data || [];
        // Best-effort: a full page suggests more results may exist.
        const hasMore = invoices.length === params.limit;

        const lines: string[] = [];
        lines.push(`# Invoices (showing ${invoices.length} at offset ${params.offset})`);
        lines.push("");

        for (const invoice of invoices as any) {
          lines.push(formatInvoice(invoice, params.response_format));
        }

        if (hasMore) {
          lines.push(`---\n**More results may be available.** Use offset=${params.offset + invoices.length} to see more.`);
        }

        if (params.response_format === ResponseFormat.JSON) {
          const response = {
            count: invoices.length,
            offset: params.offset,
            invoices,
            has_more: hasMore,
            next_offset: hasMore ? params.offset + invoices.length : undefined
          };

          const formatted = JSON.stringify(response, null, 2);

          const { content } = truncateIfNeeded(formatted, true);

          return {
            content: [{ type: "text", text: content }]
          };
        }

        const { content } = truncateIfNeeded(lines.join("\n"), false);

        return {
          content: [{ type: "text", text: content }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: formatErrorMessage(error as Error)
          }]
        };
      }
    }
  );

  // Get invoice details
  server.registerTool(
    "sixtydb_get_invoice",
    {
      title: "Get Invoice Details",
      description: `Get detailed information about a specific invoice.

This tool retrieves complete details for a single invoice including payment status and download links.

**Parameters:**
- id (string, required): Invoice ID
- response_format ('markdown' | 'json', optional): Output format (default: 'markdown')

**Returns:**
For Markdown format (default):
- Complete invoice details
- Payment status and dates
- Download link for PDF

For JSON format:
{
  "id": string,
  "amount": number,
  "currency": "USD",
  "status": string,
  "plan": { "name": string, "description": string },
  "workspace": { "name": string },
  "user": { "name": string, "email": string },
  "period": { "start": string, "end": string },
  "payment_method": string | null,
  "invoice_url": string | null,
  "created_at": string,
  "updated_at": string
}

**Examples:**
- Get invoice details: { "id": "inv_abc123" }

**Error Handling:**
- Returns "Error: Invoice not found" if ID doesn't exist (404 status)`,
      inputSchema: InvoiceGetSchema,
      annotations: {
        title: "Get Invoice Details",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: InvoiceGetParams) => {
      try {
        const apiClient = getApiClient();

        // GET /billing/invoices/:id returns { success, message, data: {...} }.
        const response = await apiClient.get<{ data: unknown }>(`/billing/invoices/${params.id}`);

        const formatted = formatInvoice(response.data as any, params.response_format);

        const { content } = truncateIfNeeded(
          formatted,
          params.response_format === ResponseFormat.JSON
        );

        return {
          content: [{ type: "text", text: content }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: formatErrorMessage(error as Error)
          }]
        };
      }
    }
  );
}
