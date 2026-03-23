export type BaristaIntent =
  | "coffee_recommendation"
  | "coffee_clarification"
  | "pairing"
  | "cocktail"
  | "preparation"
  | "order_help"
  | "order_status"
  | "complaint"
  | "subscription_help"
  | "education"
  | "professional";

export type ProductCard = {
  handle: string;
  name: string;
  reason: string;
  image?: string;
  url: string;
};

export type ChatOrchestratorContext = {
  lastCoffee?: string;
  lastIntent?: string;
};

export type ChatOrchestratorResponse = {
  intent: BaristaIntent;
  reply: string;
  product?: ProductCard;
};

const coffees: Record<string, ProductCard & { profile: string[] }> = {
  catuai: {
    handle: "catuai",
    name: "Catuai",
    reason:
      "Encaja por su perfil suave, equilibrado y versátil, ideal para empezar o para disfrutarlo con facilidad en distintos momentos.",
    image:
      "https://arte-coffee.com/cdn/shop/files/Catuai_Lavado.jpg?v=1747402022",
    url: "https://arte-coffee.com/products/catuai",
    profile: ["suave", "equilibrado", "versátil"],
  },
  geisha: {
    handle: "geisha",
    name: "Geisha",
    reason:
      "Encaja por su perfil floral, elegante y aromático, ideal para momentos más pausados y experiencias más delicadas.",
    image:
      "https://arte-coffee.com/cdn/shop/files/Geisha_Lavado.jpg?v=1747402022",
    url: "https://arte-coffee.com/products/geisha",
    profile: ["floral", "elegante", "aromático"],
  },
  pacamara: {
    handle: "pacamara",
    name: "Pacamara",
    reason:
      "Encaja por su mayor cuerpo, intensidad y complejidad, ideal para una experiencia más gastronómica o con más presencia en taza.",
    image:
      "https://arte-coffee.com/cdn/shop/files/Pacamara_Natural.jpg?v=1747402022",
    url: "https://arte-coffee.com/products/pacamara",
    profile: ["intenso", "cuerpo", "complejo"],
  },
};

function findCoffeeByName(name?: string): ProductCard | null {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();

  if (normalized.includes("catuai")) return coffees.catuai;
  if (normalized.includes("geisha")) return coffees.geisha;
  if (normalized.includes("pacamara")) return coffees.pacamara;

  return null;
}

export function detectIntent(message: string): BaristaIntent {
  const msg = message.toLowerCase();

  if (
    msg.includes("estado de mi pedido") ||
    msg.includes("estado del pedido") ||
    msg.includes("he realizado algún pedido") ||
    msg.includes("he realizado algun pedido") ||
    msg.includes("si he realizado algún pedido") ||
    msg.includes("si he realizado algun pedido") ||
    msg.includes("seguimiento del pedido")
  ) {
    return "order_status";
  }

  if (
    msg.includes("pedido") ||
    msg.includes("comprar") ||
    msg.includes("hacer un pedido") ||
    msg.includes("compra directa")
  ) {
    return "order_help";
  }

  if (msg.includes("reclam") || msg.includes("incidencia") || msg.includes("problema")) {
    return "complaint";
  }

  if (msg.includes("suscrip")) {
    return "subscription_help";
  }

  if (msg.includes("cóctel") || msg.includes("coctel") || msg.includes("cocktail")) {
    return "cocktail";
  }

  if (msg.includes("postre") || msg.includes("marid") || msg.includes("acompaña") || msg.includes("acompaña mejor")) {
    return "pairing";
  }

  if (
    msg.includes("prepar") ||
    msg.includes("espresso") ||
    msg.includes("v60") ||
    msg.includes("chemex") ||
    msg.includes("molienda") ||
    msg.includes("sacar el máximo provecho") ||
    msg.includes("sacar el maximo provecho")
  ) {
    return "preparation";
  }

  if (
    msg.includes("carta") ||
    msg.includes("restaurante") ||
    msg.includes("cafetería") ||
    msg.includes("cafeteria") ||
    msg.includes("signature") ||
    msg.includes("formación") ||
    msg.includes("formacion")
  ) {
    return "professional";
  }

  if (
    msg.includes("origen") ||
    msg.includes("diferencias") ||
    msg.includes("cafés del mundo") ||
    msg.includes("cafes del mundo")
  ) {
    return "education";
  }

  return "coffee_recommendation";
}

function extractSignals(message: string) {
  const msg = message.toLowerCase();

  return {
    floral:
      msg.includes("floral") ||
      msg.includes("elegante") ||
      msg.includes("aromático") ||
      msg.includes("aromatico") ||
      msg.includes("fin de semana") ||
      msg.includes("fines de semana") ||
      msg.includes("delicado"),
    intense:
      msg.includes("intenso") ||
      msg.includes("cuerpo") ||
      msg.includes("complejo") ||
      msg.includes("gastronómico") ||
      msg.includes("gastronomico") ||
      msg.includes("chocolate"),
    soft:
      msg.includes("suave") ||
      msg.includes("equilibrado") ||
      msg.includes("versátil") ||
      msg.includes("versatil") ||
      msg.includes("fácil") ||
      msg.includes("facil"),
    dessert:
      msg.includes("postre") ||
      msg.includes("helado") ||
      msg.includes("fruta") ||
      msg.includes("frutas"),
    directCoffeeAsk:
      msg.includes("qué café") ||
      msg.includes("que café") ||
      msg.includes("recomiendas") ||
      msg.includes("recomendar") ||
      msg.includes("orientar") ||
      msg.includes("busco un café") ||
      msg.includes("quiero un café") ||
      msg.includes("café especial") ||
      msg.includes("cafe especial"),
  };
}

export function recommendCoffee(message: string): ProductCard | null {
  const s = extractSignals(message);

  if (s.floral) return coffees.geisha;
  if (s.intense || s.dessert) return coffees.pacamara;
  if (s.soft) return coffees.catuai;

  return null;
}

export function buildResponse(
  message: string,
  context?: ChatOrchestratorContext
): ChatOrchestratorResponse {
  const intent = detectIntent(message);
  const contextCoffee = findCoffeeByName(context?.lastCoffee);

  if (intent === "coffee_recommendation") {
    const signals = extractSignals(message);
    const product = recommendCoffee(message);

    if (!product && signals.directCoffeeAsk) {
      return {
        intent: "coffee_clarification",
        reply:
          "Para orientarte bien, necesito afinar un matiz.\n\n¿Qué perfil te interesa más: algo suave y equilibrado, una expresión más floral, o una taza con más cuerpo?",
      };
    }

    if (!product) {
      return {
        intent: "coffee_clarification",
        reply:
          "Puedo orientarte con criterio.\n\nSi me dices qué perfil te atrae más en taza, te afino mejor la recomendación.",
      };
    }

    return {
      intent,
      reply: `Para lo que buscas, te orientaría hacia ${product.name}.

${product.reason}

Si quieres, puedo indicarte cómo prepararlo mejor o con qué tipo de postre, desayuno o cóctel puede funcionar especialmente bien.`,
      product,
    };
  }

  if (intent === "pairing") {
    const product = recommendCoffee(message) || contextCoffee || coffees.geisha;

    return {
      intent,
      reply: `Para ese tipo de combinación, te orientaría hacia ${product.name}.

${product.reason}

Si me indicas el postre concreto, la fruta o la textura que tienes en mente, te propongo el maridaje con más precisión.`,
      product,
    };
  }

  if (intent === "cocktail") {
    const product = recommendCoffee(message) || contextCoffee || coffees.pacamara;

    return {
      intent,
      reply: `Para coctelería, una buena base sería ${product.name}.

${product.reason}

Si quieres, puedo proponerte una receta concreta según el estilo que busques: más fresco, más elegante o más intenso.`,
      product,
    };
  }

  if (intent === "preparation") {
    const product = contextCoffee || recommendCoffee(message);

    if (!product) {
      return {
        intent,
        reply:
          "Puedo ayudarte con la preparación.\n\nSi me dices qué café quieres trabajar o qué perfil buscas, te indicaré el método que mejor encaja.",
      };
    }

    return {
      intent,
      reply: `Si seguimos con ${product.name}, te orientaría así:

- Para filtro, conviene trabajar una molienda media-fina y una extracción limpia para respetar mejor su perfil.
- Si buscas una taza más expresiva, te diría que priorices método filtrado antes que espresso.
- Si quieres, en el siguiente paso te doy la receta exacta según V60, Chemex o el método que uses en casa.`,
      product,
    };
  }

  if (intent === "order_help") {
    return {
      intent,
      reply:
        "Puedo ayudarte con la compra directa. Si prefieres, dime qué perfil buscas y te orientaré hacia el café que mejor encaje. También puedo aclararte qué opción de suscripción puede interesarte más.",
    };
  }

  if (intent === "order_status") {
    return {
      intent,
      reply:
        "Puedo ayudarte a revisar si ya has realizado un pedido o el estado en que se encuentra. Para ello necesito el número de pedido o el correo con el que se hizo la compra.",
    };
  }

  if (intent === "complaint") {
    return {
      intent,
      reply:
        "Entiendo. Si has tenido una incidencia con un pedido, una entrega o un producto, indícame qué ha ocurrido y te ayudaré a encauzarlo de la forma más adecuada.",
    };
  }

  if (intent === "subscription_help") {
    return {
      intent,
      reply:
        "Puedo ayudarte a entender mejor la suscripción: qué ventajas ofrece, para quién encaja mejor y cómo sacar más valor según tu consumo.",
    };
  }

  if (intent === "professional") {
    return {
      intent,
      reply:
        "Si lo estás planteando desde una perspectiva profesional, puedo orientarte en selección de cafés, propuesta para carta, signature drinks, formación y experiencia de cliente.",
    };
  }

  if (intent === "education") {
    return {
      intent,
      reply:
        "Puedo ayudarte a profundizar en perfiles de taza, diferencias entre cafés, orígenes y formas de disfrutar mejor cada café según el momento y la preparación.",
    };
  }

  return {
    intent: "coffee_recommendation",
    reply: "Entiendo. Cuéntame un poco más y te orientaré con criterio.",
  };
}
