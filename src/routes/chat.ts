import { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { generateBaristaResponse } from "../services/barista-brain.service";
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

type BaristaTopic =
  | "coffee_selection"
  | "preparation"
  | "pairing"
  | "cocktail"
  | "orders"
  | "subscription"
  | "education"
  | "professional"
  | "general";

type CoffeeHandle = "catuai" | "geisha" | "pacamara";

type ProductPayload = {
  handle: CoffeeHandle;
  name: string;
  reason: string;
  image: string;
  url: string;
};

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

    const history = user.messages
      .slice()
      .reverse()
      .map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      }));

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

    const { reply: baristaReply, updatedContext } = await generateBaristaResponse({
      userMessage: message,
      history,
      context: {
        lastCoffee: mergedInputState.activeCoffee ?? undefined,
        lastIntent: mergedInputState.activeTopic ?? undefined,
        lastStyle: mergedInputState.activeDrinkType ?? undefined,
        summary:
          mergedInputState.lastAssistantSummary ??
          buildFriendlySummary(mergedInputState),
      },
    });

    const inferredCoffee =
      inferCoffeeFromText(`${message} ${baristaReply}`) ??
      normalizeCoffeeValue(updatedContext?.lastCoffee ?? null) ??
      mergedInputState.activeCoffee ??
      null;

    const inferredTopic =
      inferTopicFromText(`${message} ${baristaReply}`) ??
      mergedInputState.activeTopic ??
      "general";

    const inferredDrinkType =
      inferDrinkTypeFromText(`${message} ${baristaReply}`) ??
      mergedInputState.activeDrinkType ??
      null;

    const inferredRecipe =
      inferRecipeFromText(`${message} ${baristaReply}`) ??
      mergedInputState.activeRecipe ??
      null;

    const shouldShowProduct = shouldReturnProduct({
      message,
      reply: baristaReply,
      topic: inferredTopic,
      coffee: inferredCoffee,
    });

    const resolvedProduct = shouldShowProduct
      ? mapCoffeeToProduct(inferredCoffee, {
          topic: inferredTopic,
          recipe: inferredRecipe,
          userMessage: message,
          reply: baristaReply,
        })
      : null;

    const nextState = mergeBaristaState(mergedInputState, {
      activeCoffee: inferredCoffee,
      activeTopic: inferredTopic,
      activeDrinkType: inferredDrinkType,
      activeRecipe: inferredRecipe,
      lastUserGoal: message,
      lastAssistantSummary:
        buildAssistantSummary({
          coffee: inferredCoffee,
          topic: inferredTopic,
          recipe: inferredRecipe,
          drinkType: inferredDrinkType,
          reply: baristaReply,
        }) ??
        updatedContext?.summary ??
        mergedInputState.lastAssistantSummary,
      conversationMode: "continue",
    });

    await prisma.baristaMessage.create({
      data: {
        userId,
        role: "assistant",
        content: baristaReply,
        meta: {
          topic: nextState.activeTopic,
          coffee: nextState.activeCoffee,
          recipe: nextState.activeRecipe,
          drinkType: nextState.activeDrinkType,
          product: resolvedProduct ?? null,
        },
      },
    });

    if (user.profile) {
      await prisma.baristaProfile.update({
        where: { id: user.profile.id },
        data: {
          lastIntent: nextState.activeTopic ?? "general",
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
          lastIntent: nextState.activeTopic ?? "general",
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
      reply: baristaReply,
      intent: nextState.activeTopic ?? "general",
      product: resolvedProduct,
      state: nextState,
    });
  });
}

function mapCoffeeFromContext(value: string | null): CoffeeHandle | null {
  return normalizeCoffeeValue(value);
}

function mapIntentToTopic(value: string | null): BaristaTopic | null {
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

function normalizeCoffeeValue(value: string | null | undefined): CoffeeHandle | null {
  if (!value) return null;

  const normalized = String(value).toLowerCase();

  if (normalized.includes("catuai")) return "catuai";
  if (normalized.includes("geisha")) return "geisha";
  if (normalized.includes("pacamara")) return "pacamara";

  return null;
}

function inferCoffeeFromText(value: string): CoffeeHandle | null {
  return normalizeCoffeeValue(value);
}

function inferTopicFromText(value: string): BaristaTopic | null {
  const normalized = value.toLowerCase();

  if (
    normalized.includes("marid") ||
    normalized.includes("postre") ||
    normalized.includes("acompa")
  ) {
    return "pairing";
  }

  if (
    normalized.includes("prepar") ||
    normalized.includes("v60") ||
    normalized.includes("chemex") ||
    normalized.includes("espresso") ||
    normalized.includes("cafetera")
  ) {
    return "preparation";
  }

  if (
    normalized.includes("cóctel") ||
    normalized.includes("cocktail") ||
    normalized.includes("mocktail") ||
    normalized.includes("sin alcohol")
  ) {
    return "cocktail";
  }

  if (
    normalized.includes("comprar") ||
    normalized.includes("pedido") ||
    normalized.includes("encargar") ||
    normalized.includes("probarlo") ||
    normalized.includes("pruébalo") ||
    normalized.includes("descubrirlo")
  ) {
    return "orders";
  }

  if (normalized.includes("suscrip") || normalized.includes("club")) {
    return "subscription";
  }

  if (
    normalized.includes("restaurante") ||
    normalized.includes("local") ||
    normalized.includes("carta") ||
    normalized.includes("negocio") ||
    normalized.includes("horeca")
  ) {
    return "professional";
  }

  if (
    normalized.includes("recom") ||
    normalized.includes("qué café") ||
    normalized.includes("que café") ||
    normalized.includes("café ideal") ||
    normalized.includes("cafe ideal")
  ) {
    return "coffee_selection";
  }

  return "general";
}

function inferDrinkTypeFromText(
  value: string
): "coffee" | "cocktail" | "mocktail" | null {
  const normalized = value.toLowerCase();

  if (normalized.includes("sin alcohol") || normalized.includes("mocktail")) {
    return "mocktail";
  }

  if (normalized.includes("cóctel") || normalized.includes("cocktail")) {
    return "cocktail";
  }

  if (
    normalized.includes("espresso") ||
    normalized.includes("v60") ||
    normalized.includes("chemex") ||
    normalized.includes("cafetera") ||
    normalized.includes("café") ||
    normalized.includes("cafe")
  ) {
    return "coffee";
  }

  return null;
}

function inferRecipeFromText(value: string): string | null {
  const normalized = value.toLowerCase();

  if (normalized.includes("torrija")) return "torrija signature";
  if (normalized.includes("affogato")) return "affogato";
  if (normalized.includes("tiramisú") || normalized.includes("tiramisu"))
    return "tiramisú";
  if (normalized.includes("brownie")) return "brownie";
  if (normalized.includes("postre")) return "postre de la casa";
  if (normalized.includes("cóctel de café") || normalized.includes("cocktail"))
    return "cóctel de café";
  if (normalized.includes("receta")) return "receta signature";

  return null;
}

function shouldReturnProduct({
  message,
  reply,
  topic,
  coffee,
}: {
  message: string;
  reply: string;
  topic: BaristaTopic;
  coffee: CoffeeHandle | null;
}): boolean {
  if (!coffee) return false;

  const combined = `${message} ${reply}`.toLowerCase();

  if (
    topic === "coffee_selection" ||
    topic === "orders" ||
    topic === "subscription" ||
    topic === "professional"
  ) {
    return true;
  }

  if (
    combined.includes("recom") ||
    combined.includes("qué café") ||
    combined.includes("que café") ||
    combined.includes("pruébalo") ||
    combined.includes("probarlo") ||
    combined.includes("descubrirlo") ||
    combined.includes("comprar") ||
    combined.includes("llevaría") ||
    combined.includes("te recomendaría") ||
    combined.includes("te recomendaria")
  ) {
    return true;
  }

  return false;
}

function mapCoffeeToProduct(
  coffee: CoffeeHandle | null,
  options: {
    topic: BaristaTopic;
    recipe: string | null;
    userMessage: string;
    reply: string;
  }
): ProductPayload | null {
  if (!coffee) return null;

  const catalog: Record<CoffeeHandle, ProductPayload> = {
    catuai: {
      handle: "catuai",
      name: "Catuai",
      reason:
        "Perfil equilibrado y versátil, ideal para quienes buscan un café elegante, amable y fácil de integrar en distintos momentos de consumo.",
      image:
        "https://arte-coffee.com/cdn/shop/files/Catuai_Lavado.jpg?v=1747402022",
      url: "https://arte-coffee.com/products/catuai",
    },
    geisha: {
      handle: "geisha",
      name: "Geisha",
      reason:
        "Un café delicado, floral y sofisticado, perfecto para propuestas más aromáticas, cítricas o de perfil más refinado.",
      image:
        "https://arte-coffee.com/cdn/shop/files/Geisha_Lavado.jpg?v=1747402022",
      url: "https://arte-coffee.com/products/geisha",
    },
    pacamara: {
      handle: "pacamara",
      name: "Pacamara",
      reason:
        "Más estructura, complejidad y profundidad en boca, ideal para sobremesas, postres con carácter y propuestas gastronómicas de mayor presencia.",
      image:
        "https://arte-coffee.com/cdn/shop/files/Pacamara_Natural.jpg?v=1747402022",
      url: "https://arte-coffee.com/products/pacamara",
    },
  };

  const base = catalog[coffee];

  if (options.topic === "professional") {
    return {
      ...base,
      reason: `${base.reason} En contexto de carta o local, es una referencia con suficiente personalidad para construir una propuesta diferencial.`,
    };
  }

  if (options.topic === "pairing" || options.recipe) {
    return {
      ...base,
      reason: `${base.reason} Aquí encaja especialmente bien para acompañar o construir la propuesta gastronómica que estáis trabajando.`,
    };
  }

  return base;
}

function buildFriendlySummary(
  state: ReturnType<typeof normalizeBaristaState>
): string {
  if (state.lastAssistantSummary) return state.lastAssistantSummary;

  if (state.activeRecipe && state.activeCoffee) {
    return `La última vez estábamos con ${prettyCoffee(
      state.activeCoffee
    )} y una propuesta en torno a ${state.activeRecipe}.`;
  }

  if (state.activeTopic === "pairing" && state.activeCoffee) {
    return `La última vez estábamos trabajando maridajes con ${prettyCoffee(
      state.activeCoffee
    )}.`;
  }

  if (state.activeTopic === "preparation" && state.activeCoffee) {
    return `La última vez estábamos viendo cómo preparar ${prettyCoffee(
      state.activeCoffee
    )}.`;
  }

  if (state.activeTopic === "cocktail" && state.activeCoffee) {
    return `La última vez estábamos explorando una propuesta con ${prettyCoffee(
      state.activeCoffee
    )}.`;
  }

  if (state.activeTopic === "professional" && state.activeCoffee) {
    return `La última vez estábamos trabajando una propuesta para negocio con ${prettyCoffee(
      state.activeCoffee
    )}.`;
  }

  if (state.activeCoffee) {
    return `La última vez estuvimos hablando de ${prettyCoffee(
      state.activeCoffee
    )}.`;
  }

  return "La última vez estuvimos viendo una propuesta de café.";
}

function buildAssistantSummary({
  coffee,
  topic,
  recipe,
  drinkType,
  reply,
}: {
  coffee: CoffeeHandle | null;
  topic: BaristaTopic | null;
  recipe: string | null;
  drinkType: "coffee" | "cocktail" | "mocktail" | null;
  reply: string;
}): string {
  if (recipe && coffee) {
    return `La última vez estábamos con ${prettyCoffee(
      coffee
    )} y una propuesta en torno a ${recipe}.`;
  }

  if (drinkType === "mocktail" && coffee) {
    return `La última vez estábamos trabajando una propuesta sin alcohol con ${prettyCoffee(
      coffee
    )}.`;
  }

  if (drinkType === "cocktail" && coffee) {
    return `La última vez estábamos trabajando un cóctel con ${prettyCoffee(
      coffee
    )}.`;
  }

  if (topic === "pairing" && coffee) {
    return `La última vez estábamos viendo maridajes con ${prettyCoffee(
      coffee
    )}.`;
  }

  if (topic === "preparation" && coffee) {
    return `La última vez estábamos viendo cómo preparar ${prettyCoffee(
      coffee
    )}.`;
  }

  if (topic === "professional" && coffee) {
    return `La última vez estábamos trabajando una propuesta para negocio con ${prettyCoffee(
      coffee
    )}.`;
  }

  if (coffee) {
    return `La última vez estuvimos hablando de ${prettyCoffee(coffee)}.`;
  }

  return reply.slice(0, 180);
}

function prettyCoffee(coffee: string): string {
  if (coffee === "catuai") return "Catuai";
  if (coffee === "geisha") return "Geisha";
  if (coffee === "pacamara") return "Pacamara";
  return coffee;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
