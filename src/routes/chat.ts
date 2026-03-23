import { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { baristaBrain } from "../services/barista-brain.service";
import {
  EMPTY_BARISTA_STATE,
  mergeBaristaState,
  normalizeBaristaState,
} from "../services/barista-state.service";

const chatBodySchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1),
  context: z
    .object({
      lastCoffee: z.string().nullable().optional(),
      lastIntent: z.string().nullable().optional(),
    })
    .optional(),
});

export async function chatRoutes(app: FastifyInstance) {
  app.post("/chat", async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
    }

    const { userId, message, context } = parsed.data;

    const user = await prisma.baristaUser.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 12,
        },
      },
    });

    if (!user) {
      return reply.status(404).send({
        error: "user_not_found",
      });
    }

    const dbState = normalizeBaristaState(
      (user.profile?.state as Record<string, unknown> | null) ?? EMPTY_BARISTA_STATE
    );

    const mergedInputState = normalizeBaristaState({
      ...dbState,
      activeCoffee:
        dbState.activeCoffee ??
        mapCoffeeFromContext(context?.lastCoffee ?? null),
      activeTopic:
        dbState.activeTopic ??
        mapIntentToTopic(context?.lastIntent ?? null),
    });

    await prisma.baristaMessage.create({
      data: {
        userId,
        role: "user",
        content: message,
        meta: {
          source: "shopify_widget",
        },
      },
    });

    const brain = await baristaBrain(message, mergedInputState);

    const nextState = mergeBaristaState(mergedInputState, brain.updateState);

    await prisma.baristaMessage.create({
      data: {
        userId,
        role: "assistant",
        content: brain.reply,
        meta: {
          intent: brain.intent,
          product: brain.product ?? null,
        },
      },
    });

    if (user.profile) {
      await prisma.baristaProfile.update({
        where: { id: user.profile.id },
        data: {
          lastIntent: brain.intent,
          favoriteCoffee:
            nextState.activeCoffee ?? user.profile.favoriteCoffee ?? null,
          preferences: {
            ...(isObject(user.profile.preferences)
              ? user.profile.preferences
              : {}),
            activeMethod: nextState.activeMethod,
            tasteProfile: nextState.tasteProfile,
            activeRecipe: nextState.activeRecipe,
            activeDrinkType: nextState.activeDrinkType,
            lastUserGoal: nextState.lastUserGoal,
            lastAssistantSummary: nextState.lastAssistantSummary,
            conversationMode: nextState.conversationMode,
          },
          state: nextState,
        },
      });
    } else {
      await prisma.baristaProfile.create({
        data: {
          userId,
          lastIntent: brain.intent,
          favoriteCoffee: nextState.activeCoffee,
          preferences: {
            activeMethod: nextState.activeMethod,
            tasteProfile: nextState.tasteProfile,
            activeRecipe: nextState.activeRecipe,
            activeDrinkType: nextState.activeDrinkType,
            lastUserGoal: nextState.lastUserGoal,
            lastAssistantSummary: nextState.lastAssistantSummary,
            conversationMode: nextState.conversationMode,
          },
          state: nextState,
        },
      });
    }

    return reply.send({
      ok: true,
      reply: brain.reply,
      intent: brain.intent,
      product: brain.product ?? null,
      state: nextState,
    });
  });
}

function mapCoffeeFromContext(value: string | null): "catuai" | "geisha" | "pacamara" | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  if (normalized.includes("catuai")) return "catuai";
  if (normalized.includes("geisha")) return "geisha";
  if (normalized.includes("pacamara")) return "pacamara";

  return null;
}

function mapIntentToTopic(value: string | null): string | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  if (normalized.includes("pair")) return "pairing";
  if (normalized.includes("prepar")) return "preparation";
  if (normalized.includes("cocktail")) return "cocktail";
  if (normalized.includes("order")) return "orders";
  if (normalized.includes("subscription")) return "subscription";
  if (normalized.includes("professional")) return "professional";
  if (normalized.includes("select")) return "coffee_selection";

  return "general";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
