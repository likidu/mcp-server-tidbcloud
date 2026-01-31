/**
 * Vercel Serverless Function Entry Point
 *
 * Use @hono/node-server/vercel adapter for Node.js runtime compatibility.
 * The standard hono/vercel adapter expects Web Fetch API Request objects,
 * but Vercel's Node.js runtime passes Node.js IncomingMessage objects.
 *
 * OAuth endpoints are under /api/* which maps directly to Hono routes.
 * Other routes (/, /health, /.well-known/*) are handled via catch-all rewrite.
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
