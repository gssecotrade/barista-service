import { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { generateBaristaResponse } from "../services/barista-brain.service";
import {
  EMPTY_BARISTA_STATE,
  mergeBaristaState,
  normalizeBaristaState,
} from "../services/barista-state.service";
import {
  buildCupEconomicsReply,
  buildProfessionalPricingStrategyReply,
  extractAverageCupPrice,
  isCupEconomicsIntent,
} from "../services/barista-pricing.service";

import { runBaristaDecisionEngine } from "../services/barista-decision-engine.service";

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
    try {
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
  
      const { reply: rawBaristaReply, updatedContext } = await generateBaristaResponse({
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
  
      const engineResult = await runBaristaDecisionEngine({ message });
      console.log("ENGINE RESULT:", JSON.stringify(engineResult, null, 2));

      const suppressProductCardsForProfessionalVolume =
        engineResult?.type === "professional_volume";

      const professionalContext =
        engineResult?.type === "professional_volume"
          ? engineResult
          : null;

      const averageCupPrice = extractAverageCupPrice(message);

      const forcedCommercialReply =
        engineResult?.type === "professional_volume"
          ? null
          : buildCommercialQuantityReply(message);

      const forcedEconomicsReply =
        isCupEconomicsIntent(message) && professionalContext
          ? buildProfessionalPricingStrategyReply({
              currentPricePerCup: averageCupPrice ?? 2.5,
              coffees: professionalContext.mix?.lines ?? [],
            })
          : isCupEconomicsIntent(message)
          ? await buildCupEconomicsReply({ message })
          : null;

      const safeReply = isCupEconomicsIntent(message)
        ? rawBaristaReply
        : sanitizeForbiddenContent(rawBaristaReply);

      const baristaReply =
        forcedEconomicsReply ||
        engineResult?.reply ||
        forcedCommercialReply ||
        safeReply;
  
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
  
      const shouldShowProduct =
        shouldReturnProduct({
          message,
          reply: baristaReply,
          topic: inferredTopic,
          coffee: inferredCoffee,
        }) &&
        !isCommercialClosingStep({
          message,
          reply: baristaReply,
        }) &&
        !isNonCommercialQuantityReply({
          message,
          reply: baristaReply,
        }) &&
        !suppressProductCardsForProfessionalVolume;
  
      const resolvedProducts = shouldShowProduct
        ? resolveProductsFromReply({
            reply: baristaReply,
            fallbackCoffee: inferredCoffee,
            topic: inferredTopic,
            recipe: inferredRecipe,
            userMessage: message,
          })
        : [];
  
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
            product: resolvedProducts[0] ?? null,
            products: resolvedProducts,
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
        product: resolvedProducts[0] ?? null,
        products: resolvedProducts,
        primaryProduct: resolvedProducts[0] ?? null,
        state: nextState,
      });
    } catch (error) {
      console.error("CHAT /chat ERROR:", error);
      return reply.status(500).send({
        ok: false,
        error: "chat_internal_error",
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
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
  if (!coffee && !containsAnyCoffeeMention(`${message} ${reply}`)) return false;

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

function resolveProductsFromReply({
  reply,
  fallbackCoffee,
  topic,
  recipe,
  userMessage,
}: {
  reply: string;
  fallbackCoffee: CoffeeHandle | null;
  topic: BaristaTopic;
  recipe: string | null;
  userMessage: string;
}): ProductPayload[] {
  const combined = `${userMessage} ${reply}`.toLowerCase();
  const handles: CoffeeHandle[] = [];

  if (combined.includes("catuai")) handles.push("catuai");
  if (combined.includes("geisha")) handles.push("geisha");
  if (combined.includes("pacamara")) handles.push("pacamara");

  if (handles.length === 0 && fallbackCoffee) {
    handles.push(fallbackCoffee);
  }

  const uniqueHandles = Array.from(new Set(handles)).slice(0, 3);

  return uniqueHandles
    .map((handle) =>
      mapCoffeeToProduct(handle, {
        topic,
        recipe,
        userMessage,
        reply,
      })
    )
    .filter(Boolean) as ProductPayload[];
}

function containsAnyCoffeeMention(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("catuai") ||
    normalized.includes("geisha") ||
    normalized.includes("pacamara")
  );
}

function isCommercialClosingStep({
  message,
  reply,
}: {
  message: string;
  reply: string;
}): boolean {
  const combined = `${message} ${reply}`.toLowerCase();

  const userAskedForPurchasePlanning =
    combined.includes("cuánto comprar") ||
    combined.includes("cuanto comprar") ||
    combined.includes("cantidad") ||
    combined.includes("consumo mensual") ||
    combined.includes("consumo semanal") ||
    combined.includes("qué comprar") ||
    combined.includes("que comprar") ||
    combined.includes("qué me conviene") ||
    combined.includes("que me conviene") ||
    combined.includes("formato") ||
    combined.includes("rutina de consumo") ||
    combined.includes("tomo") ||
    combined.includes("cafés diarios") ||
    combined.includes("cafes diarios");

  const assistantIsStillAskingToClose =
    reply.includes("¿") &&
    (
      combined.includes("prefieres una sola referencia") ||
      combined.includes("prefieres una sola") ||
      combined.includes("combinar dos cafés") ||
      combined.includes("combinar dos cafes") ||
      combined.includes("en grano o molido") ||
      combined.includes("grano o molido") ||
      combined.includes("qué formato") ||
      combined.includes("que formato") ||
      combined.includes("250 g") ||
      combined.includes("500 g") ||
      combined.includes("1 kg")
    );

  return userAskedForPurchasePlanning && assistantIsStillAskingToClose;
}

function isNonCommercialQuantityReply({
  message,
  reply,
}: {
  message: string;
  reply: string;
}): boolean {
  const source = `${message} ${reply}`.toLowerCase();

  const userAskedForPurchaseQuantity =
    source.includes("cuánto comprar") ||
    source.includes("cuanto comprar") ||
    source.includes("cantidad") ||
    source.includes("consumo mensual") ||
    source.includes("consumo semanal") ||
    source.includes("qué comprar") ||
    source.includes("que comprar") ||
    source.includes("qué me conviene comprar") ||
    source.includes("que me conviene comprar") ||
    source.includes("mensualmente") ||
    source.includes("formato");

  const replyLooksTechnicalInsteadOfCommercial =
    reply.toLowerCase().includes("gramos por taza") ||
    /\d+\s*gramos/.test(reply.toLowerCase()) ||
    reply.toLowerCase().includes("estimación de consumo mensual") ||
    reply.toLowerCase().includes("calculamos:");

  const replyDoesNotUseCommercialFormats =
    !reply.toLowerCase().includes("250 g") &&
    !reply.toLowerCase().includes("500 g") &&
    !reply.toLowerCase().includes("1 kg") &&
    !reply.toLowerCase().includes("bolsa") &&
    !reply.toLowerCase().includes("bolsas");

  return (
    userAskedForPurchaseQuantity &&
    (replyLooksTechnicalInsteadOfCommercial || replyDoesNotUseCommercialFormats)
  );
}

function buildCommercialQuantityReply(message: string): string | null {
  if (!isMonthlyQuantityIntent(message)) return null;

  const normalized = message.toLowerCase();

  const weekdayDaily = extractWeekdayDailyCoffeeCount(normalized) ?? extractDailyCoffeeCount(normalized) ?? 3;
  const weekendDaily = extractWeekendDailyCoffeeCount(normalized) ?? weekdayDaily;

  const hasAfterMealMoment =
    normalized.includes("después de comer") ||
    normalized.includes("despues de comer") ||
    normalized.includes("sobremesa");

  const hasMidMorningMoment =
    normalized.includes("media mañana") ||
    normalized.includes("media manana");

  const wantsPremiumWeekend =
    normalized.includes("fin de semana") ||
    normalized.includes("fines de semana") ||
    hasAfterMealMoment ||
    hasMidMorningMoment;

  const wantsSingleCoffee =
    normalized.includes("una sola referencia") ||
    normalized.includes("un solo café") ||
    normalized.includes("un solo cafe") ||
    normalized.includes("solo un café") ||
    normalized.includes("solo un cafe");

  const wantsTwoCoffees =
    normalized.includes("combinar dos") ||
    normalized.includes("dos referencias") ||
    normalized.includes("dos cafés") ||
    normalized.includes("dos cafes") ||
    wantsPremiumWeekend;

  const estimatedMonthlyCups = weekdayDaily * 20 + weekendDaily * 8;

  // Conversión comercial simple.
  // No se verbaliza cálculo; solo se usa para decidir formatos.
  // Regla práctica:
  // - consumo bajo: 2 x 250 g
  // - consumo medio: 3 x 250 g o 1 x 500 g + 1 x 250 g
  // - consumo alto: 2 x 500 g
  // - si hay fin de semana premium: base diaria + complemento premium 250 g
  if (wantsSingleCoffee) {
    return buildSingleCoffeeMonthlyReply(estimatedMonthlyCups);
  }

  if (wantsTwoCoffees || wantsPremiumWeekend) {
    if (estimatedMonthlyCups >= 95) {
      if (hasAfterMealMoment) {
        return [
          "Recomendación mensual:",
          "- 2 bolsas de 500 g de Catuai para el consumo diario",
          "- 1 bolsa de 250 g de Pacamara para sobremesas y fines de semana",
          "",
          "Tienes una base práctica para diario y una referencia con más estructura para los momentos más gastronómicos.",
        ].join("\n");
      }

      return [
        "Recomendación mensual:",
        "- 2 bolsas de 500 g de Catuai para el consumo diario",
        "- 1 bolsa de 250 g de Geisha para media mañana o fines de semana",
        "",
        "Resuelves el mes con una base equilibrada y un café más especial para los momentos en los que quieras subir el nivel.",
      ].join("\n");
    }

    if (estimatedMonthlyCups >= 70) {
      if (hasAfterMealMoment) {
        return [
          "Recomendación mensual:",
          "- 1 bolsa de 500 g de Catuai para diario",
          "- 1 bolsa de 250 g de Catuai para reforzar entre semana",
          "- 1 bolsa de 250 g de Pacamara para sobremesas y fin de semana",
          "",
          "Es una combinación muy equilibrada: cubres el consumo habitual y reservas un perfil con más carácter para los mejores momentos.",
        ].join("\n");
      }

      return [
        "Recomendación mensual:",
        "- 1 bolsa de 500 g de Catuai para diario",
        "- 1 bolsa de 250 g de Catuai para reforzar el mes",
        "- 1 bolsa de 250 g de Geisha para momentos más especiales",
        "",
        "Así cubres el mes con comodidad y añades una referencia más refinada para salir de la rutina.",
      ].join("\n");
    }

    return [
      "Recomendación mensual:",
      "- 2 bolsas de 250 g de Catuai para el consumo base",
      "- 1 bolsa de 250 g de Geisha o Pacamara para variar el fin de semana",
      "",
      "Es la forma más sencilla de tener café diario y, al mismo tiempo, una referencia con más personalidad para los momentos especiales.",
    ].join("\n");
  }

  // Caso por defecto: una base clara y fácil de comprar
  if (estimatedMonthlyCups >= 95) {
    return [
      "Recomendación mensual:",
      "- 2 bolsas de 500 g de Catuai",
      "",
      "Es la opción más práctica para cubrir tu consumo mensual con continuidad, equilibrio y sin complicarte.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 70) {
    return [
      "Recomendación mensual:",
      "- 1 bolsa de 500 g de Catuai",
      "- 1 bolsa de 250 g de Catuai",
      "",
      "Cubres el mes con un perfil amable y versátil, en formatos cómodos de compra.",
    ].join("\n");
  }

  return [
    "Recomendación mensual:",
    "- 3 bolsas de 250 g de Catuai",
    "",
    "Tienes cubierto el mes con una compra simple, fácil de gestionar y con un café muy agradecido para diario.",
  ].join("\n");
}

function isMonthlyQuantityIntent(message: string): boolean {
  const source = message.toLowerCase();

  return (
    source.includes("cuánto comprar") ||
    source.includes("cuanto comprar") ||
    source.includes("cantidad a comprar") ||
    source.includes("qué cantidad comprar") ||
    source.includes("que cantidad comprar") ||
    source.includes("mensualmente") ||
    source.includes("al mes") ||
    source.includes("consumo mensual") ||
    source.includes("consumo semanal") ||
    source.includes("tomo") ||
    source.includes("cafés al día") ||
    source.includes("cafes al dia") ||
    source.includes("rutina de consumo") ||
    source.includes("qué me recomiendas comprar") ||
    source.includes("que me recomiendas comprar")
  );
}

function extractTotalCoffeesFromText(message: string): number | null {
  const matches = message.match(/(\d+)\s*caf(?:e|é)s?/gi);

  if (!matches) return null;

  let total = 0;

  for (const m of matches) {
    const num = Number(m.replace(/[^\d]/g, ""));
    if (Number.isFinite(num)) total += num;
  }

  return total > 0 ? total : null;
}

function extractWeekdayDailyCoffeeCount(message: string): number | null {
  const patterns = [
    /(\d+)\s*caf[eé]s?\s+al\s+d[ií]a\s+durante\s+la\s+semana/,
    /(\d+)\s*caf[eé]s?\s+diarios?\s+entre\s+semana/,
    /(\d+)\s*caf[eé]s?\s+por\s+d[ií]a\s+entre\s+semana/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

function extractWeekendDailyCoffeeCount(message: string): number | null {
  const patterns = [
    /fin(?:es)?\s+de\s+semana.*?(\d+)\s*(?:caf[eé]s?|uno|una|dos|tres|cuatro)/,
    /(\d+)\s*caf[eé]s?\s+.*?fin(?:es)?\s+de\s+semana/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const raw = match[1];
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
  }

  // Casos escritos con palabras
  if (
    message.includes("fin de semana uno") ||
    message.includes("fines de semana uno")
  ) {
    return 1;
  }

  if (
    message.includes("fin de semana dos") ||
    message.includes("fines de semana dos")
  ) {
    return 2;
  }

  if (
    message.includes("fin de semana tres") ||
    message.includes("fines de semana tres")
  ) {
    return 3;
  }

  return null;
}

function buildSingleCoffeeMonthlyReply(estimatedMonthlyCups: number): string {
  if (estimatedMonthlyCups >= 95) {
    return [
      "Recomendación mensual:",
      "- 2 bolsas de 500 g de Catuai",
      "",
      "Es la opción más práctica si quieres resolver todo el mes con una sola referencia, equilibrada y fácil de disfrutar a diario.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 70) {
    return [
      "Recomendación mensual:",
      "- 1 bolsa de 500 g de Catuai",
      "- 1 bolsa de 250 g de Catuai",
      "",
      "Cubres el mes con una sola referencia, sin quedarte corto y manteniendo una compra muy sencilla.",
    ].join("\n");
  }

  return [
    "Recomendación mensual:",
    "- 3 bolsas de 250 g de Catuai",
    "",
    "Te encaja muy bien si quieres una sola referencia y prefieres comprar en formatos más manejables.",
  ].join("\n");
}

function sanitizeForbiddenContent(text: string): string {
  const forbiddenPatterns = [
    /coste por taza.*$/gim,
    /coste por gramo.*$/gim,
    /\d+[,\.]?\d*\s*euros?\s*x\s*\d+/gim,
    /margen.*$/gim,
    /precio sugerido.*$/gim,
    /hipótesis.*$/gim,
    /suponiendo.*$/gim,
  ];

  let cleaned = text;

  forbiddenPatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, "");
  });

  return cleaned.trim();
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
