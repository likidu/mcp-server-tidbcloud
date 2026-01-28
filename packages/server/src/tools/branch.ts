/**
 * Branch management tools for TiDB Cloud MCP Server
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TiDBCloudClient,
  formatApiError,
  ResourceNotFoundError,
  AmbiguousResourceError,
} from "../api/client.js";
import type { Branch } from "../api/types.js";

// ============================================================================
// Zod Schemas
// ============================================================================

const ListBranchesInputSchema = z
  .object({
    cluster: z
      .string()
      .min(1, "Cluster name or ID is required")
      .describe(
        "The cluster name or ID. You can use either the display name (e.g., 'my-cluster') or the cluster ID.",
      ),
    pageSize: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Number of branches per page (1-100, default 10)"),
    pageToken: z
      .string()
      .optional()
      .describe("Token for fetching the next page of results"),
  })
  .strict();

const GetBranchInputSchema = z
  .object({
    cluster: z
      .string()
      .min(1, "Cluster name or ID is required")
      .describe(
        "The cluster name or ID. You can use either the display name (e.g., 'my-cluster') or the cluster ID.",
      ),
    branch: z
      .string()
      .min(1, "Branch name or ID is required")
      .describe(
        "The branch name or ID. You can use either the display name (e.g., 'dev-branch') or the branch ID.",
      ),
  })
  .strict();

const CreateBranchInputSchema = z
  .object({
    cluster: z
      .string()
      .min(1, "Cluster name or ID is required")
      .describe(
        "The cluster name or ID to create a branch for. You can use either the display name (e.g., 'my-cluster') or the cluster ID.",
      ),
    displayName: z
      .string()
      .min(1, "Display name is required")
      .max(64, "Display name must not exceed 64 characters")
      .describe("Display name for the new branch"),
    parentId: z
      .string()
      .optional()
      .describe(
        "Parent branch ID. If not specified, the branch is created from the main cluster",
      ),
    parentTimestamp: z
      .string()
      .optional()
      .describe(
        "RFC3339 timestamp for point-in-time branching (e.g., '2024-01-15T10:30:00Z'). " +
          "If not specified, uses the current time. " +
          "For free Starter clusters, only the last 24 hours are available.",
      ),
  })
  .strict();

const DeleteBranchInputSchema = z
  .object({
    cluster: z
      .string()
      .min(1, "Cluster name or ID is required")
      .describe(
        "The cluster name or ID. You can use either the display name (e.g., 'my-cluster') or the cluster ID.",
      ),
    branch: z
      .string()
      .min(1, "Branch name or ID is required")
      .describe(
        "The branch name or ID to delete. You can use either the display name (e.g., 'dev-branch') or the branch ID.",
      ),
  })
  .strict();

type ListBranchesInput = z.infer<typeof ListBranchesInputSchema>;
type GetBranchInput = z.infer<typeof GetBranchInputSchema>;
type CreateBranchInput = z.infer<typeof CreateBranchInputSchema>;
type DeleteBranchInput = z.infer<typeof DeleteBranchInputSchema>;

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats a branch object into a readable string
 */
function formatBranchOutput(branch: Branch, title: string): string {
  const lines = [
    `# ${title}`,
    "",
    `**Branch ID:** ${branch.branchId}`,
    `**Display Name:** ${branch.displayName}`,
    `**Cluster ID:** ${branch.clusterId}`,
    `**State:** ${branch.state}`,
    `**Parent ID:** ${branch.parentId}`,
    `**Created At:** ${branch.createdAt}`,
  ];

  if (branch.endpoints?.public) {
    lines.push("");
    lines.push("## Connection Details (Public Endpoint)");
    lines.push(`**Host:** ${branch.endpoints.public.host}`);
    lines.push(`**Port:** ${branch.endpoints.public.port}`);
  }

  if (branch.createdBy) {
    lines.push("");
    lines.push(`**Created By:** ${branch.createdBy}`);
  }

  return lines.join("\n");
}

/**
 * Formats a list of branches into a readable string
 */
function formatBranchListOutput(
  branches: Branch[],
  clusterId: string,
  nextPageToken?: string,
): string {
  if (branches.length === 0) {
    return `No branches found for cluster ${clusterId}.`;
  }

  const lines = [
    `# Branches for Cluster ${clusterId}`,
    "",
    `Found ${branches.length} branch(es).`,
    "",
  ];

  for (const branch of branches) {
    lines.push(`## ${branch.displayName}`);
    lines.push(`- **Branch ID:** ${branch.branchId}`);
    lines.push(`- **State:** ${branch.state}`);
    lines.push(`- **Parent ID:** ${branch.parentId}`);
    if (branch.endpoints?.public) {
      lines.push(`- **Host:** ${branch.endpoints.public.host}`);
    }
    lines.push(`- **Created:** ${branch.createdAt}`);
    lines.push("");
  }

  if (nextPageToken) {
    lines.push("---");
    lines.push(
      `More branches available. Use pageToken: "${nextPageToken}" to fetch the next page.`,
    );
  }

  return lines.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers branch-related tools with the MCP server
 */
export function registerBranchTools(
  server: McpServer,
  client: TiDBCloudClient,
): void {
  // ========================================================================
  // List Branches
  // ========================================================================
  server.registerTool(
    "tidbcloud_list_branches",
    {
      title: "List TiDB Cloud Branches",
      description: `Lists all branches for a TiDB Cloud cluster.

Returns a list of branches with their basic information including
branch ID, display name, state, and connection details.

Args:
  - cluster (string, required): The cluster name or ID
  - pageSize (number, optional): Number of branches per page (1-100, default 10)
  - pageToken (string, optional): Token for fetching the next page

Returns:
  List of branches with their details.`,
      inputSchema: ListBranchesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListBranchesInput) => {
      try {
        // Resolve cluster name to ID if needed
        const clusterId = await client.resolveClusterId(params.cluster);

        const response = await client.listBranches(clusterId);

        const textContent = formatBranchListOutput(
          response.branches || [],
          clusterId,
        );

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: {
            clusterId: clusterId,
            branches: (response.branches || []).map((b) => ({
              branchId: b.branchId,
              displayName: b.displayName,
              state: b.state,
              parentId: b.parentId,
              endpoints: b.endpoints,
            })),
          },
        };
      } catch (error) {
        if (
          error instanceof ResourceNotFoundError ||
          error instanceof AmbiguousResourceError
        ) {
          return {
            content: [{ type: "text", text: error.message }],
          };
        }
        return {
          content: [{ type: "text", text: formatApiError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // Get Branch
  // ========================================================================
  server.registerTool(
    "tidbcloud_get_branch",
    {
      title: "Get TiDB Cloud Branch",
      description: `Gets detailed information about a specific branch.

Returns comprehensive branch details including connection information and state.
This is useful to check if a branch has finished creating (state: ACTIVE).

Args:
  - cluster (string, required): The cluster name or ID
  - branch (string, required): The branch name or ID

Returns:
  Complete branch details including endpoints and state.`,
      inputSchema: GetBranchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetBranchInput) => {
      try {
        // Resolve cluster and branch names to IDs if needed
        const clusterId = await client.resolveClusterId(params.cluster);
        const branchId = await client.resolveBranchId(clusterId, params.branch);

        const branch = await client.getBranch(clusterId, branchId);
        const textContent = formatBranchOutput(branch, "Branch Details");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: { ...branch },
        };
      } catch (error) {
        if (
          error instanceof ResourceNotFoundError ||
          error instanceof AmbiguousResourceError
        ) {
          return {
            content: [{ type: "text", text: error.message }],
          };
        }
        return {
          content: [{ type: "text", text: formatApiError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // Create Branch
  // ========================================================================
  server.registerTool(
    "tidbcloud_create_branch",
    {
      title: "Create TiDB Cloud Branch",
      description: `Creates a new branch for a TiDB Cloud Starter or Essential cluster.

A branch is an isolated database instance that contains a copy of data from the parent cluster
at a specific point in time. Branches are useful for:
- Feature development in isolation
- Testing without affecting production
- Bug fixes and experimentation

This operation is asynchronous. The branch will be in CREATING state initially
and will transition to ACTIVE state once ready (typically 1-2 minutes).

Args:
  - cluster (string, required): The cluster name or ID
  - displayName (string, required): Display name for the new branch (max 64 characters)
  - parentId (string, optional): Parent branch ID. Defaults to the main cluster
  - parentTimestamp (string, optional): RFC3339 timestamp for point-in-time branching

Returns:
  Branch details including branchId, state, and connection information.

Limitations:
  - Maximum 5 branches per organization (default quota)
  - Cannot branch clusters larger than 100 GiB
  - Free Starter clusters: point-in-time limited to last 24 hours
  - Paid clusters: point-in-time limited to last 14 days

Examples:
  - Create a branch for development: cluster="my-cluster", displayName="dev-feature-x"
  - Create from specific time: cluster="my-cluster", displayName="backup-branch", parentTimestamp="2024-01-15T10:30:00Z"`,
      inputSchema: CreateBranchInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: CreateBranchInput) => {
      try {
        // Resolve cluster name to ID if needed
        const clusterId = await client.resolveClusterId(params.cluster);

        const branch = await client.createBranch(clusterId, {
          displayName: params.displayName,
          parentId: params.parentId,
          parentTimestamp: params.parentTimestamp,
        });

        let textContent = formatBranchOutput(
          branch,
          "Branch Creation Initiated",
        );
        textContent += "\n\n";
        textContent +=
          "> **Note:** The branch is being created. This typically takes 1-2 minutes.\n";
        textContent +=
          "> Use `tidbcloud_get_branch` to check when state changes from CREATING to ACTIVE.";

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: {
            branchId: branch.branchId,
            clusterId: branch.clusterId,
            displayName: branch.displayName,
            state: branch.state,
            parentId: branch.parentId,
            createdAt: branch.createdAt,
            endpoints: branch.endpoints,
          },
        };
      } catch (error) {
        if (
          error instanceof ResourceNotFoundError ||
          error instanceof AmbiguousResourceError
        ) {
          return {
            content: [{ type: "text", text: error.message }],
          };
        }
        return {
          content: [{ type: "text", text: formatApiError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // Delete Branch
  // ========================================================================
  server.registerTool(
    "tidbcloud_delete_branch",
    {
      title: "Delete TiDB Cloud Branch",
      description: `Deletes a branch from a TiDB Cloud cluster.

**WARNING: This action is irreversible!** All data in the branch will be
permanently deleted.

This operation is asynchronous. The branch will enter DELETING state and
will be removed once the deletion is complete.

Args:
  - cluster (string, required): The cluster name or ID
  - branch (string, required): The branch name or ID to delete

Returns:
  Confirmation of deletion initiation.`,
      inputSchema: DeleteBranchInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: DeleteBranchInput) => {
      try {
        // Resolve cluster and branch names to IDs if needed
        const clusterId = await client.resolveClusterId(params.cluster);
        const branchId = await client.resolveBranchId(clusterId, params.branch);

        await client.deleteBranch(clusterId, branchId);

        const textContent = [
          "# Branch Deletion Initiated",
          "",
          `**Cluster ID:** ${clusterId}`,
          `**Branch ID:** ${branchId}`,
          "",
          "The branch is being deleted. This process may take a few minutes.",
          "",
          "> **Note:** All data in this branch will be permanently deleted.",
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: {
            clusterId: clusterId,
            branchId: branchId,
            status: "DELETING",
          },
        };
      } catch (error) {
        if (
          error instanceof ResourceNotFoundError ||
          error instanceof AmbiguousResourceError
        ) {
          return {
            content: [{ type: "text", text: error.message }],
          };
        }
        return {
          content: [{ type: "text", text: formatApiError(error) }],
        };
      }
    },
  );
}
