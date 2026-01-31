/**
 * Vercel Serverless Function Entry Point
 *
 * Use @hono/node-server/vercel adapter for Node.js runtime compatibility.
 * The standard hono/vercel adapter expects Web Fetch API Request objects,
 * but Vercel's Node.js runtime passes Node.js IncomingMessage objects.
 *
 * We restore the original URL path from the query parameter since Vercel
 * rewrites all paths to /api.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "@hono/node-server/vercel";
import app from "../dist/app.js";

const honoHandler = handle(app);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Restore original path from query parameter
  // Vercel rewrites /:path* to /api?path=:path*
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const originalPath = url.searchParams.get("path");

  if (originalPath) {
    // Reconstruct the original URL
    url.pathname = `/${originalPath}`;
    url.searchParams.delete("path");
    req.url = url.pathname + url.search;
  }

  return honoHandler(req, res);
}
