import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

import { sessionRoutes } from "./routes/session";
import { chatRoutes } from "./routes/chat";
import { trackRoutes } from "./routes/track";

const app = Fastify({
  logger: true,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildApp() {
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/public/",
  });

  app.get("/", async () => {
    return { status: "ok", service: "arte-coffee-barista" };
  });

  await app.register(sessionRoutes);
  await app.register(chatRoutes);
  await app.register(trackRoutes);

  return app;
}

async function start() {
  try {
    const server = await buildApp();

    const PORT = Number(process.env.PORT) || 3000;
    const HOST = "0.0.0.0";

    await server.listen({ port: PORT, host: HOST });

    console.log(`🚀 Barista IA corriendo en http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
