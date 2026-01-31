/**
 * Vercel Serverless Function Entry Point
 *
 * Use @hono/node-server/vercel adapter for Node.js runtime compatibility.
 * The standard hono/vercel adapter expects Web Fetch API Request objects,
 * but Vercel's Node.js runtime passes Node.js IncomingMessage objects.
 *
 * We restore the original URL path from the x-original-path header since
 * Vercel rewrites all paths to /api.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "@hono/node-server/vercel";
import app from "../dist/app.js";

const honoHandler = handle(app);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Restore original path from header
  // Vercel adds x-original-path header before rewriting to /api
  const originalPath = req.headers["x-original-path"] as string | undefined;

  if (originalPath && originalPath !== "/api") {
    // Keep any existing query string from the original URL
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    req.url = originalPath + url.search;
  }

  return honoHandler(req, res);
}
