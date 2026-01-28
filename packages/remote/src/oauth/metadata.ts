/**
 * OAuth Protected Resource Metadata (RFC 9728)
 */

import type { Context } from "hono";
import type { Config } from "../config.js";

/**
 * Returns the Protected Resource Metadata document
 * This tells MCP clients how to authenticate with this server
 */
export function createProtectedResourceMetadataHandler(config: Config) {
    return (c: Context) => {
        const host = c.req.header("host") || config.server.serverHost;
        const scheme = c.req.header("x-forwarded-proto") || "https";
        const resource = `${scheme}://${host}`;

        return c.json({
            // The resource identifier (this MCP server)
            resource,

            // Authorization servers that can issue tokens for this resource
            authorization_servers: [
                // Extract base URL from authorize URL
                new URL(config.oauth.authorizeUrl).origin,
            ],

            // Scopes supported by this resource server
            scopes_supported: config.oauth.scopes,

            // How tokens should be presented
            bearer_methods_supported: ["header"],

            // Resource documentation (optional)
            resource_documentation: "https://github.com/likidu/mcp-server-tidbcloud",
        });
    };
}
