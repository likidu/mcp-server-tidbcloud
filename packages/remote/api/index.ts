/**
 * Vercel Serverless Function Entry Point
 *
 * This file serves as the entry point for Vercel deployment.
 * It exports the Hono app using the Vercel adapter.
 */

import { handle } from "hono/vercel";
import app from "../src/app.js";
// Note: After compilation, this becomes ../dist/src/app.js relative to dist/api/index.js

// Export for Vercel
export default handle(app);
