/**
 * API Client for QLabs Backend
 * Handles all HTTP requests with authentication and error handling
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import {
  ApiClientConfig,
  ApiError,
  AuthenticationError,
  RateLimitError,
  ValidationError
} from "../types/index.js";
import {
  API_TIMEOUT,
  ERROR_MESSAGES,
  API_CODES
} from "../constants.js";

export class QLabsApiClient {
  private client: AxiosInstance;
  private apiKey?: string;
  private jwtToken?: string;

  constructor(config: ApiClientConfig) {
    this.apiKey = config.apiKey;
    this.jwtToken = config.jwtToken;

    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || API_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    // Add request interceptor for authentication
    this.client.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers["Authorization"] = `Bearer ${this.apiKey}`;
      } else if (this.jwtToken) {
        config.headers["Authorization"] = `Bearer ${this.jwtToken}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        throw this.handleError(error);
      }
    );
  }

  /**
   * Set or update API key
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.jwtToken = undefined;
  }

  /**
   * Set or update JWT token
   */
  public setJwtToken(token: string): void {
    this.jwtToken = token;
    this.apiKey = undefined;
  }

  /**
   * Clear all authentication
   */
  public clearAuth(): void {
    this.apiKey = undefined;
    this.jwtToken = undefined;
  }

  /**
   * Convert axios errors to our custom error types
   */
  private handleError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data as { message?: string; error?: string; code?: string };
        // Some backends (e.g. the Dialer API) return { success:false, message, code }.
        // Surface the machine-readable code alongside the human message so callers
        // (and MCP tool handlers) can react to specific error codes.
        const codeSuffix = data?.code ? ` (code: ${data.code})` : "";

        switch (status) {
          case API_CODES.UNAUTHORIZED:
            return new AuthenticationError(
              (data?.message || data?.error || ERROR_MESSAGES.INVALID_CREDENTIALS) + codeSuffix
            );

          case API_CODES.FORBIDDEN:
            return new ApiError(
              status,
              (data?.message || data?.error || "Access forbidden") + codeSuffix,
              data
            );

          case API_CODES.NOT_FOUND:
            return new ApiError(
              status,
              (data?.message || data?.error || ERROR_MESSAGES.NOT_FOUND("Resource")) + codeSuffix,
              data
            );

          case API_CODES.RATE_LIMIT: {
            const retryAfter = axiosError.response.headers["retry-after"];
            return new RateLimitError(retryAfter ? parseInt(retryAfter) : undefined);
          }

          case API_CODES.BAD_REQUEST:
            return new ValidationError(
              (data?.message || data?.error || ERROR_MESSAGES.VALIDATION_ERROR) + codeSuffix,
              (data as any)?.errors
            );

          default:
            return new ApiError(
              status,
              (data?.message || data?.error || ERROR_MESSAGES.SERVER_ERROR) + codeSuffix,
              data
            );
        }
      }

      if (axiosError.code === "ECONNABORTED") {
        return new ApiError(API_CODES.SERVER_ERROR, ERROR_MESSAGES.TIMEOUT);
      }

      if (axiosError.code === "ERR_NETWORK") {
        return new ApiError(API_CODES.SERVER_ERROR, ERROR_MESSAGES.NETWORK_ERROR);
      }

      return new ApiError(
        API_CODES.SERVER_ERROR,
        axiosError.message || ERROR_MESSAGES.SERVER_ERROR
      );
    }

    return new ApiError(API_CODES.SERVER_ERROR, ERROR_MESSAGES.SERVER_ERROR);
  }

  /**
   * Make a GET request
   */
  public async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }

  /**
   * Make a POST request
   */
  public async post<T>(endpoint: string, data?: unknown): Promise<T> {
    const response = await this.client.post<T>(endpoint, data);
    return response.data;
  }

  /**
   * Make a PUT request
   */
  public async put<T>(endpoint: string, data?: unknown): Promise<T> {
    const response = await this.client.put<T>(endpoint, data);
    return response.data;
  }

  /**
   * Make a DELETE request
   */
  public async delete<T>(endpoint: string): Promise<T> {
    const response = await this.client.delete<T>(endpoint);
    return response.data;
  }

  /**
   * Make a POST request with multipart/form-data
   */
  public async postMultipart<T>(
    endpoint: string,
    data: FormData,
    onProgress?: (progress: number) => void
  ): Promise<T> {
    const response = await this.client.post<T>(endpoint, data, {
      headers: {
        "Content-Type": "multipart/form-data"
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      }
    });
    return response.data;
  }

  /**
   * Download a file
   */
  public async download(endpoint: string): Promise<Buffer> {
    const response = await this.client.get(endpoint, {
      responseType: "arraybuffer"
    });
    return response.data;
  }

  /**
   * Get the underlying axios instance (for advanced usage)
   */
  public getAxiosInstance(): AxiosInstance {
    return this.client;
  }
}

/**
 * Create a singleton API client instance
 */
let apiClientInstance: QLabsApiClient | null = null;

export function getApiClient(config?: ApiClientConfig): QLabsApiClient {
  if (!apiClientInstance && config) {
    apiClientInstance = new QLabsApiClient(config);
  }

  if (!apiClientInstance) {
    throw new Error("API client not initialized. Provide configuration.");
  }

  return apiClientInstance;
}

export function resetApiClient(): void {
  apiClientInstance = null;
}
