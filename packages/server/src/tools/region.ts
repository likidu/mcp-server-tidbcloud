/**
 * Region tools for TiDB Cloud MCP Server
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TiDBCloudClient, formatApiError } from "../api/client.js";
import type { Region } from "../api/types.js";

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats a list of regions into a readable string
 */
function formatRegionListOutput(regions: Region[]): string {
    if (regions.length === 0) {
        return "No regions available.";
    }

    const lines = [
        "# Available TiDB Cloud Serverless Regions",
        "",
        "Use the **Name** value when creating clusters.",
        "",
    ];

    // Group by provider
    const byProvider: Record<string, Region[]> = {};
    for (const region of regions) {
        const provider = region.provider || "Unknown";
        if (!byProvider[provider]) {
            byProvider[provider] = [];
        }
        byProvider[provider].push(region);
    }

    for (const [provider, providerRegions] of Object.entries(byProvider)) {
        lines.push(`## ${provider}`);
        lines.push("");
        lines.push("| Name | Display Name |");
        lines.push("|------|--------------|");
        for (const region of providerRegions) {
            lines.push(`| \`${region.name}\` | ${region.displayName} |`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers region-related tools with the MCP server
 */
export function registerRegionTools(
    server: McpServer,
    client: TiDBCloudClient,
): void {
    // ========================================================================
    // List Regions
    // ========================================================================
    server.registerTool(
        "tidbcloud_list_regions",
        {
            title: "List TiDB Cloud Regions",
            description: `Lists all available regions for TiDB Cloud Serverless clusters.

Returns the list of regions where you can create TiDB Cloud Serverless clusters.
Each region has a name (used when creating clusters), display name, and cloud provider.

Use this tool to discover valid region values before creating a cluster.

Returns:
  List of regions grouped by cloud provider (AWS, GCP, etc.).`,
            inputSchema: {},
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async () => {
            try {
                const response = await client.listRegions();

                const textContent = formatRegionListOutput(response.regions);

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: {
                        regions: response.regions.map((r) => ({
                            name: r.name,
                            displayName: r.displayName,
                            provider: r.provider,
                        })),
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
