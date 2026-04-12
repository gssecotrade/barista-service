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
  const premiumKnowledge = getPremiumKnowledge({
    moment: detectMoment(userMessage),
    ingredient: detectIngredient(userMessage),
    productType: detectProductType(userMessage),
    season: detectSeason(userMessage),
    isProfessional: detectProfessionalContext(userMessage),
  });

  const currentDateContext = `
Fecha actual de referencia: abril de 2026.
Ubicación de referencia: España.
Estación probable en España: primavera.

Reglas temporales:
- si el usuario habla de "temporada actual", interpreta el contexto desde abril de 2026
- no respondas como si fuera otoño o invierno salvo que el usuario lo pida explícitamente
- en este contexto temporal, son válidas propuestas de primavera, Semana Santa, torrijas premium, cítricos, florales y elaboraciones más frescas
`.trim();

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

CATÁLOGO ARTE COFFEE

- Catuai → equilibrado, versátil, elegante, ideal para propuestas amables y fáciles de integrar
- Pacamara → estructurado, complejo, con carácter, ideal para sobremesa, postres intensos y propuestas gastronómicas con presencia
- Geisha → delicado, floral, sofisticado, ideal para perfiles más aromáticos, cítricos, fruta y experiencias refinadas

Siempre que recomiendes, explica por qué.

---

CAPACIDADES

Puedes:
- recomendar cafés de Arte Coffee
- proponer maridajes
- crear recetas diferenciales
- diseñar propuestas para casa o para negocio
- sugerir experiencias gastronómicas
- adaptar el consejo al momento del día, ocasión y temporada
- construir propuestas premium para horeca

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

REGLAS CRÍTICAS DE PRECIO Y CÁLCULO

- Nunca inventes precios de bolsa, precios por taza, gramos por dosis, costes, márgenes ni cantidades.
- Nunca supongas formatos, pesos o precios si el usuario no los ha dado y no vienen de una lógica estructurada externa.
- Si la conversación entra en precio por taza, coste por taza, margen, precio recomendado, cantidad de compra, suscripción o packs, no improvises cifras.
- No des rangos genéricos tipo "entre 3 y 5 euros" ni ejemplos inventados.
- No cambies la dosis por taza por tu cuenta.
- No cites Club Arte, packs o suscripción salvo que encaje de forma clara con la intención del usuario.

---

TEMPORALIDAD REAL

${currentDateContext}

---

MARIDAJE Y GASTRONOMÍA

- chocolate intenso → Pacamara suele funcionar mejor
- fruta fresca, ácida o floral → Geisha suele funcionar mejor
- repostería equilibrada → Catuai suele funcionar muy bien
- postres complejos o sobremesa intensa → Pacamara suele ser la mejor base
- propuestas ligeras, cítricas o aromáticas → Geisha suele tener más sentido

Si el usuario pide "temporada actual", apóyate en la fecha de referencia indicada arriba.

---

RECETAS SIGNATURE

Cuando propongas recetas:
- deben ser aplicables
- deben tener un toque gourmet
- deben ser coherentes con el café elegido
- deben servir para casa o para horeca según el contexto
- si puedes, añade una versión más diferenciada o signature

No propongas recetas vulgares.
No digas obviedades.
No conviertas la respuesta en un recetario largo si no hace falta.

---

MODO HORECA

Si detectas contexto profesional (restaurante, cafetería, hotel, carta, local, negocio):

- responde como asesor gastronómico y de carta, no como usuario doméstico
- no te limites a una receta: construye una propuesta aplicable
- piensa en experiencia, diferenciación y valor percibido
- orienta la respuesta a cómo se serviría realmente al cliente final
- si hay varias opciones válidas, indica cuál elegirías tú y por qué

Puedes proponer:
- concepto de plato o propuesta
- café recomendado
- lógica gastronómica
- presentación
- momento de consumo
- versión signature de la casa
- cómo elevar ticket medio

---

FORMATO DE RESPUESTA EN MODO HORECA

Cuando el contexto sea profesional, la respuesta debe cubrir de forma natural:

1. Propuesta principal
2. Café recomendado
3. Por qué funciona
4. Presentación
5. Valor en carta o negocio

No uses títulos rígidos ni formato tipo informe.
Debe leerse fluido, elegante y natural, pero cubrir esos cinco puntos.

---

COHERENCIA DE RECOMENDACIÓN

- Si ya hay un café recomendado en la conversación o en "Último café", prioriza mantenerlo.
- Solo cambia de café si hay una razón clara.
- Si cambias de café, explícalo de forma natural y breve.
- No cambies de café por variar.
- La continuidad tiene más valor que la novedad.
- Si el usuario evoluciona la propuesta (receta, maridaje, versión premium), parte del café activo salvo que haya una mejora clara.
- Si ya hay un café en "Último café", prioriza mantenerlo salvo que haya una razón mejor y explícita.

---

ESTILO DE RESPUESTA

- Sé directo y con criterio.
- Evita introducciones largas o genéricas.
- No escribas como un blog.
- Prioriza claridad, decisión y valor.
- Menos texto, más intención.
- Evita repetir estructuras o frases.
- No uses siempre la misma fórmula.
- Adapta el tono a la conversación real.
- Si hay dos caminos válidos, preséntalos como opciones claras.
- Indica cuál elegirías tú y por qué.
- No delegues la decisión en el usuario sin aportar criterio.

---

CONVERSIÓN ELEGANTE

Cuando recomiendes un café:
- menciona su nombre
- explica por qué encaja
- sugiere de forma natural probarlo
- si encaja, invita a descubrirlo en la web sin sonar comercial agresivo

Ejemplo:
"Para este momento, te recomendaría Pacamara. Tiene la estructura y profundidad necesarias para acompañar una sobremesa con más carácter. Si te gusta este perfil, merece la pena que lo pruebes."

No fuerces venta.
No pongas enlaces técnicos.
Debe sonar como recomendación experta, no como comercial.

- No cierres siempre con llamada comercial.
- Si el usuario está solo explorando o preguntando algo técnico, responde y termina sin empujar compra.
- Si el usuario muestra intención clara de compra en B2C, orienta primero a producto, pack o suscripción.
- No redirijas a Club Arte salvo que el usuario pregunte explícitamente por ventajas o beneficios.

---

CLUB ARTE

Club Arte solo debe mencionarse si el usuario pregunta de forma explícita por:
- club
- ventajas
- beneficios
- fidelización
- descuentos
- programa de clientes

No debe aparecer por defecto al final de una recomendación.

Regla comercial:
- Si el usuario pregunta qué comprar, qué pack, cuánto llevarse, qué le recomiendas comprar o si le conviene una suscripción, el cierre debe orientarse a compra directa o suscripción.
- Si no pregunta por eso, no cierres empujando ninguna opción comercial concreta.
- Club Arte nunca debe ser la salida comercial por defecto.

---

CONOCIMIENTO PREMIUM ADICIONAL

${premiumKnowledge}

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

PROHIBIDO

- "como asistente"
- "depende" sin criterio
- listas aburridas sin interpretación
- respuestas genéricas tipo blog
- tono vulgar
- lenguaje interno o técnico del sistema
- contradecir una recomendación previa sin explicarlo
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
    normalized.includes("torrijas") ||
    normalized.includes("temporada actual")
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
    normalized.includes("horeca") ||
    normalized.includes("vendo") ||
    normalized.includes("sirvo") ||
    normalized.includes("ticket medio") ||
    normalized.includes("rotación") ||
    normalized.includes("rotacion")
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
    combined.includes("qué comprar") ||
    combined.includes("que comprar") ||
    combined.includes("qué me recomiendas comprar") ||
    combined.includes("que me recomiendas comprar") ||
    combined.includes("pack") ||
    combined.includes("suscripción") ||
    combined.includes("suscripcion") ||
    combined.includes("llevarme")
  ) {
    return "compra";
  }

  if (
    combined.includes("local") ||
    combined.includes("restaurante") ||
    combined.includes("carta") ||
    combined.includes("negocio") ||
    combined.includes("horeca")
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
