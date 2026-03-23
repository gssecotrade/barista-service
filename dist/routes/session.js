import { baristaStateService } from "../services/barista-state.service";
export async function sessionRoutes(app) {
    app.post("/session", async (request, reply) => {
        const { externalUserId } = request.body;
        if (!externalUserId) {
            return reply.status(400).send({
                error: "externalUserId es requerido",
            });
        }
        const user = baristaStateService.createOrGetUser(externalUserId);
        const resume = baristaStateService.getResumeSnapshot(user.userId);
        const greeting = resume.resumeAvailable
            ? "Bienvenido de nuevo."
            : "Bienvenido a Arte Coffee.";
        return reply.send({
            userId: user.userId,
            externalUserId: user.externalUserId,
            greeting,
            resumeAvailable: resume.resumeAvailable,
            resumeSummary: resume.resumeSummary,
            lastCoffee: resume.lastCoffee,
            lastIntent: resume.lastIntent,
            lastUserMessage: resume.lastUserMessage,
            lastAssistantReply: resume.lastAssistantReply,
            lastInteractionAt: resume.lastInteractionAt,
        });
    });
    app.post("/session/reset", async (request, reply) => {
        const { userId } = request.body;
        if (!userId) {
            return reply.status(400).send({
                error: "userId es requerido",
            });
        }
        const user = baristaStateService.clearConversationState(userId);
        if (!user) {
            return reply.status(404).send({
                error: "Usuario no encontrado",
            });
        }
        return reply.send({ ok: true });
    });
}
