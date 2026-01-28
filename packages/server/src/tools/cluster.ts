/**
 * Cluster management tools for TiDB Cloud MCP Server
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TiDBCloudClient, formatApiError } from "../api/client.js";
import type { Cluster } from "../api/types.js";

// ============================================================================
// Zod Schemas
// ============================================================================

const ListClustersInputSchema = z
    .object({
        pageSize: z
            .number()
            .min(1)
            .max(100)
            .optional()
            .describe("Number of clusters per page (1-100, default 10)"),
        pageToken: z
            .string()
            .optional()
            .describe("Token for fetching the next page of results"),
    })
    .strict();

const GetClusterInputSchema = z
    .object({
        clusterId: z
            .string()
            .min(1, "Cluster ID is required")
            .describe("The ID of the TiDB Cloud cluster"),
    })
    .strict();

const CreateClusterInputSchema = z
    .object({
        displayName: z
            .string()
            .min(1, "Display name is required")
            .max(64, "Display name must not exceed 64 characters")
            .describe("Display name for the new cluster"),
        region: z
            .string()
            .min(1, "Region is required")
            .describe(
                "Cloud region name for the cluster. Use tidbcloud_list_regions to get valid region names.",
            ),
        rootPassword: z
            .string()
            .optional()
            .describe(
                "Root password for the cluster. If not provided, a random password will be generated",
            ),
        spendingLimitMonthly: z
            .number()
            .min(0)
            .optional()
            .describe("Monthly spending limit in USD (0 for no limit)"),
        labels: z
            .record(z.string())
            .optional()
            .describe("Key-value labels for the cluster"),
    })
    .strict();

const UpdateClusterInputSchema = z
    .object({
        clusterId: z
            .string()
            .min(1, "Cluster ID is required")
            .describe("The ID of the TiDB Cloud cluster to update"),
        displayName: z
            .string()
            .max(64, "Display name must not exceed 64 characters")
            .optional()
            .describe("New display name for the cluster"),
        spendingLimitMonthly: z
            .number()
            .min(0)
            .optional()
            .describe("Monthly spending limit in USD (0 for no limit)"),
        labels: z
            .record(z.string())
            .optional()
            .describe("Key-value labels for the cluster"),
    })
    .strict();

const DeleteClusterInputSchema = z
    .object({
        clusterId: z
            .string()
            .min(1, "Cluster ID is required")
            .describe("The ID of the TiDB Cloud cluster to delete"),
    })
    .strict();

type ListClustersInput = z.infer<typeof ListClustersInputSchema>;
type GetClusterInput = z.infer<typeof GetClusterInputSchema>;
type CreateClusterInput = z.infer<typeof CreateClusterInputSchema>;
type UpdateClusterInput = z.infer<typeof UpdateClusterInputSchema>;
type DeleteClusterInput = z.infer<typeof DeleteClusterInputSchema>;

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats a single cluster into a readable string
 */
function formatClusterOutput(cluster: Cluster, title: string): string {
    const lines = [
        `# ${title}`,
        "",
        `**Cluster ID:** ${cluster.clusterId}`,
        `**Display Name:** ${cluster.displayName}`,
        `**State:** ${cluster.state}`,
        `**Region:** ${cluster.region.displayName} (${cluster.region.name})`,
        `**Provider:** ${cluster.region.provider}`,
        `**Version:** ${cluster.version}`,
        `**Created At:** ${cluster.createdAt}`,
        `**Created By:** ${cluster.createdBy}`,
        `**User Prefix:** ${cluster.userPrefix}`,
    ];

    if (cluster.spendingLimit) {
        lines.push(
            `**Spending Limit:** $${cluster.spendingLimit.monthly}/month`,
        );
    }

    if (cluster.endpoints?.public) {
        lines.push("");
        lines.push("## Connection Details (Public Endpoint)");
        lines.push(`**Host:** ${cluster.endpoints.public.host}`);
        lines.push(`**Port:** ${cluster.endpoints.public.port}`);
        if (cluster.endpoints.public.disabled) {
            lines.push(`**Status:** Disabled`);
        }
    }

    if (cluster.usage) {
        lines.push("");
        lines.push("## Usage");
        lines.push(`**Request Units:** ${cluster.usage.requestUnit}`);
        lines.push(`**Row Storage:** ${cluster.usage.rowBasedStorage}`);
        lines.push(`**Columnar Storage:** ${cluster.usage.columnarStorage}`);
    }

    if (cluster.labels && Object.keys(cluster.labels).length > 0) {
        lines.push("");
        lines.push("## Labels");
        for (const [key, value] of Object.entries(cluster.labels)) {
            lines.push(`- ${key}: ${value}`);
        }
    }

    if (cluster.rootPassword) {
        lines.push("");
        lines.push("## Credentials");
        lines.push(`**Root Password:** ${cluster.rootPassword}`);
        lines.push(
            "> **Important:** Save this password securely. It will not be shown again.",
        );
    }

    return lines.join("\n");
}

/**
 * Formats a list of clusters into a readable string
 */
function formatClusterListOutput(
    clusters: Cluster[],
    nextPageToken?: string,
    totalSize?: number,
): string {
    if (clusters.length === 0) {
        return "No clusters found.";
    }

    const lines = [
        `# TiDB Cloud Clusters`,
        "",
        `Found ${totalSize ?? clusters.length} cluster(s).`,
        "",
    ];

    for (const cluster of clusters) {
        lines.push(`## ${cluster.displayName}`);
        lines.push(`- **ID:** ${cluster.clusterId}`);
        lines.push(`- **State:** ${cluster.state}`);
        lines.push(
            `- **Region:** ${cluster.region.displayName} (${cluster.region.provider})`,
        );
        if (cluster.endpoints?.public) {
            lines.push(`- **Host:** ${cluster.endpoints.public.host}`);
        }
        lines.push(`- **Created:** ${cluster.createdAt}`);
        lines.push("");
    }

    if (nextPageToken) {
        lines.push("---");
        lines.push(
            `More clusters available. Use pageToken: "${nextPageToken}" to fetch the next page.`,
        );
    }

    return lines.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers cluster-related tools with the MCP server
 */
export function registerClusterTools(
    server: McpServer,
    client: TiDBCloudClient,
): void {
    // ========================================================================
    // List Clusters
    // ========================================================================
    server.registerTool(
        "tidbcloud_list_clusters",
        {
            title: "List TiDB Cloud Clusters",
            description: `Lists all TiDB Cloud Serverless clusters in your organization.

Returns a paginated list of clusters with their basic information including
cluster ID, display name, state, region, and connection details.

Args:
  - pageSize (number, optional): Number of clusters per page (1-100, default 10)
  - pageToken (string, optional): Token for fetching the next page

Returns:
  List of clusters with their details and pagination info.`,
            inputSchema: ListClustersInputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async (params: ListClustersInput) => {
            try {
                const response = await client.listClusters(
                    params.pageSize,
                    params.pageToken,
                );

                const textContent = formatClusterListOutput(
                    response.clusters,
                    response.nextPageToken,
                    response.totalSize,
                );

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: {
                        clusters: response.clusters.map((c) => ({
                            clusterId: c.clusterId,
                            displayName: c.displayName,
                            state: c.state,
                            region: c.region,
                            endpoints: c.endpoints,
                        })),
                        nextPageToken: response.nextPageToken,
                        totalSize: response.totalSize,
                    },
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: formatApiError(error) }],
                };
            }
        },
    );

    // ========================================================================
    // Get Cluster
    // ========================================================================
    server.registerTool(
        "tidbcloud_get_cluster",
        {
            title: "Get TiDB Cloud Cluster",
            description: `Gets detailed information about a specific TiDB Cloud cluster.

Returns comprehensive cluster details including connection information,
usage statistics, spending limits, and configuration.

Args:
  - clusterId (string, required): The ID of the cluster

Returns:
  Complete cluster details including endpoints, usage, and configuration.`,
            inputSchema: GetClusterInputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async (params: GetClusterInput) => {
            try {
                const cluster = await client.getCluster(params.clusterId);
                const textContent = formatClusterOutput(
                    cluster,
                    "Cluster Details",
                );

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: { ...cluster },
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: formatApiError(error) }],
                };
            }
        },
    );

    // ========================================================================
    // Create Cluster
    // ========================================================================
    server.registerTool(
        "tidbcloud_create_cluster",
        {
            title: "Create TiDB Cloud Cluster",
            description: `Creates a new TiDB Cloud Serverless cluster.

This operation is asynchronous. The cluster will be in CREATING state initially
and will transition to ACTIVE state once ready (typically 1-2 minutes).

**IMPORTANT:** Use tidbcloud_list_regions first to get valid region names.

Args:
  - displayName (string, required): Display name for the cluster (max 64 chars)
  - region (string, required): Cloud region name from tidbcloud_list_regions
  - rootPassword (string, optional): Root password. Auto-generated if not provided
  - spendingLimitMonthly (number, optional): Monthly spending limit in USD
  - labels (object, optional): Key-value labels for the cluster

Returns:
  Created cluster details with CREATING state. Use tidbcloud_get_cluster to
  check when it becomes ACTIVE.`,
            inputSchema: CreateClusterInputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
        },
        async (params: CreateClusterInput) => {
            try {
                const cluster = await client.createCluster({
                    displayName: params.displayName,
                    region: { name: params.region },
                    rootPassword: params.rootPassword,
                    spendingLimit: params.spendingLimitMonthly
                        ? { monthly: params.spendingLimitMonthly }
                        : undefined,
                    labels: params.labels,
                });

                let textContent = formatClusterOutput(
                    cluster,
                    "Cluster Creation Initiated",
                );
                textContent += "\n\n";
                textContent +=
                    "> **Note:** The cluster is being created. This typically takes 1-2 minutes.\n";
                textContent +=
                    "> Use `tidbcloud_get_cluster` to check when state changes from CREATING to ACTIVE.";

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: { ...cluster },
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: formatApiError(error) }],
                };
            }
        },
    );

    // ========================================================================
    // Update Cluster
    // ========================================================================
    server.registerTool(
        "tidbcloud_update_cluster",
        {
            title: "Update TiDB Cloud Cluster",
            description: `Updates an existing TiDB Cloud cluster's configuration.

You can update the display name, spending limit, and labels.

Args:
  - clusterId (string, required): The ID of the cluster to update
  - displayName (string, optional): New display name (max 64 chars)
  - spendingLimitMonthly (number, optional): Monthly spending limit in USD
  - labels (object, optional): Key-value labels for the cluster

Returns:
  Updated cluster details.`,
            inputSchema: UpdateClusterInputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async (params: UpdateClusterInput) => {
            try {
                const cluster = await client.updateCluster(params.clusterId, {
                    displayName: params.displayName,
                    spendingLimit: params.spendingLimitMonthly
                        ? { monthly: params.spendingLimitMonthly }
                        : undefined,
                    labels: params.labels,
                });

                const textContent = formatClusterOutput(
                    cluster,
                    "Cluster Updated Successfully",
                );

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: { ...cluster },
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: formatApiError(error) }],
                };
            }
        },
    );

    // ========================================================================
    // Delete Cluster
    // ========================================================================
    server.registerTool(
        "tidbcloud_delete_cluster",
        {
            title: "Delete TiDB Cloud Cluster",
            description: `Deletes a TiDB Cloud cluster.

**WARNING: This action is irreversible!** All data in the cluster and its
branches will be permanently deleted.

This operation is asynchronous. The cluster will enter DELETING state and
will be removed once the deletion is complete.

Args:
  - clusterId (string, required): The ID of the cluster to delete

Returns:
  Confirmation of deletion initiation.`,
            inputSchema: DeleteClusterInputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: true,
            },
        },
        async (params: DeleteClusterInput) => {
            try {
                await client.deleteCluster(params.clusterId);

                const textContent = [
                    "# Cluster Deletion Initiated",
                    "",
                    `**Cluster ID:** ${params.clusterId}`,
                    "",
                    "The cluster is being deleted. This process may take a few minutes.",
                    "",
                    "> **Note:** All data in this cluster and its branches will be permanently deleted.",
                ].join("\n");

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: {
                        clusterId: params.clusterId,
                        status: "DELETING",
                    },
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: formatApiError(error) }],
                };
            }
        },
    );
}
