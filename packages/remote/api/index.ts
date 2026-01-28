/**
 * Vercel Serverless Function Entry Point
 *
 * Use @hono/node-server/vercel adapter for Node.js runtime compatibility.
 * The standard hono/vercel adapter expects Web Fetch API Request objects,
 * but Vercel's Node.js runtime passes Node.js IncomingMessage objects.
 */

import { handle } from "@hono/node-server/vercel";
import app from "../dist/app.js";

export default handle(app);
