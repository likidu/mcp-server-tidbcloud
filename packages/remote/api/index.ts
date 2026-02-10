/**
 * Vercel Serverless Function Entry Point
 *
 * Use @hono/node-server/vercel adapter for Node.js runtime compatibility.
 * The standard hono/vercel adapter expects Web Fetch API Request objects,
 * but Vercel's Node.js runtime passes Node.js IncomingMessage objects.
 *
 * Routes (/, /health, /skill.md) are handled via catch-all rewrite.
 * The /mcp endpoint is handled by api/mcp.ts directly.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "@hono/node-server/vercel";
import app from "../dist/app.js";

const honoHandler = handle(app);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  return honoHandler(req, res);
}
