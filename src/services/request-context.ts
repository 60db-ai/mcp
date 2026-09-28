/**
 * Per-request API client context for the hosted (HTTP) transport.
 *
 * Tools call getApiClient() at execution time. In stdio mode that returns the
 * process-wide singleton built from env vars; in HTTP mode every request runs
 * inside runWithApiClient(), so tools transparently use the caller's own
 * Bearer token without any change to the tool files.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { QLabsApiClient } from "./api-client.js";

const requestClientStorage = new AsyncLocalStorage<QLabsApiClient>();

export function runWithApiClient<T>(client: QLabsApiClient, fn: () => Promise<T>): Promise<T> {
  return requestClientStorage.run(client, fn);
}

export function getRequestApiClient(): QLabsApiClient | undefined {
  return requestClientStorage.getStore();
}
