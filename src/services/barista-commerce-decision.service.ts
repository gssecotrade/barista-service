type CoffeeHandle = "catuai" | "pacamara" | "geisha";

type CommerceDecision = {
  handled: boolean;
  reply: string;
  products: CoffeeHandle[];
  pendingQuestion?: string | null;
};

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function extractDailyCups(text: string): number | null {
  const patterns = [
    /(\d+)\s*caf[eé]s?\s+al\s+d[ií]a/,
    /(\d+)\s*caf[eé]s?\s+diarios?/,
    /tomo\s*(\d+)\s*caf[eé]s?/,
    /consumo\s*(\d+)\s*caf[eé]s?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

function detectMethod(text: string): string | null {
  if (includesAny(text, ["espresso", "expreso"])) return "espresso";
  if (includesAny(text, ["filtro", "v60", "chemex"])) return "filtro";
  if (includesAny(text, ["italiana", "moka"])) return "italiana";
  if (includesAny(text, ["prensa francesa", "french press"])) return "prensa francesa";
  return null;
}

export function buildCommerceDecision(message: string): CommerceDecision {
  const text = message.toLowerCase();

  const isConsumptionIntent = includesAny(text, [
    "cuánto café",
    "cuanto café",
    "cuánto cafe",
    "cuanto cafe",
    "consumo",
    "cafés diarios",
    "cafes diarios",
    "al mes",
    "mensual",
    "comprar al mes",
  ]);

  const isRecommendationIntent = includesAny(text, [
    "qué café",
    "que café",
    "recomiendas",
    "recomendar",
    "cuál me conviene",
    "cual me conviene",
  ]);

  const isGiftIntent = includesAny(text, [
    "regalo",
    "regalar",
    "detalle",
    "experiencia",
  ]);

  const method = detectMethod(text);
  const dailyCups = extractDailyCups(text);

  if (isConsumptionIntent) {
    if (!method) {
      return {
        handled: true,
        products: [],
        pendingQuestion: "method",
        reply:
          "Perfecto. Para afinar bien la recomendación de compra mensual necesito un dato clave: ¿cómo preparas normalmente el café: espresso, filtro, italiana o automática?",
      };
    }

    if (dailyCups && dailyCups >= 5) {
      return {
        handled: true,
        products: ["catuai", "pacamara"],
        reply:
          "Con ese consumo, no te recomendaría comprar bolsas sueltas sin criterio. Lo más lógico es cubrir la base diaria con Catuai y añadir Pacamara para los momentos con más carácter.\n\nPara tu caso, trabajaría con una compra mensual basada en Catuai como café de rotación y Pacamara como complemento de mayor valor.",
      };
    }

    return {
      handled: true,
      products: ["catuai"],
      reply:
        "Para un consumo moderado, empezaría con Catuai. Es el perfil más equilibrado para diario y te permite mantener una compra sencilla sin renunciar a calidad.",
    };
  }

  if (isGiftIntent) {
    return {
      handled: true,
      products: ["catuai", "pacamara", "geisha"],
      reply:
        "Para regalo, elegiría una experiencia de descubrimiento antes que un solo café. Así permites probar perfiles distintos: Catuai como equilibrio, Pacamara como carácter y Geisha como experiencia más floral y especial.",
    };
  }

  if (isRecommendationIntent) {
    if (includesAny(text, ["mañana", "desayuno", "diario"])) {
      return {
        handled: true,
        products: ["catuai"],
        reply:
          "Para la mañana elegiría Catuai. Es equilibrado, versátil y funciona muy bien como café de diario sin cansar.",
      };
    }

    if (includesAny(text, ["sobremesa", "después de comer", "despues de comer", "intenso", "cuerpo"])) {
      return {
        handled: true,
        products: ["pacamara"],
        reply:
          "Para sobremesa elegiría Pacamara. Tiene más estructura, más presencia en boca y acompaña mejor un momento gastronómico.",
      };
    }

    if (includesAny(text, ["especial", "premium", "floral", "delicado"])) {
      return {
        handled: true,
        products: ["geisha"],
        reply:
          "Si buscas algo más especial, elegiría Geisha. Es el perfil más delicado, floral y sofisticado de la selección.",
      };
    }

    return {
      handled: true,
      products: [],
      pendingQuestion: "taste",
      reply:
        "Te puedo recomendar uno con bastante precisión, pero antes necesito saber qué buscas: ¿un café equilibrado para diario, uno con más cuerpo o algo más especial y floral?",
    };
  }

  return {
    handled: false,
    products: [],
    reply: "",
  };
}
