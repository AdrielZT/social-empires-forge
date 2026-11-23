import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");

export interface ServerOptions {
  assetsDir?: string;
}

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const assetsDir = options.assetsDir ?? path.join(REPO_ROOT, "assets", "generated");
  if (fs.existsSync(assetsDir)) {
    await app.register(fastifyStatic, {
      root: assetsDir,
      prefix: "/assets/"
    });
  }

  app.get("/api/health", async () => ({
    status: "ok",
    game: "Social Empires Forge",
    targetVersion: "1.4.07",
    serverTime: Math.floor(Date.now() / 1000)
  }));

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5050);
  const host = process.env.HOST ?? "127.0.0.1";
  createServer()
    .then((app) => app.listen({ port, host }))
    .then((address) => {
      console.log(`[sef-server] Listening at ${address}`);
    })
    .catch((err) => {
      console.error("[sef-server] Fatal startup error:", err);
      process.exit(1);
    });
}
