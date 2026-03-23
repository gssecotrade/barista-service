import { trackEvent } from "../services/barista-analytics.service";
export async function trackRoutes(app) {
    app.post("/track", async (request, reply) => {
        const { userId, type, meta } = request.body;
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
