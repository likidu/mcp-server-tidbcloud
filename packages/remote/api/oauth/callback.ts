/**
 * OAuth Callback Endpoint (alternate path)
 */

import { handle } from "@hono/node-server/vercel";
import app from "../../dist/app.js";

export default handle(app);
