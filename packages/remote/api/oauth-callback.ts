/**
 * OAuth Callback Endpoint for TiDB Cloud OAuth redirect
 *
 * This handles the /oauth/callback URL that is registered with TiDB Cloud.
 * We rewrite the URL to /oauth/callback so Hono can handle it properly.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "@hono/node-server/vercel";
import app from "../dist/app.js";

const honoHandler = handle(app);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Rewrite URL to /oauth/callback for Hono routing
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  req.url = `/oauth/callback${url.search}`;

  return honoHandler(req, res);
}
