import OpenAI from "openai";
import { arteCoffees, coffeeKnowledge } from "./barista-knowledge.service";
import type { BaristaState } from "./barista-state.service";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type BrainResult = {
  reply: string;
  intent: string;
  product?: {
    handle: string;
    name: string;
    reason: string;
    image?: string;
    url: string;
  };
  updateState?: Partial<BaristaState>;
};

function buildKnowledgeContext() {
  return `
CONOCIMIENTO ARTE COFFEE
- Catuai: ${arteCoffees.catuai.profile}. Ideal para: ${arteCoffees.catuai.ideal}.
- Geisha: ${arteCoffees.geisha.profile}. Ideal para: ${arteCoffees.geisha.ideal}.
- Pacamara: ${arteCoffees.pacamara.profile}. Ideal para: ${arteCoffees.pacamara.ideal}.

CONOCIMIENTO GENERAL DE CAFÉ
- V60: ${coffeeKnowledge.methods.v60}
- Cafetera francesa: ${coffeeKnowledge.methods.french_press}
- Espresso: ${coffeeKnowledge.methods.espresso}
- Chemex: ${coffeeKnowledge.methods.chemex}
- Molienda: ${coffeeKnowledge.tips.grind}
- Agua: ${coffeeKnowledge.tips.water}
`.trim();
}

function buildSystemPrompt(state: BaristaState) {
  return `
Eres el barista oficial de Arte Coffee.

Hablas con elegancia, naturalidad, precisión y calidez profesional.
Nunca suenas robótico.
Nunca usas etiquetas técnicas internas en tus respuestas.
Nunca enseñas nombres de variables, intents ni identificadores del sistema.

Tu misión:
- mantener una conversación coherente y continua
- recordar el contexto real de la conversación
- resolver selección de café, preparación, maridaje, coctelería, recetas, pedidos, suscripciones y consultas profesionales
- combinar conocimiento general del café con conocimiento específico de Arte Coffee

Reglas:
- si el usuario ya viene de un café activo, úsalo como contexto por defecto
- si el usuario usa pronombres como "ese", "este", "prepararlo", "acompañarlo", interpreta el contexto previo
- si el usuario corrige, ajusta sin empezar desde cero
- si el usuario pide una variante, mantén el hilo y cambia solo lo necesario
- si el usuario pide receta, recuerda si veníais de cóctel, mocktail, preparación o postre
- si el usuario pide imagen, sé honesto: no digas que ya la has generado si no existe una imagen real devuelta por el sistema
- no repitas la ficha del producto si el café activo sigue siendo el mismo
- no hagas preguntas innecesarias
- si falta una precisión, haz una sola pregunta útil
- cada respuesta debe sonar humana y dejar una continuación natural
- no inventes estados de pedido
- si piden estado de pedido, solicita email o número de pedido
- si recomiendas un café, elige solo entre catuai, geisha, pacamara

Estado actual de conversación:
${JSON.stringify(state, null, 2)}

${buildKnowledgeContext()}

Devuelve SIEMPRE JSON válido exacto con esta forma:
{
  "intent": "string",
  "reply": "string",
  "recommendedProductHandle": "catuai | geisha | pacamara | null",
  "updateState": {
    "activeTopic": "string | null",
    "activeCoffee": "catuai | geisha | pacamara | null",
    "activeMethod": "string | null",
    "tasteProfile": "string | null",
    "pendingQuestion": "string | null",
    "activeRecipe": "string | null",
    "activeDrinkType": "coffee | cocktail | mocktail | null",
    "lastUserGoal": "string | null",
    "lastAssistantSummary": "string | null",
    "conversationMode": "continue | new | null"
  }
}
`.trim();
}

function mapHandleToProduct(handle: string | null) {
  if (!handle) return undefined;

  const coffee = (arteCoffees as Record<string, any>)[handle];
  if (!coffee) return undefined;

  return {
    handle,
    name: coffee.name,
    reason: `${coffee.profile}. Ideal para ${coffee.ideal.toLowerCase()}.`,
    image: coffee.image,
    url: coffee.url ?? `https://arte-coffee.com/products/${handle}`,
  };
}

export async function baristaBrain(
  message: string,
  state: BaristaState
): Promise<BrainResult> {
  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: buildSystemPrompt(state),
      },
      {
        role: "user",
        content: message,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "barista_response",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            intent: { type: "string" },
            reply: { type: "string" },
            recommendedProductHandle: {
              type: ["string", "null"],
              enum: ["catuai", "geisha", "pacamara", null],
            },
            updateState: {
              type: "object",
              additionalProperties: false,
              properties: {
                activeTopic: { type: ["string", "null"] },
                activeCoffee: {
                  type: ["string", "null"],
                  enum: ["catuai", "geisha", "pacamara", null],
                },
                activeMethod: { type: ["string", "null"] },
                tasteProfile: { type: ["string", "null"] },
                pendingQuestion: { type: ["string", "null"] },
                activeRecipe: { type: ["string", "null"] },
                activeDrinkType: {
                  type: ["string", "null"],
                  enum: ["coffee", "cocktail", "mocktail", null],
                },
                lastUserGoal: { type: ["string", "null"] },
                lastAssistantSummary: { type: ["string", "null"] },
                conversationMode: {
                  type: ["string", "null"],
                  enum: ["continue", "new", null],
                },
              },
              required: [
                "activeTopic",
                "activeCoffee",
                "activeMethod",
                "tasteProfile",
                "pendingQuestion",
                "activeRecipe",
                "activeDrinkType",
                "lastUserGoal",
                "lastAssistantSummary",
                "conversationMode",
              ],
            },
          },
          required: [
            "intent",
            "reply",
            "recommendedProductHandle",
            "updateState",
          ],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text);

  const stateCoffee = state.activeCoffee || null;
  const recommendedHandle = parsed.recommendedProductHandle || null;
  const shouldReturnProduct =
    Boolean(recommendedHandle) && recommendedHandle !== stateCoffee;

  return {
    intent: parsed.intent || "general",
    reply: parsed.reply || "No he podido responder correctamente.",
    product: shouldReturnProduct ? mapHandleToProduct(recommendedHandle) : undefined,
    updateState: parsed.updateState || {},
  };
}
