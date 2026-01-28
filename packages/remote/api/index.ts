/**
 * Vercel Serverless Function Entry Point
 */

import { handle } from "hono/vercel";
import app from "../src/app";

export default handle(app);
