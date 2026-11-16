import handler from "../../netlify/functions/capture-request.mjs";
import { withEnv } from "../_env.js";
export const onRequest = (ctx) => withEnv(ctx, handler);
