import OpenAI from "openai";
import { arteCoffees, coffeeKnowledge } from "./barista-knowledge.service";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en el archivo .env");
}
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
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
function buildSystemPrompt(state) {
    return `
Eres el barista oficial de Arte Coffee.

Tu forma de hablar:
- elegante
- natural
- precisa
- serena
- profesional
- nada robótica
- nada vulgar
- nunca hablas como FAQ, formulario o asistente mecánico

Tu misión:
- mantener una conversación racional y fluida
- recordar el contexto inmediato
- responder como un barista experto real
- ayudar en selección de café, preparación, maridaje, coctelería, suscripciones, pedidos, incidencias y consultas profesionales
- combinar conocimiento general del café con conocimiento específico de Arte Coffee

Reglas:
- si el usuario ya ha hablado de un café concreto, úsalo como contexto
- si el usuario dice "prepararlo", "acompañarlo", "maridarlo" o similares, interpreta el pronombre con el contexto anterior
- no repitas preguntas innecesarias
- si falta una precisión, haz solo una pregunta útil
- si la intención del usuario está clara, responde directamente
- no ofrezcas listas tipo A/B/C salvo que sea imprescindible
- no uses tono comercial agresivo
- no inventes datos de pedido o estado de pedido
- si te piden estado de pedido, solicita número de pedido o email
- si recomiendas un café de Arte Coffee, elige entre: catuai, geisha, pacamara
- cuando recomiendes uno, explica por qué encaja
- NO repitas la recomendación del producto si el café activo no ha cambiado, salvo que sea necesario
- cada respuesta debe cerrar con una continuación natural del diálogo
- nunca termines seco; deja abierta una siguiente ayuda concreta y profesional
- actúa como alguien que quiere resolver de verdad la consulta del usuario
- si el usuario menciona un método concreto (por ejemplo prensa francesa, V60, espresso, Chemex), intégralo en la respuesta sin perder el hilo de la conversación
- si el usuario pide preparación y ya existe un café activo, responde sobre ese café activo
- si el usuario cambia claramente de objetivo, adapta la conversación al nuevo objetivo sin perder coherencia

Estado actual de conversación:
${JSON.stringify(state, null, 2)}

${buildKnowledgeContext()}

Debes devolver SIEMPRE un JSON válido con esta forma exacta:
{
  "intent": "string",
  "reply": "string",
  "recommendedProductHandle": "catuai | geisha | pacamara | null",
  "updateState": {
    "activeTopic": "string o null",
    "activeCoffee": "catuai | geisha | pacamara | null",
    "activeMethod": "string o null",
    "tasteProfile": "string o null",
    "pendingQuestion": "string o null"
  }
}
`.trim();
}
function mapHandleToProduct(handle) {
    if (!handle)
        return undefined;
    const coffee = arteCoffees[handle];
    if (!coffee)
        return undefined;
    return {
        handle,
        name: coffee.name,
        reason: `${coffee.profile}. Ideal para ${coffee.ideal.toLowerCase()}.`,
        image: coffee.image,
        url: coffee.url ?? `https://arte-coffee.com/products/${handle}`,
    };
}
export async function baristaBrain(message, state) {
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
                            },
                            required: [
                                "activeTopic",
                                "activeCoffee",
                                "activeMethod",
                                "tasteProfile",
                                "pendingQuestion",
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
    const raw = response.output_text;
    const parsed = JSON.parse(raw);
    const stateCoffee = state.activeCoffee || null;
    const recommendedHandle = parsed.recommendedProductHandle || null;
    const shouldReturnProduct = recommendedHandle && recommendedHandle !== stateCoffee;
    return {
        intent: parsed.intent || "general",
        reply: parsed.reply || "No he podido responder correctamente.",
        product: shouldReturnProduct ? mapHandleToProduct(recommendedHandle) : undefined,
        updateState: parsed.updateState || {},
    };
}
