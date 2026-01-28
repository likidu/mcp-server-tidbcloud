/**
 * Vercel Serverless Function Entry Point
 *
 * Vercel's zero-config approach for Hono expects the app to be exported directly.
 * See: https://vercel.com/docs/frameworks/backend/hono
 */

import app from "../dist/app.js";

export default app;
