/**
 * Vercel Serverless Function Entry Point
 *
 * This file serves as the entry point for Vercel deployment.
 * It exports the Hono app using the Vercel adapter.
 */

import { handle } from "hono/vercel";
import app from "../dist/app.js";

// Export for Vercel
export default handle(app);
