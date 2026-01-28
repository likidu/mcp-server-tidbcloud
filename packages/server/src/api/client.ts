/**
 * TiDB Cloud API client
 */

import { createHash } from "crypto";
import type { Config } from "../config.js";
import type {
  Branch,
  CreateBranchRequest,
  ListBranchesResponse,
  Cluster,
  CreateClusterRequest,
  UpdateClusterRequest,
  ListClustersResponse,
  ListRegionsResponse,
  ApiError,
} from "./types.js";

/**
 * Custom error class for TiDB Cloud API errors
 */
export class TiDBCloudApiError extends Error {
  public readonly statusCode: number;
  public readonly apiError?: ApiError;

  constructor(message: string, statusCode: number, apiError?: ApiError) {
    super(message);
    this.name = "TiDBCloudApiError";
    this.statusCode = statusCode;
    this.apiError = apiError;
  }
}

/**
 * Parses the WWW-Authenticate header to extract digest auth parameters
 */
function parseDigestChallenge(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^,\s]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] || match[3];
  }
  return params;
}

/**
 * Generates MD5 hash
 */
function md5(data: string): string {
  return createHash("md5").update(data).digest("hex");
}

/**
 * Generates a random client nonce
 */
function generateCnonce(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * TiDB Cloud API client for making authenticated requests using Digest Authentication
 */
export class TiDBCloudClient {
  private readonly baseUrl: string;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly timeout: number;

  constructor(config: Config, timeout = 30000) {
    this.baseUrl = config.apiBaseUrl;
    this.publicKey = config.publicKey;
    this.privateKey = config.privateKey;
    this.timeout = timeout;
  }

  /**
   * Creates the Digest Authorization header
   */
  private createDigestHeader(
    method: string,
    uri: string,
    challenge: Record<string, string>,
  ): string {
    const realm = challenge.realm;
    const nonce = challenge.nonce;
    const qop = challenge.qop;
    const cnonce = generateCnonce();
    const nc = "00000001";

    // Calculate HA1 = MD5(username:realm:password)
    const ha1 = md5(`${this.publicKey}:${realm}:${this.privateKey}`);

    // Calculate HA2 = MD5(method:uri)
    const ha2 = md5(`${method}:${uri}`);

    // Calculate response
    let response: string;
    if (qop) {
      // MD5(HA1:nonce:nc:cnonce:qop:HA2)
      response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    } else {
      // MD5(HA1:nonce:HA2)
      response = md5(`${ha1}:${nonce}:${ha2}`);
    }

    // Build the Authorization header
    let header = `Digest username="${this.publicKey}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;

    if (qop) {
      header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    }

    if (challenge.opaque) {
      header += `, opaque="${challenge.opaque}"`;
    }

    return header;
  }

  /**
   * Makes an authenticated request to the TiDB Cloud API using Digest Authentication
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // First request without auth to get the challenge
      const initialResponse = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      // If we get 401, extract the digest challenge and retry
      if (initialResponse.status === 401) {
        const wwwAuth = initialResponse.headers.get("www-authenticate");
        if (!wwwAuth || !wwwAuth.toLowerCase().startsWith("digest")) {
          throw new TiDBCloudApiError(
            "Server did not return a Digest authentication challenge",
            401,
          );
        }

        const challenge = parseDigestChallenge(wwwAuth);
        const authHeader = this.createDigestHeader(method, path, challenge);

        // Retry with digest auth
        const authResponse = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: authHeader,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return this.handleResponse<T>(authResponse);
      }

      clearTimeout(timeoutId);
      return this.handleResponse<T>(initialResponse);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof TiDBCloudApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new TiDBCloudApiError(
            "Request timed out. Please try again.",
            408,
          );
        }
        throw new TiDBCloudApiError(`Network error: ${error.message}`, 0);
      }

      throw new TiDBCloudApiError("An unexpected error occurred", 0);
    }
  }

  /**
   * Handles the API response
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    const responseText = await response.text();
    let data: unknown;

    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new TiDBCloudApiError(
        `Failed to parse API response: ${responseText}`,
        response.status,
      );
    }

    if (!response.ok) {
      const apiError = data as ApiError;
      throw new TiDBCloudApiError(
        apiError.message || `API request failed with status ${response.status}`,
        response.status,
        apiError,
      );
    }

    return data as T;
  }

  /**
   * Creates a new branch for a TiDB Cloud cluster
   * @param clusterId - The ID of the cluster to create a branch for
   * @param request - Branch creation parameters
   * @returns The created branch details
   */
  async createBranch(
    clusterId: string,
    request: CreateBranchRequest,
  ): Promise<Branch> {
    return this.request<Branch>(
      "POST",
      `/v1beta1/clusters/${clusterId}/branches`,
      request,
    );
  }

  /**
   * Lists all branches for a cluster
   * @param clusterId - The ID of the cluster
   * @returns List of branches
   */
  async listBranches(clusterId: string): Promise<{ branches: Branch[] }> {
    return this.request<{ branches: Branch[] }>(
      "GET",
      `/v1beta1/clusters/${clusterId}/branches`,
    );
  }

  /**
   * Gets details of a specific branch
   * @param clusterId - The ID of the cluster
   * @param branchId - The ID of the branch
   * @returns Branch details
   */
  async getBranch(clusterId: string, branchId: string): Promise<Branch> {
    return this.request<Branch>(
      "GET",
      `/v1beta1/clusters/${clusterId}/branches/${branchId}`,
    );
  }

  /**
   * Deletes a branch
   * @param clusterId - The ID of the cluster
   * @param branchId - The ID of the branch to delete
   */
  async deleteBranch(clusterId: string, branchId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/v1beta1/clusters/${clusterId}/branches/${branchId}`,
    );
  }

  // ========================================================================
  // Cluster Operations
  // ========================================================================

  /**
   * Lists all clusters
   * @param pageSize - Number of clusters per page (default 10)
   * @param pageToken - Token for pagination
   * @returns Paginated list of clusters
   */
  async listClusters(
    pageSize?: number,
    pageToken?: string,
  ): Promise<ListClustersResponse> {
    const params = new URLSearchParams();
    if (pageSize) params.set("pageSize", pageSize.toString());
    if (pageToken) params.set("pageToken", pageToken);
    const query = params.toString();
    const path = `/v1beta1/clusters${query ? `?${query}` : ""}`;
    return this.request<ListClustersResponse>("GET", path);
  }

  /**
   * Gets details of a specific cluster
   * @param clusterId - The ID of the cluster
   * @returns Cluster details
   */
  async getCluster(clusterId: string): Promise<Cluster> {
    return this.request<Cluster>("GET", `/v1beta1/clusters/${clusterId}`);
  }

  /**
   * Creates a new cluster
   * @param request - Cluster creation parameters
   * @returns The created cluster details (state will be CREATING)
   */
  async createCluster(request: CreateClusterRequest): Promise<Cluster> {
    return this.request<Cluster>("POST", "/v1beta1/clusters", request);
  }

  /**
   * Updates an existing cluster
   * @param clusterId - The ID of the cluster to update
   * @param request - Cluster update parameters
   * @returns The updated cluster details
   */
  async updateCluster(
    clusterId: string,
    request: UpdateClusterRequest,
  ): Promise<Cluster> {
    return this.request<Cluster>(
      "PATCH",
      `/v1beta1/clusters/${clusterId}`,
      request,
    );
  }

  /**
   * Deletes a cluster
   * @param clusterId - The ID of the cluster to delete
   */
  async deleteCluster(clusterId: string): Promise<void> {
    await this.request<void>("DELETE", `/v1beta1/clusters/${clusterId}`);
  }

  // ========================================================================
  // Region Operations
  // ========================================================================

  /**
   * Lists all available regions for TiDB Cloud Serverless
   * @returns List of available regions
   */
  async listRegions(): Promise<ListRegionsResponse> {
    return this.request<ListRegionsResponse>("GET", "/v1beta1/regions");
  }

  // ========================================================================
  // Name Resolution Helpers
  // ========================================================================

  /**
   * Resolves a cluster identifier (ID or display name) to a cluster ID
   * @param clusterIdentifier - Either a cluster ID or display name
   * @returns The resolved cluster ID
   * @throws ResourceNotFoundError if no cluster matches
   * @throws AmbiguousResourceError if multiple clusters match
   */
  async resolveClusterId(clusterIdentifier: string): Promise<string> {
    // First, try to fetch directly by ID (most common case)
    try {
      const cluster = await this.getCluster(clusterIdentifier);
      return cluster.clusterId;
    } catch (error) {
      // If it's a 404, the identifier might be a name
      if (error instanceof TiDBCloudApiError && error.statusCode === 404) {
        // Continue to name resolution
      } else {
        throw error;
      }
    }

    // Fetch all clusters and search by name
    const response = await this.listClusters(100);
    const clusters = response.clusters || [];

    // Case-insensitive matching
    const matches = clusters.filter(
      (c) => c.displayName.toLowerCase() === clusterIdentifier.toLowerCase(),
    );

    if (matches.length === 0) {
      // No exact match, try partial match for suggestions
      const partialMatches = clusters.filter((c) =>
        c.displayName.toLowerCase().includes(clusterIdentifier.toLowerCase()),
      );

      throw new ResourceNotFoundError(
        "cluster",
        clusterIdentifier,
        partialMatches.length > 0
          ? partialMatches.map((c) => c.displayName)
          : clusters.map((c) => c.displayName),
      );
    }

    if (matches.length > 1) {
      throw new AmbiguousResourceError(
        "cluster",
        clusterIdentifier,
        matches.map((c) => ({
          id: c.clusterId,
          displayName: c.displayName,
        })),
      );
    }

    return matches[0].clusterId;
  }

  /**
   * Resolves a branch identifier (ID or display name) to a branch ID
   * @param clusterId - The cluster ID (must already be resolved)
   * @param branchIdentifier - Either a branch ID or display name
   * @returns The resolved branch ID
   * @throws ResourceNotFoundError if no branch matches
   * @throws AmbiguousResourceError if multiple branches match
   */
  async resolveBranchId(
    clusterId: string,
    branchIdentifier: string,
  ): Promise<string> {
    // First, try to fetch directly by ID
    try {
      const branch = await this.getBranch(clusterId, branchIdentifier);
      return branch.branchId;
    } catch (error) {
      if (error instanceof TiDBCloudApiError && error.statusCode === 404) {
        // Continue to name resolution
      } else {
        throw error;
      }
    }

    // Fetch all branches and search by name
    const response = await this.listBranches(clusterId);
    const branches = response.branches || [];

    // Case-insensitive matching
    const matches = branches.filter(
      (b) => b.displayName.toLowerCase() === branchIdentifier.toLowerCase(),
    );

    if (matches.length === 0) {
      throw new ResourceNotFoundError(
        "branch",
        branchIdentifier,
        branches.map((b) => b.displayName),
      );
    }

    if (matches.length > 1) {
      throw new AmbiguousResourceError(
        "branch",
        branchIdentifier,
        matches.map((b) => ({
          id: b.branchId,
          displayName: b.displayName,
        })),
      );
    }

    return matches[0].branchId;
  }
}

/**
 * Error thrown when a resource cannot be resolved by name
 */
export class ResourceNotFoundError extends Error {
  constructor(
    public readonly resourceType: "cluster" | "branch",
    public readonly name: string,
    public readonly suggestions?: string[],
  ) {
    const suggestionText =
      suggestions && suggestions.length > 0
        ? ` Available ${resourceType}s: ${suggestions.join(", ")}`
        : "";
    super(
      `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} "${name}" not found.${suggestionText}`,
    );
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Error thrown when multiple resources match a name
 */
export class AmbiguousResourceError extends Error {
  constructor(
    public readonly resourceType: "cluster" | "branch",
    public readonly name: string,
    public readonly matches: Array<{ id: string; displayName: string }>,
  ) {
    const matchList = matches
      .map((m) => `"${m.displayName}" (ID: ${m.id})`)
      .join(", ");
    super(
      `Multiple ${resourceType}s match "${name}": ${matchList}. Please use the cluster ID or provide a more specific name.`,
    );
    this.name = "AmbiguousResourceError";
  }
}

/**
 * Formats an API error into a user-friendly message
 */
export function formatApiError(error: unknown): string {
  if (error instanceof TiDBCloudApiError) {
    switch (error.statusCode) {
      case 400:
        return `Error: Invalid request. ${error.message}`;
      case 401:
        return "Error: Authentication failed. Please check your public key and private key.";
      case 403:
        return "Error: Permission denied. You don't have access to this resource.";
      case 404:
        return "Error: Resource not found. Please check the cluster ID and branch ID.";
      case 409:
        return `Error: Conflict. ${error.message}`;
      case 429:
        return "Error: Rate limit exceeded. Please wait before making more requests.";
      case 408:
        return "Error: Request timed out. Please try again.";
      default:
        if (error.statusCode >= 500) {
          return `Error: TiDB Cloud service error (${error.statusCode}). Please try again later.`;
        }
        return `Error: ${error.message}`;
    }
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return "Error: An unexpected error occurred";
}
