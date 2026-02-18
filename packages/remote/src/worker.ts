/**
 * Cloudflare Workers entry point
 *
 * Exports the Hono app directly — CF Workers calls app.fetch() automatically.
 */

import app from "./app.js";

export default app;
