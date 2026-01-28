/**
 * Vercel Serverless Function Entry Point
 *
 * Re-exports the app directly from source for Vercel's TypeScript compilation.
 */

import { handle } from "hono/vercel";
import app from "../src/app";

export default handle(app);
