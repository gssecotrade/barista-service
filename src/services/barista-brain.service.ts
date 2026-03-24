import OpenAI from "openai";
import { getPremiumKnowledge } from "./barista-premium-knowledge.service";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type BaristaContext = {
  lastCoffee?: string;
  lastIntent?: string;
  lastStyle?: string;
  summary?: string;
};

export async function generateBaristaResponse({
  userMessage,
  history = [],
  context,
}: {
  userMessage: string;
  history: { role: string; content: string }[];
  context?: BaristaContext;
}) {
  const currentDateContext = `Fecha actual de referencia: marzo de 2026. Estación probable en España: primavera. Si el usuario habla de temporada actual, interpreta el contexto desde esta fecha y no como otoño o invierno salvo que el usuario diga otra cosa.`;
  
  const premiumKnowledge = getPremiumKnowledge({
    moment: detectMoment(userMessage),
    ingredient: detectIngredient(userMessage),
    productType: detectProductType(userMessage),
    season: detectSeason(userMessage),
    isProfessional: detectProfessionalContext(userMessage),
  });

  const systemPrompt = `
Eres "Tu Barista" de Arte Coffee.

No eres un chatbot. Eres un barista experto y consultor gastronómico premium.

Tu objetivo:
- ayudar
- recomendar con criterio
- crear experiencias
- elevar el nivel del cliente
- responder con valor real, no con respuestas básicas

---

IDENTIDAD

- Hablas con elegancia, claridad y seguridad.
- No suenas técnico ni mecánico.
- No usas respuestas genéricas.
- Tu criterio combina café, gastronomía, experiencia y sentido comercial.
- Tu función es recomendar, inspirar y orientar.

---

CAPACIDADES

Puedes:
- recomendar cafés de Arte Coffee
- proponer maridajes
- crear recetas diferenciales
- diseñar propuestas para casa o para negocio
- sugerir experiencias gastronómicas
- adaptar el consejo al momento del día, ocasión y temporada

---

CATÁLOGO ARTE COFFEE

- Catuai → equilibrado, versátil, elegante, ideal para propuestas amables y muy fáciles de integrar
- Pacamara → estructurado, complejo, con carácter, ideal para sobremesa, postres intensos y propuestas gastronómicas con presencia
- Geisha → delicado, floral, sofisticado, ideal para perfiles más aromáticos, cítricos, fruta y experiencias refinadas

Siempre que recomiendes, explica por qué.

---

INTELIGENCIA DE RESPUESTA

Antes de responder:
1. Detecta la intención principal:
   - recomendación
   - compra
   - maridaje
   - receta
   - postre
   - cóctel / mocktail
   - propuesta para restaurante o local
   - continuidad de conversación

2. Detecta el nivel probable del usuario:
   - casa
   - foodie
   - profesional / horeca

3. Detecta el contexto:
   - momento del día
   - tipo de elaboración
   - ingrediente clave
   - estación o temporada
   - si busca algo clásico o algo diferencial

---

REGLAS IMPORTANTES

- No inventes productos fuera de Arte Coffee.
- No respondas como una FAQ.
- No repitas literalmente lo que ha dicho el usuario.
- No des respuestas planas.
- Si el usuario es ambiguo, decide con inteligencia.
- Si puedes elevar la propuesta, hazlo.
- Si detectas uso profesional, responde con mentalidad de carta, experiencia y diferenciación.
- No fuerces venta, pero sí orienta a producto cuando tenga sentido.
- Si encaja, sugiere probar el café recomendado de forma natural y elegante.
- Si el usuario pide algo especial, responde con una propuesta diferencial, no con una receta básica.

---

ESTILO DE RESPUESTA

Siempre que sea posible:
1. interpreta el momento
2. da una recomendación principal
3. explica por qué
4. añade una propuesta diferencial
5. deja abierta una continuación útil
6. Si hay dos caminos válidos, preséntalos como dos opciones claras, pero indica cuál elegirías tú y por qué.

---

CONVERSIÓN ELEGANTE

Cuando recomiendes un café:
- menciona su nombre
- sugiere de forma natural probarlo
- orienta hacia descubrirlo si encaja

Ejemplo:
"Para este momento, te recomendaría Pacamara. Tiene la estructura y profundidad necesarias para acompañar una sobremesa con más carácter. Si te gusta este tipo de perfil, merece la pena que lo pruebes."

No fuerces venta.
No pongas enlaces técnicos.
Debe sonar como recomendación experta, no comercial.

---

CONOCIMIENTO PREMIUM ADICIONAL

${premiumKnowledge}

${currentDateContext}
---

CONTINUIDAD

Si hay contexto previo, úsalo con naturalidad.

Contexto previo:
${context?.summary || "sin contexto"}

Último café:
${context?.lastCoffee || "no definido"}

Última intención:
${context?.lastIntent || "no definida"}

Último estilo:
${context?.lastStyle || "no definido"}

---

COHERENCIA DE RECOMENDACIÓN

- Si ya hay un café recomendado en el contexto previo o en "Último café", prioriza mantenerlo.
- Solo puedes cambiar de café si hay una razón clara y explícita.
- Si cambias de café, explícalo de forma natural y breve.
- No cambies de café por variar.
- La continuidad tiene más valor que la novedad.
- Si el usuario pide una receta, maridaje o evolución de una propuesta ya iniciada, parte del café activo salvo que sea claramente mejor otro y lo justifiques.

---

PROHIBIDO

- "como asistente"
- "depende" sin criterio
- listas aburridas sin interpretación
- respuestas genéricas tipo blog
- tono vulgar
- lenguaje interno o técnico del sistema
`.trim();

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: userMessage },
  ];

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.7,
  });

  const reply = completion.choices[0].message.content || "";

  return {
    reply,
    updatedContext: {
      ...context,
      summary: generateSummary([
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: reply },
      ]),
      lastIntent: inferIntentLabel(userMessage, reply),
      lastCoffee: inferCoffee(reply) || context?.lastCoffee || "",
      lastStyle: inferStyle(userMessage, reply) || context?.lastStyle || "",
    },
  };
}

function generateSummary(messages: { role: string; content: string }[]) {
  const last = messages
    .slice(-6)
    .map((m) => m.content)
    .join(" ");
  return last.slice(0, 300);
}

function detectMoment(text: string): string | null {
  const normalized = text.toLowerCase();

  if (normalized.includes("sobremesa")) return "sobremesa";
  if (normalized.includes("brunch")) return "brunch";
  if (normalized.includes("desayuno")) return "mañana";
  if (normalized.includes("mañana")) return "mañana";
  if (normalized.includes("merienda")) return "tarde";
  if (normalized.includes("tarde")) return "tarde";
  if (normalized.includes("noche")) return "noche";

  return null;
}

function detectIngredient(text: string): string | null {
  const normalized = text.toLowerCase();

  if (normalized.includes("chocolate") || normalized.includes("cacao")) {
    return "chocolate";
  }

  if (
    normalized.includes("cítrico") ||
    normalized.includes("citricos") ||
    normalized.includes("cítricos") ||
    normalized.includes("naranja") ||
    normalized.includes("limón") ||
    normalized.includes("limon")
  ) {
    return "citricos";
  }

  if (
    normalized.includes("fruta") ||
    normalized.includes("frutos rojos") ||
    normalized.includes("manzana") ||
    normalized.includes("pera")
  ) {
    return "fruta";
  }

  return null;
}

function detectProductType(text: string): string | null {
  const normalized = text.toLowerCase();

  if (normalized.includes("torrija") || normalized.includes("torrijas")) {
    return "torrija";
  }

  if (normalized.includes("mocktail") || normalized.includes("sin alcohol")) {
    return "mocktail";
  }

  if (
    normalized.includes("cocktail") ||
    normalized.includes("cóctel") ||
    normalized.includes("coctel")
  ) {
    return "cocktail";
  }

  if (
    normalized.includes("postre") ||
    normalized.includes("tarta") ||
    normalized.includes("receta")
  ) {
    return "postre";
  }

  return null;
}

function detectSeason(text: string): string | null {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("primavera") ||
    normalized.includes("semana santa") ||
    normalized.includes("torrija") ||
    normalized.includes("torrijas")
  ) {
    return "primavera";
  }

  if (normalized.includes("verano")) return "verano";
  if (normalized.includes("otoño") || normalized.includes("otono")) return "otoño";
  if (normalized.includes("invierno")) return "invierno";

  return null;
}

function detectProfessionalContext(text: string): boolean {
  const normalized = text.toLowerCase();

  return (
    normalized.includes("local") ||
    normalized.includes("restaurante") ||
    normalized.includes("cafetería") ||
    normalized.includes("cafeteria") ||
    normalized.includes("carta") ||
    normalized.includes("negocio") ||
    normalized.includes("hotel") ||
    normalized.includes("horeca")
  );
}

function inferCoffee(text: string): string | null {
  const normalized = text.toLowerCase();

  if (normalized.includes("pacamara")) return "Pacamara";
  if (normalized.includes("geisha")) return "Geisha";
  if (normalized.includes("catuai")) return "Catuai";

  return null;
}

function inferIntentLabel(userMessage: string, reply: string): string {
  const combined = `${userMessage} ${reply}`.toLowerCase();

  if (
    combined.includes("marid") ||
    combined.includes("acompaña") ||
    combined.includes("acompaña") ||
    combined.includes("postre")
  ) {
    return "maridaje";
  }

  if (
    combined.includes("receta") ||
    combined.includes("elaboración") ||
    combined.includes("elaboracion")
  ) {
    return "receta";
  }

  if (
    combined.includes("cocktail") ||
    combined.includes("cóctel") ||
    combined.includes("coctel")
  ) {
    return "cóctel";
  }

  if (combined.includes("sin alcohol") || combined.includes("mocktail")) {
    return "propuesta sin alcohol";
  }

  if (
    combined.includes("comprar") ||
    combined.includes("pruébalo") ||
    combined.includes("pruebalo") ||
    combined.includes("descubrirlo")
  ) {
    return "compra";
  }

  if (
    combined.includes("local") ||
    combined.includes("restaurante") ||
    combined.includes("carta") ||
    combined.includes("negocio")
  ) {
    return "propuesta para local";
  }

  return "recomendación de café";
}

function inferStyle(userMessage: string, reply: string): string | null {
  const combined = `${userMessage} ${reply}`.toLowerCase();

  if (combined.includes("sobremesa")) return "sobremesa";
  if (combined.includes("brunch")) return "brunch";
  if (combined.includes("más intenso") || combined.includes("mas intenso")) {
    return "intenso";
  }
  if (
    combined.includes("más suave") ||
    combined.includes("mas suave") ||
    combined.includes("delicado")
  ) {
    return "suave";
  }
  if (
    combined.includes("especial") ||
    combined.includes("sofisticado") ||
    combined.includes("premium")
  ) {
    return "especial";
  }

  return null;
}
