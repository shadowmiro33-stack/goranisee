import handler from "../../netlify/functions/captures.mjs";
import { withEnv } from "../_env.js";
export const onRequest = (ctx) => withEnv(ctx, handler);
