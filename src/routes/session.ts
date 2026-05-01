import { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db/prisma";
import {
  EMPTY_BARISTA_STATE,
  normalizeBaristaState,
  summarizeStateForWelcome,
} from "../services/barista-state.service";

const sessionBodySchema = z.object({
  externalUserId: z.string().min(1),
  shopifyCustomerId: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
});

export async function sessionRoutes(app: FastifyInstance) {
  app.post("/session", async (request, reply) => {
    const parsed = sessionBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
    }

    const { externalUserId, shopifyCustomerId, email } = parsed.data;

    let user = await prisma.baristaUser.findUnique({
      where: { externalUserId },
      include: {
        profile: true,
      },
    });

    if (!user) {
      user = await prisma.baristaUser.create({
        data: {
          externalUserId,
          shopifyCustomerId: shopifyCustomerId ?? null,
          email: email ?? null,
          profile: {
            create: {
              state: EMPTY_BARISTA_STATE,
              preferences: {},
            },
          },
        },
        include: {
          profile: true,
        },
      });
    } else {
      user = await prisma.baristaUser.update({
        where: { id: user.id },
        data: {
          shopifyCustomerId: shopifyCustomerId ?? user.shopifyCustomerId ?? null,
          email: email ?? user.email ?? null,
        },
        include: {
          profile: true,
        },
      });
    }

    const state = normalizeBaristaState(
      (user.profile?.state as Record<string, unknown> | null) ?? EMPTY_BARISTA_STATE
    );

    const recentMessages = await prisma.baristaMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    });

    const orderedRecentMessages = recentMessages.slice().reverse();

    const lastUserMessage =
      orderedRecentMessages
        .slice()
        .reverse()
        .find((msg) => msg.role === "user")?.content ?? null;

    const lastAssistantMessage =
      orderedRecentMessages
        .slice()
        .reverse()
        .find((msg) => msg.role === "assistant")?.content ?? null;

    const lastConversationSummary = lastUserMessage
      ? `Tu última consulta fue: “${lastUserMessage.slice(0, 140)}${
          lastUserMessage.length > 140 ? "..." : ""
        }”.`
      : null;

    const memorySummary = summarizeStateForWelcome(state);

    return reply.send({
      ok: true,
      userId: user.id,
      profile: {
        favoriteCoffee: user.profile?.favoriteCoffee ?? null,
        lastIntent: user.profile?.lastIntent ?? null,
        preferences: user.profile?.preferences ?? {},
      },
      state,

      // Nueva lógica correcta
      welcomeBack: Boolean(lastConversationSummary || memorySummary),
      welcomeBackSummary:
        lastConversationSummary ??
        "Puedo recuperar recomendaciones anteriores o empezar una nueva consulta.",

      lastConversation: {
        lastUserMessage,
        lastAssistantMessage,
        messages: orderedRecentMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        })),
      },

      memorySummary,
    });
  });
}
