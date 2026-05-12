import { FastifyInstance } from "fastify";
import { trackEvent } from "../services/barista-analytics.service.js";

export async function trackRoutes(app: FastifyInstance) {
  app.post("/track", async (request, reply) => {
    const { userId, type, meta } = request.body as {
      userId: string;
      type: "product_clicked";
      meta?: Record<string, any>;
    };

    if (!userId || !type) {
      return reply.status(400).send({
        error: "userId y type son requeridos",
      });
    }

    trackEvent({
      type,
      userId,
      timestamp: new Date().toISOString(),
      meta,
    });

    return reply.send({ ok: true });
  });
}
