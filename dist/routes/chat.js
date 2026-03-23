import { baristaStateService } from "../services/barista-state.service";
import { baristaBrain } from "../services/barista-brain.service";
import { trackEvent } from "../services/barista-analytics.service";
export async function chatRoutes(app) {
    app.post("/chat", async (request, reply) => {
        const { userId, message } = request.body;
        if (!userId || !message) {
            return reply.status(400).send({
                error: "userId y message son requeridos",
            });
        }
        const user = baristaStateService.getUserByUserId(userId);
        if (!user) {
            return reply.status(404).send({
                error: "Usuario no encontrado",
            });
        }
        trackEvent({
            type: "user_message",
            userId,
            timestamp: new Date().toISOString(),
            meta: { message },
        });
        const result = await baristaBrain(message, {
            activeCoffee: user.conversation.lastCoffee?.toLowerCase().includes("geisha")
                ? "geisha"
                : user.conversation.lastCoffee?.toLowerCase().includes("pacamara")
                    ? "pacamara"
                    : user.conversation.lastCoffee?.toLowerCase().includes("catuai")
                        ? "catuai"
                        : undefined,
            activeTopic: "general",
            pendingQuestion: "",
            goals: [],
        });
        baristaStateService.updateConversationState(userId, {
            lastCoffee: result.product?.name || user.conversation.lastCoffee || "",
            lastIntent: result.intent || "",
            lastUserMessage: message,
            lastAssistantReply: result.reply || "",
            lastInteractionAt: new Date().toISOString(),
        });
        trackEvent({
            type: "assistant_response",
            userId,
            timestamp: new Date().toISOString(),
            meta: {
                intent: result.intent,
                reply: result.reply,
            },
        });
        if (result.product) {
            trackEvent({
                type: "coffee_recommended",
                userId,
                timestamp: new Date().toISOString(),
                meta: {
                    handle: result.product.handle,
                    name: result.product.name,
                },
            });
        }
        return reply.send({
            intent: result.intent,
            reply: result.reply,
            product: result.product,
        });
    });
}
