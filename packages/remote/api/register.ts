/**
 * OAuth Dynamic Client Registration Endpoint
 * Directly handles POST /api/register without Hono to avoid body stream issues
 */

import type { IncomingMessage, ServerResponse } from "node:http";

function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const bodyText = await readBody(req);
    const body = bodyText ? JSON.parse(bodyText) : {};

    const clientId = `mcp_${generateRandomString(16)}`;

    const response = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: body.redirect_uris || [],
      client_name: body.client_name || "MCP Client",
    };

    res.statusCode = 200;
    res.end(JSON.stringify(response));
  } catch (err) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: "invalid_client_metadata",
        error_description: err instanceof Error ? err.message : "Invalid request",
      }),
    );
  }
}
