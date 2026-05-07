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
  buildProfessionalEconomicsReply,
  buildProfessionalPricingStrategyReply,
  buildProductPriceReply,
  extractAverageCupPrice,
  isCupEconomicsIntent,
  getShopifyProductCommerceInfo,
} from "../services/barista-pricing.service";
import { runBaristaDecisionEngine } from "../services/barista-decision-engine.service";
import { buildCommerceDecision } from "../services/barista-commerce-decision.service";

function shouldMentionClubArte(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();

  const explicitClubSignals = [
    "club arte",
    "club",
    "beneficios",
    "ventajas",
    "fidelización",
    "fidelizacion",
    "descuentos",
    "programa"
  ];

  return explicitClubSignals.some((signal) => msg.includes(signal));
}

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
  handle: string;
  name: string;
  reason: string;
  image: string;
  url: string;
  price?: string;
  composition?: string;
  format?: string;
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

      console.log("CHAT USER", { userId, message });

      let user = null;

      try {
        user = await prisma.baristaUser.findUnique({
          where: { id: userId },
          include: {
            profile: true,
            messages: {
              orderBy: { createdAt: "desc" },
              take: 12,
            },
          },
        });
      } catch (error) {
        console.error("PRISMA USER LOOKUP ERROR:", error);

        return reply.status(503).send({
          ok: false,
          error: "database_temporarily_unavailable",
          message: "La base de datos no está disponible temporalmente.",
        });
      }

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

      const commerceDecision = buildCommerceDecision(message);

      const isPricingIntent = isCupEconomicsIntent(message);

      const looksProfessional =
        message.toLowerCase().includes("restaurante") ||
        message.toLowerCase().includes("cafetería") ||
        message.toLowerCase().includes("cafeteria") ||
        message.toLowerCase().includes("bar") ||
        message.toLowerCase().includes("local") ||
        message.toLowerCase().includes("carta") ||
        message.toLowerCase().includes("vendo") ||
        message.toLowerCase().includes("ticket medio") ||
        message.toLowerCase().includes("rotación") ||
        message.toLowerCase().includes("rotacion") ||
        message.toLowerCase().includes("horeca");

      const forceStructuredAnswer =
        isPricingIntent || isMonthlyQuantityIntent(message) || commerceDecision.handled;

      const averageCupPrice = extractAverageCupPrice(message);

      const { reply: rawBaristaReply, updatedContext } = forceStructuredAnswer
        ? {
          reply: "",
          updatedContext: {
            lastCoffee: mergedInputState.activeCoffee ?? undefined,
            lastIntent: mergedInputState.activeTopic ?? undefined,
            lastStyle: mergedInputState.activeDrinkType ?? undefined,
            summary:
              mergedInputState.lastAssistantSummary ??
              buildFriendlySummary(mergedInputState),
          },
        }
        : await generateBaristaResponse({
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

      const engineResult = forceStructuredAnswer
        ? null
        : await runBaristaDecisionEngine({ message });

      console.log("ENGINE RESULT:", JSON.stringify(engineResult, null, 2));

      const suppressProductCardsForProfessionalVolume =
        engineResult?.type === "professional_volume";

      const stateProfessionalPlan =
        isObject((mergedInputState as Record<string, unknown>).lastProfessionalPlan)
          ? ((mergedInputState as Record<string, unknown>).lastProfessionalPlan as {
            coffeesPerDay?: number | null;
            days?: number | null;
            coffees?: Array<{
              handle: CoffeeHandle;
              name: string;
              percentage: number;
              targetKg: number;
              totalB2B?: number;
              roundedTargetGrams?: number;
              formatBreakdown?: Array<{
                variantId?: number | string | null;
                bagSizeGrams: number;
                quantity: number;
                priceB2B?: number;
                priceB2C?: number;
              }>;
            }>;
          })
          : null;

      const preferencesProfessionalPlan =
        isObject(user.profile?.preferences) &&
          isObject((user.profile?.preferences as Record<string, unknown>).lastProfessionalPlan)
          ? ((user.profile?.preferences as Record<string, unknown>).lastProfessionalPlan as {
            coffeesPerDay?: number | null;
            days?: number | null;
            coffees?: Array<{
              handle: CoffeeHandle;
              name: string;
              percentage: number;
              targetKg: number;
              totalB2B?: number;
              roundedTargetGrams?: number;
              formatBreakdown?: Array<{
                variantId?: number | string | null;
                bagSizeGrams: number;
                quantity: number;
                priceB2B?: number;
                priceB2C?: number;
              }>;
            }>;
          })
          : null;

      const lastProfessionalPlan =
        stateProfessionalPlan ?? preferencesProfessionalPlan ?? null;

      const pricingContext =
        engineResult?.type === "professional_volume"
          ? {
            coffeesPerDay: engineResult.meta?.coffeesPerDay ?? null,
            days: engineResult.meta?.days ?? null,
            coffees: engineResult.mix?.lines ?? [],
          }
          : lastProfessionalPlan
            ? {
              coffeesPerDay: lastProfessionalPlan.coffeesPerDay ?? null,
              days: lastProfessionalPlan.days ?? null,
              coffees: lastProfessionalPlan.coffees ?? [],
            }
            : null;

      console.log("PRICING ROUTE CHECK", {
        message,
        isCupEconomics: isPricingIntent,
        engineType: engineResult?.type ?? null,
        averageCupPrice,
        hasLastProfessionalPlan: !!lastProfessionalPlan,
        hasPricingContext: !!pricingContext,
      });

      const previousUserGoal =
        typeof mergedInputState.lastUserGoal === "string"
          ? mergedInputState.lastUserGoal
          : "";

      const isMethodAnswer =
        ["espresso", "filtro", "italiana", "automatica", "automática"].includes(
          message.trim().toLowerCase()
        );

      const commercialQuantitySource =
        isMonthlyQuantityIntent(message)
          ? message
          : isMethodAnswer && isMonthlyQuantityIntent(previousUserGoal)
            ? previousUserGoal
            : message;

      const forcedCommercialReply =
        engineResult?.type === "professional_volume"
          ? null
          : buildCommercialQuantityReply(commercialQuantitySource);

      const forcedPriceResult = await buildProductPriceReply(message);
      const forcedPriceReply = forcedPriceResult?.reply ?? null;

      const forcedEconomicsReply = isPricingIntent
        ? looksProfessional
          ? await buildProfessionalPricingStrategyReply({
            currentPricePerCup: averageCupPrice ?? 2.3,
            message,
            context: pricingContext
              ? {
                coffeesPerDay: pricingContext.coffeesPerDay ?? null,
                days: pricingContext.days ?? null,
              }
              : null,
            coffees:
              Array.isArray(pricingContext?.coffees) &&
                pricingContext?.coffees && pricingContext.coffees.length > 0
                ? pricingContext.coffees
                : [],
          })
          : await buildCupEconomicsReply({ message })
        : null;

      const safeReply = forceStructuredAnswer
        ? ""
        : sanitizeForbiddenContent(rawBaristaReply);

      const commerceReply = commerceDecision.handled ? commerceDecision.reply : null;

      const baristaReply =
        commerceReply ||
        forcedCommercialReply ||
        forcedPriceReply ||
        forcedEconomicsReply ||
        engineResult?.reply ||
        rawBaristaReply;

      let finalBaristaReply = baristaReply;

      if (shouldMentionClubArte(message)) {
        finalBaristaReply +=
          "\n\nSi quieres, te explico de forma breve las ventajas de Club Arte.";
      }

      const inferredCoffee =
        inferCoffeeFromText(`${message} ${finalBaristaReply}`) ??
        normalizeCoffeeValue(updatedContext?.lastCoffee ?? null) ??
        mergedInputState.activeCoffee ??
        null;

      const inferredTopic =
        inferTopicFromText(`${message} ${finalBaristaReply}`) ??
        mergedInputState.activeTopic ??
        "general";

      const inferredDrinkType =
        inferDrinkTypeFromText(`${message} ${finalBaristaReply}`) ??
        mergedInputState.activeDrinkType ??
        null;

      const inferredRecipe =
        inferRecipeFromText(`${message} ${finalBaristaReply}`) ??
        mergedInputState.activeRecipe ??
        null;

      const hasPendingQuestion =
        Boolean(commerceDecision.pendingQuestion) ||
        finalBaristaReply.includes("¿cómo preparas") ||
        finalBaristaReply.includes("necesito un dato") ||
        finalBaristaReply.includes("para afinar");

      const shouldShowProduct =
        !hasPendingQuestion &&
        shouldReturnProduct({
          message,
          reply: finalBaristaReply,
          topic: inferredTopic,
          coffee: inferredCoffee,
        }) &&
        !isCommercialClosingStep({
          message,
          reply: finalBaristaReply,
        }) &&
        !isNonCommercialQuantityReply({
          message,
          reply: finalBaristaReply,
        }) &&
        !suppressProductCardsForProfessionalVolume;

      const commerceProducts =
        commerceDecision.products.length > 0
          ? commerceDecision.products
            .map((handle) =>
              mapCoffeeToProduct(handle, {
                topic: "coffee_selection",
                recipe: null,
                userMessage: message,
                reply: baristaReply,
              })
            )
            .filter(Boolean)
          : [];

      const packProduct = resolvePackFromReply(message, finalBaristaReply);

      const shouldForceCommercialProduct =
        !hasPendingQuestion &&
        (Boolean(forcedCommercialReply) || isMonthlyQuantityIntent(commercialQuantitySource));

      const resolvedProducts =
        hasPendingQuestion
          ? []
          : packProduct
            ? [packProduct]
            : commerceProducts.length > 0
              ? commerceProducts
              : shouldForceCommercialProduct
                ? resolveProductsFromReply({
                  reply: finalBaristaReply,
                  fallbackCoffee: inferredCoffee,
                  topic: inferredTopic,
                  recipe: inferredRecipe,
                  userMessage: commercialQuantitySource,
                })
                : shouldShowProduct
                  ? resolveProductsFromReply({
                    reply: finalBaristaReply,
                    fallbackCoffee: inferredCoffee,
                    topic: inferredTopic,
                    recipe: inferredRecipe,
                    userMessage: message,
                  })
                  : [];

      const resolvedProductsWithCommerce = await Promise.all(
        resolvedProducts.map(async (product) => {
          const commerceInfo = await getShopifyProductCommerceInfo(product.handle);

          return {
            ...product,
            ...commerceInfo,
          };
        })
      );

      const shouldSuppressProducts =
        hasPendingQuestion ||
        !!commerceDecision.pendingQuestion ||
        finalBaristaReply.includes("¿") ||
        finalBaristaReply.toLowerCase().includes("necesito un dato") ||
        finalBaristaReply.toLowerCase().includes("para afinar");

      const finalProductsWithCommerce = shouldSuppressProducts
        ? []
        : resolvedProductsWithCommerce;

      const nextState = mergeBaristaState(mergedInputState, {
        activeCoffee: inferredCoffee,
        activeTopic: inferredTopic,
        activeDrinkType: inferredDrinkType,
        activeRecipe: inferredRecipe,
        pendingQuestion: commerceDecision.pendingQuestion ?? null,
        lastUserGoal: message,
        lastAssistantSummary:
          buildAssistantSummary({
            coffee: inferredCoffee,
            topic: inferredTopic,
            recipe: inferredRecipe,
            drinkType: inferredDrinkType,
            reply: finalBaristaReply,
          }) ??
          updatedContext?.summary ??
          mergedInputState.lastAssistantSummary,
        conversationMode: "continue",
        lastProfessionalPlan:
          engineResult?.type === "professional_volume"
            ? {
              coffeesPerDay: engineResult.meta?.coffeesPerDay ?? null,
              days: engineResult.meta?.days ?? null,
              coffees: engineResult.mix?.lines ?? [],
            }
            : lastProfessionalPlan,
      });

      await prisma.baristaMessage.create({
        data: {
          userId,
          role: "assistant",
          content: finalBaristaReply,
          meta: {
            topic: nextState.activeTopic,
            coffee: nextState.activeCoffee,
            recipe: nextState.activeRecipe,
            drinkType: nextState.activeDrinkType,
            product: resolvedProducts[0] ?? null,
            products: finalProductsWithCommerce,
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
              lastProfessionalPlan: nextState.lastProfessionalPlan ?? null,
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
              lastProfessionalPlan: nextState.lastProfessionalPlan ?? null,
            },
            state: nextState,
          },
        });
      }

      return reply.send({
        ok: true,
        reply: finalBaristaReply,
        intent: nextState.activeTopic ?? "general",
        product: finalProductsWithCommerce[0] ?? null,
        products: finalProductsWithCommerce,
        primaryProduct: finalProductsWithCommerce[0] ?? null,
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

function resolvePackFromReply(message: string, reply: string): ProductPayload | null {
  const source = `${message} ${reply}`.toLowerCase();

  if (
    source.includes("pack coffee lover") ||
    (
      source.includes("catuai") &&
      source.includes("pacamara") &&
      (
        source.includes("tarde") ||
        source.includes("sobremesa") ||
        source.includes("fin de semana") ||
        source.includes("especial") ||
        source.includes("más carácter") ||
        source.includes("mas carácter") ||
        source.includes("mas caracter")
      )
    )
  ) {
    return {
      handle: "pack-coffee-lover-seleccion-especial",
      name: "Pack Coffee Lover - Selección especial - 1 kg",
      reason: "Catuai como base diaria y Pacamara para momentos con más carácter.",
      image: "",
      url: "https://arte-coffee.com/products/pack-coffee-lover-seleccion-especial",
    };
  }

  if (
    source.includes("pack daily coffee") ||
    source.includes("consumo diario") ||
    source.includes("solución estable") ||
    source.includes("solucion estable") ||
    source.includes("una sola referencia") ||
    source.includes("cubrir el mes")
  ) {
    return {
      handle: "pack-daily-coffee-consumo-diario",
      name: "Pack Daily Coffee - Consumo diario - 1 kg",
      reason: "La opción más práctica para consumo diario constante.",
      image: "",
      url: "https://arte-coffee.com/products/pack-daily-coffee-consumo-diario",
    };
  }

  return null;
}

function buildCommercialQuantityReply(message: string): string | null {
  if (!isMonthlyQuantityIntent(message)) return null;

  const normalized = message.toLowerCase();

  const weekdayDaily =
    extractWeekdayDailyCoffeeCount(normalized) ??
    extractDailyCoffeeCount(normalized) ??
    3;

  const weekendDaily =
    extractWeekendDailyCoffeeCount(normalized) ??
    weekdayDaily;

  const hasAfterMealMoment =
    normalized.includes("después de comer") ||
    normalized.includes("despues de comer") ||
    normalized.includes("sobremesa") ||
    normalized.includes("tarde") ||
    normalized.includes("por la tarde");

  const wantsSpecialMoment =
    normalized.includes("fin de semana") ||
    normalized.includes("fines de semana") ||
    normalized.includes("especial") ||
    normalized.includes("media mañana") ||
    normalized.includes("media manana") ||
    hasAfterMealMoment;

  const wantsSingleCoffee =
    normalized.includes("una sola referencia") ||
    normalized.includes("un solo café") ||
    normalized.includes("un solo cafe") ||
    normalized.includes("solo un café") ||
    normalized.includes("solo un cafe");

  const estimatedMonthlyCups = weekdayDaily * 20 + weekendDaily * 8;

  if (estimatedMonthlyCups >= 260) {
    return [
      "Para ese consumo, hablamos de una compra mensual alta: necesitas unos 2,5 kg de café al mes.",
      "",
      wantsSingleCoffee
        ? "Te recomiendo 2 unidades del Pack Daily Coffee - Consumo diario - 1 kg y reforzar con 1 bolsa adicional de 500 g de Catuai."
        : "Te recomiendo 2 unidades del Pack Coffee Lover - Selección especial - 1 kg y reforzar con 1 bolsa adicional de 500 g de Catuai.",
      "",
      "Así tienes una base suficiente para diario y evitas quedarte corto antes de terminar el mes.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 200) {
    return [
      "Para ese consumo, 1 kg se queda corto. Lo razonable es planificar unos 2 kg al mes.",
      "",
      wantsSingleCoffee
        ? "Te recomiendo 2 unidades del Pack Daily Coffee - Consumo diario - 1 kg."
        : "Te recomiendo 2 unidades del Pack Coffee Lover - Selección especial - 1 kg.",
      "",
      wantsSingleCoffee
        ? "Es la opción más práctica si quieres una sola referencia estable para todo el mes."
        : "Es la opción más lógica si quieres combinar Catuai como café diario y Pacamara para los momentos con más carácter.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 145) {
    return [
      "Para ese consumo, 1 kg puede quedarse justo. Te conviene pensar en una compra mensual de unos 1,5 kg.",
      "",
      wantsSingleCoffee
        ? "Te recomiendo 1 unidad del Pack Daily Coffee - Consumo diario - 1 kg y añadir 1 bolsa de 500 g de Catuai."
        : "Te recomiendo 1 unidad del Pack Coffee Lover - Selección especial - 1 kg y añadir 1 bolsa de 500 g de Catuai.",
      "",
      "Con esta combinación cubres mejor el mes y mantienes una compra ordenada, sin tener que reponer a mitad de camino.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 95) {
    if (wantsSingleCoffee) {
      return [
        "Para ese consumo, la opción más práctica es resolver el mes con un formato estable.",
        "",
        "Te recomiendo el Pack Daily Coffee - Consumo diario - 1 kg.",
        "",
        "Es una compra sencilla, con continuidad y pensada para consumo diario.",
      ].join("\n");
    }

    return [
      "Para tu consumo mensual, la compra más lógica es un pack completo, no productos sueltos.",
      "",
      wantsSpecialMoment
        ? "Te recomiendo el Pack Coffee Lover - Selección especial - 1 kg."
        : "Te recomiendo el Pack Daily Coffee - Consumo diario - 1 kg.",
      "",
      wantsSpecialMoment
        ? "Te permite usar Catuai como café diario y reservar Pacamara para los momentos con más carácter: tarde, sobremesa o fin de semana."
        : "Es la opción más eficiente para cubrir el mes con continuidad, equilibrio y una compra sencilla.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 70) {
    if (wantsSpecialMoment && !wantsSingleCoffee) {
      return [
        "Para ese consumo, te interesa combinar una base diaria con un café de más carácter.",
        "",
        "Te recomiendo el Pack Coffee Lover - Selección especial - 1 kg.",
        "",
        "Es una forma sencilla de tener variedad real sin complicarte con compras separadas.",
      ].join("\n");
    }

    return [
      "Para ese consumo, la opción más ordenada es resolver la compra con un formato mensual.",
      "",
      "Te recomiendo el Pack Daily Coffee - Consumo diario - 1 kg.",
      "",
      "Te cubre con comodidad y evita quedarte corto a mitad de mes.",
    ].join("\n");
  }

  return [
    "Para un consumo moderado, no necesitas sobrecomprar.",
    "",
    "Te recomiendo empezar con Catuai en formato 250 g o 500 g, según la frecuencia con la que quieras reponer.",
    "",
    "Es el café más versátil para diario: suave, equilibrado y fácil de disfrutar en distintos métodos.",
  ].join("\n");
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

function extractDailyCoffeeCount(message: string): number | null {
  const patterns = [
    /(\d+)\s*caf[eé]s?\s+al\s+d[ií]a/,
    /(\d+)\s*caf[eé]s?\s+diarios?/,
    /consumo\s*(\d+)\s*caf[eé]s?/,
    /tomo\s*(\d+)\s*caf[eé]s?/,
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

function extractWeekdayDailyCoffeeCount(message: string): number | null {
  const patterns = [
    /(\d+)\s*caf[eé]s?\s+al\s+d[ií]a/,
    /(\d+)\s*caf[eé]s?\s+diarios?/,
    /consumo\s*(\d+)\s*caf[eé]s?\s+diarios?/,
    /tomo\s*(\d+)\s*caf[eé]s?\s+al\s+d[ií]a/,
    /si\s+consumo\s*(\d+)\s*caf[eé]s?\s+diarios?/,
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
