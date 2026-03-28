type CoffeeHandle = "catuai" | "pacamara" | "geisha";

type BusinessMode =
  | "restaurant"
  | "fine_dining"
  | "cafeteria"
  | "hotel"
  | "generic_horeca";

export type BaristaDecisionIntent =
  | "professional_volume"
  | "cup_economics"
  | "monthly_quantity"
  | "general";

export type ProfessionalVolumeResult = {
  coffeesPerDay: number;
  days: number;
  gramsPerCup: number;
  cupsTotal: number;
  totalGrams: number;
  totalKg: number;
  recommended1kgBags: number;
  businessMode: BusinessMode;
  momentBreakdown: {
    morning: number;
    sobremesa: number;
    evening: number;
    other: number;
  };
};

export type ProfessionalMixLine = {
  handle: CoffeeHandle;
  name: string;
  percentage: number;
  targetKg: number;
  bagSizeGrams: number;
  bagCount: number;
  variantId: number | null;
  priceB2CPerBag: number;
  priceB2BPerBag: number;
  totalB2C: number;
  totalB2B: number;
};

export type ProfessionalMixResult = {
  totalKg: number;
  lines: ProfessionalMixLine[];
  totalEstimatedB2B: number;
  totalEstimatedB2C: number;
  cartUrl: string | null;
};

export type DecisionEngineResult =
  | {
      type: "professional_volume";
      reply: string;
      meta: ProfessionalVolumeResult;
      mix: ProfessionalMixResult | null;
    }
  | {
      type: "monthly_quantity";
      reply: string;
    }
  | null;

type ShopifyProductJson = {
  title?: string;
  handle?: string;
  variants?: Array<{
    id?: number;
    title?: string;
    price?: number | string;
  }>;
};

type ProductVariantInfo = {
  id: number | null;
  title: string;
  priceB2C: number;
  priceB2B: number;
  bagSizeGrams: number;
};

const SHOPIFY_BASE_URL = "https://arte-coffee.com";
const B2B_FACTOR = 0.8; // B2B = 20% menos que B2C

const coffeeNames: Record<CoffeeHandle, string> = {
  catuai: "Catuai",
  pacamara: "Pacamara",
  geisha: "Geisha",
};

export async function runBaristaDecisionEngine(params: {
  message: string;
}): Promise<DecisionEngineResult> {
  const { message } = params;
  const intent = detectDecisionIntent(message);

  if (intent === "professional_volume") {
    const parsed = parseProfessionalVolumeQuery(message);
    if (!parsed) return null;

    const calculated = calculateProfessionalCoffeeVolume(parsed);
    const mix = await buildProfessionalMixRecommendation(calculated);

    return {
      type: "professional_volume",
      reply: buildProfessionalVolumeReply(calculated, mix),
      meta: calculated,
      mix,
    };
  }

  if (intent === "monthly_quantity") {
    const reply = buildCommercialQuantityReplyAdvanced(message);
    if (!reply) return null;

    return {
      type: "monthly_quantity",
      reply,
    };
  }

  return null;
}

export function detectDecisionIntent(message: string): BaristaDecisionIntent {
  const text = normalize(message);

  if (isProfessionalVolumeIntent(text)) return "professional_volume";
  if (isMonthlyQuantityIntent(text)) return "monthly_quantity";

  return "general";
}

export function isProfessionalVolumeIntent(text: string): boolean {
  return (
    (text.includes("restaurante") ||
      text.includes("cafeteria") ||
      text.includes("cafetería") ||
      text.includes("hotel") ||
      text.includes("horeca") ||
      text.includes("sirvo") ||
      text.includes("fine dining") ||
      text.includes("degustacion") ||
      text.includes("degustación")) &&
    (text.includes("cafes") ||
      text.includes("cafés") ||
      text.includes("tazas") ||
      text.includes("cada 15 dias") ||
      text.includes("cada 15 días") ||
      text.includes("cuanto cafe tendria que comprar") ||
      text.includes("cuánto café tendría que comprar") ||
      text.includes("cuanto cafe comprar") ||
      text.includes("volumen de cafe") ||
      text.includes("volumen de café"))
  );
}

export function isMonthlyQuantityIntent(message: string): boolean {
  const text = normalize(message);

  return (
    text.includes("cuanto comprar") ||
    text.includes("cuánto comprar") ||
    text.includes("cantidad a comprar") ||
    text.includes("que cantidad comprar") ||
    text.includes("qué cantidad comprar") ||
    text.includes("mensualmente") ||
    text.includes("al mes") ||
    text.includes("consumo mensual") ||
    text.includes("consumo semanal") ||
    text.includes("tomo") ||
    text.includes("cafes al dia") ||
    text.includes("cafés al día") ||
    text.includes("rutina de consumo") ||
    text.includes("que me recomiendas comprar") ||
    text.includes("qué me recomiendas comprar")
  );
}

export function parseProfessionalVolumeQuery(message: string): {
  coffeesPerDay: number;
  days: number;
  gramsPerCup: number;
  businessMode: BusinessMode;
  momentBreakdown: {
    morning: number;
    sobremesa: number;
    evening: number;
    other: number;
  };
} | null {
  const text = normalize(message);

  const declaredTotal =
    extractDeclaredTotalCoffeesPerDay(text) ??
    extractDailyCoffeeCount(text) ??
    extractNumberBefore(text, "tazas") ??
    extractNumberBefore(text, "cafes") ??
    extractNumberBefore(text, "cafés");

  const morning = extractMomentCoffeeCount(text, [
    "mañana",
    "manana",
    "matutino",
    "matutina",
    "desayuno",
    "por la mañana",
    "por la manana",
  ]);

  const sobremesa = extractMomentCoffeeCount(text, [
    "sobremesa",
    "despues de comer",
    "después de comer",
    "almuerzo",
    "comida",
  ]);

  const evening = extractMomentCoffeeCount(text, [
    "tarde-noche",
    "tarde noche",
    "tarde",
    "noche",
    "tarde noche",
  ]);

  const identifiedMoments = morning + sobremesa + evening;

  const coffeesPerDay =
    declaredTotal ??
    (identifiedMoments > 0 ? identifiedMoments : null) ??
    extractTotalCoffeesFromText(text);

  if (!coffeesPerDay) return null;

  let days = 30;

  if (text.includes("cada 15 dias") || text.includes("cada 15 días")) {
    days = 15;
  } else if (text.includes("a la semana") || text.includes("por semana")) {
    days = 7;
  } else if (text.includes("al mes") || text.includes("mensual")) {
    days = 30;
  }

  const gramsPerCup =
    extractExplicitGramsPerCup(text) ?? inferGramsPerCupFromContext(text) ?? 8;

  const other = Math.max(0, coffeesPerDay - identifiedMoments);
  const businessMode = detectBusinessMode(text);

  return {
    coffeesPerDay,
    days,
    gramsPerCup,
    businessMode,
    momentBreakdown: {
      morning,
      sobremesa,
      evening,
      other,
    },
  };
}

export function calculateProfessionalCoffeeVolume(input: {
  coffeesPerDay: number;
  days: number;
  gramsPerCup: number;
  businessMode: BusinessMode;
  momentBreakdown: {
    morning: number;
    sobremesa: number;
    evening: number;
    other: number;
  };
}): ProfessionalVolumeResult {
  const cupsTotal = input.coffeesPerDay * input.days;
  const totalGrams = cupsTotal * input.gramsPerCup;
  const totalKg = totalGrams / 1000;
  const recommended1kgBags = Math.ceil(totalKg);

  return {
    coffeesPerDay: input.coffeesPerDay,
    days: input.days,
    gramsPerCup: input.gramsPerCup,
    cupsTotal,
    totalGrams,
    totalKg,
    recommended1kgBags,
    businessMode: input.businessMode,
    momentBreakdown: input.momentBreakdown,
  };
}

export async function buildProfessionalMixRecommendation(
  result: ProfessionalVolumeResult
): Promise<ProfessionalMixResult | null> {
  const mix = buildMomentBasedMix(result);

  const entries = await Promise.all(
    (Object.entries(mix) as Array<[CoffeeHandle, number]>).map(
      async ([handle, percentage]) => {
        if (percentage < 0.01) return null;

        const targetKg = result.totalKg * percentage;
        const variants = await getShopifyVariantsForHandle(handle);
        const preferred = pickPreferredProfessionalVariant(variants);

        if (!preferred) return null;

        const bagCount = Math.max(
          1,
          Math.ceil((targetKg * 1000) / preferred.bagSizeGrams)
        );

        const totalB2C = roundMoney(preferred.priceB2C * bagCount);
        const totalB2B = roundMoney(preferred.priceB2B * bagCount);

        return {
          handle,
          name: coffeeNames[handle],
          percentage,
          targetKg: roundToOneDecimal(targetKg),
          bagSizeGrams: preferred.bagSizeGrams,
          bagCount,
          variantId: preferred.id,
          priceB2CPerBag: preferred.priceB2C,
          priceB2BPerBag: preferred.priceB2B,
          totalB2C,
          totalB2B,
        } satisfies ProfessionalMixLine;
      }
    )
  );

  const lines = entries.filter(Boolean) as ProfessionalMixLine[];

  if (!lines.length) return null;

  const totalEstimatedB2B = roundMoney(
    lines.reduce((sum, line) => sum + line.totalB2B, 0)
  );
  const totalEstimatedB2C = roundMoney(
    lines.reduce((sum, line) => sum + line.totalB2C, 0)
  );

  const cartParts = lines
    .filter((line) => line.variantId && line.bagCount > 0)
    .map((line) => `${line.variantId}:${line.bagCount}`);

  const cartUrl = cartParts.length
    ? `${SHOPIFY_BASE_URL}/cart/${cartParts.join(",")}`
    : null;

  return {
    totalKg: roundToOneDecimal(result.totalKg),
    lines,
    totalEstimatedB2B,
    totalEstimatedB2C,
    cartUrl,
  };
}

export function buildProfessionalVolumeReply(
  result: ProfessionalVolumeResult,
  mix: ProfessionalMixResult | null
): string {
  const periodLabel =
    result.days === 15
      ? "cada 15 días"
      : result.days === 7
      ? "por semana"
      : "al mes";

  const lines: string[] = [
    `Necesitarías aproximadamente ${formatKg(result.totalKg)} de café ${periodLabel}.`,
    "",
  ];

  if (mix?.lines.length) {
    lines.push("Propuesta de variedades:");

    mix.lines.forEach((line) => {
      lines.push(
        `- ${line.name}: ${line.bagCount} bolsas de ${formatBagSize(line.bagSizeGrams)} (${Math.round(line.percentage * 100)}%)`
      );
    });

    lines.push("", `Enfoque recomendado: ${getBusinessModeLabel(result.businessMode)}.`);
  } else {
    lines.push(
      "Formato recomendado:",
      `- ${result.recommended1kgBags} bolsas de 1 kg`
    );
  }

  return lines.join("\n");
}

function buildMomentBasedMix(
  result: ProfessionalVolumeResult
): Record<CoffeeHandle, number> {
  const { morning, sobremesa, evening, other } = result.momentBreakdown;

  const totalAssigned = morning + sobremesa + evening + other;

  if (totalAssigned > 0) {
    const roleWeighted = {
      catuai:
        morning * 0.85 +
        sobremesa * 0.15 +
        evening * 0.1 +
        other * 1.0,
      pacamara:
        morning * 0.1 +
        sobremesa * 0.7 +
        evening * 0.2 +
        other * 0.0,
      geisha:
        morning * 0.05 +
        sobremesa * 0.15 +
        evening * 0.7 +
        other * 0.0,
    };

    const businessAdjusted = applyBusinessModeBias(
      normalizeMix(roleWeighted),
      result.businessMode
    );

    let mix = normalizeMix(businessAdjusted);

    if (result.totalKg >= 20) {
      if (mix.pacamara < 0.1) mix.pacamara = 0.1;
      if (mix.geisha < 0.05) mix.geisha = 0.05;
    }

    mix = normalizeMix(mix);

    return mix;
  }

  const fallback = getFallbackMixByBusinessMode(result);
  return normalizeMix(fallback);
}

function applyBusinessModeBias(
  mix: Record<CoffeeHandle, number>,
  businessMode: BusinessMode
): Record<CoffeeHandle, number> {
  switch (businessMode) {
    case "fine_dining":
      return {
        catuai: mix.catuai * 0.9,
        pacamara: mix.pacamara * 1.05,
        geisha: mix.geisha * 1.35,
      };

    case "cafeteria":
      return {
        catuai: mix.catuai * 1.25,
        pacamara: mix.pacamara * 0.95,
        geisha: mix.geisha * 0.65,
      };

    case "hotel":
      return {
        catuai: mix.catuai * 0.95,
        pacamara: mix.pacamara * 1.25,
        geisha: mix.geisha * 0.9,
      };

    case "restaurant":
      return {
        catuai: mix.catuai * 1.0,
        pacamara: mix.pacamara * 1.1,
        geisha: mix.geisha * 0.95,
      };

    case "generic_horeca":
    default:
      return mix;
  }
}

function getFallbackMixByBusinessMode(
  result: ProfessionalVolumeResult
): Record<CoffeeHandle, number> {
  switch (result.businessMode) {
    case "fine_dining":
      return {
        catuai: 0.5,
        pacamara: 0.25,
        geisha: 0.25,
      };

    case "cafeteria":
      return {
        catuai: 0.8,
        pacamara: 0.17,
        geisha: 0.03,
      };

    case "hotel":
      return {
        catuai: 0.6,
        pacamara: 0.3,
        geisha: 0.1,
      };

    case "restaurant":
      return {
        catuai: 0.65,
        pacamara: 0.25,
        geisha: 0.1,
      };

    case "generic_horeca":
    default:
      if (result.totalKg >= 40) {
        return {
          catuai: 0.7,
          pacamara: 0.2,
          geisha: 0.1,
        };
      }

      if (result.totalKg >= 20) {
        return {
          catuai: 0.75,
          pacamara: 0.2,
          geisha: 0.05,
        };
      }

      return {
        catuai: 0.8,
        pacamara: 0.2,
        geisha: 0,
      };
  }
}

function normalizeMix(
  mix: Record<CoffeeHandle, number>
): Record<CoffeeHandle, number> {
  const total = Object.values(mix).reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return {
      catuai: 0.8,
      pacamara: 0.2,
      geisha: 0,
    };
  }

  return {
    catuai: mix.catuai / total,
    pacamara: mix.pacamara / total,
    geisha: mix.geisha / total,
  };
}

function detectBusinessMode(text: string): BusinessMode {
  if (
    text.includes("fine dining") ||
    text.includes("alta cocina") ||
    text.includes("gastronomico") ||
    text.includes("gastronómico") ||
    text.includes("menu degustacion") ||
    text.includes("menú degustación")
  ) {
    return "fine_dining";
  }

  if (
    text.includes("cafeteria") ||
    text.includes("cafetería") ||
    text.includes("coffee shop")
  ) {
    return "cafeteria";
  }

  if (text.includes("hotel")) {
    return "hotel";
  }

  if (text.includes("restaurante")) {
    return "restaurant";
  }

  return "generic_horeca";
}

function getBusinessModeLabel(mode: BusinessMode): string {
  switch (mode) {
    case "fine_dining":
      return "más peso en referencias premium y de diferenciación";
    case "cafeteria":
      return "más peso en continuidad operativa y rotación";
    case "hotel":
      return "más peso en equilibrio y sobremesa";
    case "restaurant":
      return "equilibrio entre base diaria y propuesta gastronómica";
    case "generic_horeca":
    default:
      return "mix equilibrado para operativa profesional";
  }
}

export function buildCommercialQuantityReplyAdvanced(message: string): string | null {
  const normalized = normalize(message);

  const weekdayDaily =
    extractWeekdayDailyCoffeeCount(normalized) ??
    extractDailyCoffeeCount(normalized) ??
    3;

  const weekendDaily =
    extractWeekendDailyCoffeeCount(normalized) ?? weekdayDaily;

  const hasAfterMealMoment =
    normalized.includes("despues de comer") ||
    normalized.includes("después de comer") ||
    normalized.includes("sobremesa");

  const hasMidMorningMoment =
    normalized.includes("media manana") ||
    normalized.includes("media mañana");

  const wantsPremiumWeekend =
    normalized.includes("fin de semana") ||
    normalized.includes("fines de semana") ||
    hasAfterMealMoment ||
    hasMidMorningMoment;

  const estimatedMonthlyCups = weekdayDaily * 20 + weekendDaily * 8;

  if (estimatedMonthlyCups >= 95 && wantsPremiumWeekend && hasAfterMealMoment) {
    return [
      "Recomendación mensual:",
      "- 2 bolsas de 500 g de Catuai para el consumo diario",
      "- 1 bolsa de 250 g de Pacamara para sobremesas y fines de semana",
      "",
      "Cubres el mes con una base práctica y una referencia con más carácter.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 95) {
    return [
      "Recomendación mensual:",
      "- 2 bolsas de 500 g de Catuai",
      "",
      "Es la opción más práctica para cubrir el consumo mensual con continuidad.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 70 && wantsPremiumWeekend) {
    return [
      "Recomendación mensual:",
      "- 1 bolsa de 500 g de Catuai",
      "- 1 bolsa de 250 g de Geisha para momentos más especiales",
      "",
      "Tienes cubierta la rutina y además una referencia más refinada para salir de la rutina.",
    ].join("\n");
  }

  if (estimatedMonthlyCups >= 70) {
    return [
      "Recomendación mensual:",
      "- 1 bolsa de 500 g de Catuai",
      "- 1 bolsa de 250 g de Catuai",
      "",
      "Cubres el mes con una compra simple y fácil de gestionar.",
    ].join("\n");
  }

  return [
    "Recomendación mensual:",
    "- 3 bolsas de 250 g de Catuai",
    "",
    "Te encaja bien si quieres formatos más manejables para el consumo diario.",
  ].join("\n");
}

async function getShopifyVariantsForHandle(
  handle: CoffeeHandle
): Promise<ProductVariantInfo[]> {
  const response = await fetch(`${SHOPIFY_BASE_URL}/products/${handle}.js`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) return [];

  const data = (await response.json()) as ShopifyProductJson;

  return (data.variants || [])
    .map((variant) => {
      const bagSizeGrams = parseBagSizeGrams(variant.title || "");
      if (!bagSizeGrams) return null;

      const priceB2C = normalizePrice(variant.price);
      const priceB2B = roundMoney(priceB2C * B2B_FACTOR);

      return {
        id: typeof variant.id === "number" ? variant.id : null,
        title: variant.title || "",
        priceB2C,
        priceB2B,
        bagSizeGrams,
      } satisfies ProductVariantInfo;
    })
    .filter(Boolean) as ProductVariantInfo[];
}

function pickPreferredProfessionalVariant(
  variants: ProductVariantInfo[]
): ProductVariantInfo | null {
  if (!variants.length) return null;

  const preferredOrder = [1000, 500, 250];
  for (const grams of preferredOrder) {
    const match = variants.find((variant) => variant.bagSizeGrams === grams);
    if (match) return match;
  }

  return variants[0] ?? null;
}

function parseBagSizeGrams(title: string): number {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();

  const kgMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgMatch) {
    const kilos = Number(kgMatch[1].replace(",", "."));
    return Number.isFinite(kilos) ? Math.round(kilos * 1000) : 0;
  }

  const gramMatch = normalized.match(/(\d+)\s*g\b/);
  if (gramMatch) {
    const grams = Number(gramMatch[1]);
    return Number.isFinite(grams) ? grams : 0;
  }

  return 0;
}

function normalizePrice(price: number | string | undefined): number {
  if (typeof price === "number") {
    return price > 999 ? roundMoney(price / 100) : roundMoney(price);
  }

  if (typeof price === "string") {
    const numeric = Number(price.replace(",", "."));
    return Number.isFinite(numeric)
      ? numeric > 999
        ? roundMoney(numeric / 100)
        : roundMoney(numeric)
      : 0;
  }

  return 0;
}

function extractExplicitGramsPerCup(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*g(?:r)?\s*(?:por taza|\/taza|cada taza)/i);
  if (!match) return null;

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function inferGramsPerCupFromContext(text: string): number | null {
  if (text.includes("geisha")) return 9;
  if (text.includes("pacamara")) return 8.5;
  if (text.includes("catuai")) return 8;
  return null;
}

function extractTotalCoffeesFromText(message: string): number | null {
  const matches = message.match(/(\d+)\s*(?:caf(?:e|é)s?|tazas?)/gi);

  if (!matches) return null;

  let total = 0;

  for (const m of matches) {
    const num = Number(m.replace(/[^\d]/g, ""));
    if (Number.isFinite(num)) total += num;
  }

  return total > 0 ? total : null;
}

function extractDeclaredTotalCoffeesPerDay(text: string): number | null {
  const patterns = [
    /sirvo\s+(\d+)\s+(?:tazas?|caf(?:e|é)s?)/i,
    /(\d+)\s+(?:tazas?|caf(?:e|é)s?)\s+(?:de café\s+)?diari[oa]s?/i,
    /(\d+)\s+(?:tazas?|caf(?:e|é)s?)\s+al\s+d[ií]a/i,
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

function extractMomentCoffeeCount(text: string, keywords: string[]): number {
  for (const keyword of keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
      new RegExp(`${escaped}[^\\d]{0,24}(\\d+)\\s*(?:caf(?:e|é)s?|tazas?)`, "i"),
      new RegExp(`(\\d+)\\s*(?:caf(?:e|é)s?|tazas?)[^\\.\\n]{0,36}${escaped}`, "i"),
      new RegExp(`${escaped}[^\\d]{0,24}unos\\s*(\\d+)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) return value;
      }
    }
  }

  return 0;
}

function extractDailyCoffeeCount(message: string): number | null {
  const match = message.match(/(\d+)\s*caf(?:e|é)s?\s+al\s+d(?:i|í)a/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractWeekdayDailyCoffeeCount(message: string): number | null {
  const patterns = [
    /(\d+)\s*caf(?:e|é)s?\s+al\s+d(?:i|í)a\s+durante\s+la\s+semana/,
    /(\d+)\s*caf(?:e|é)s?\s+diarios?\s+entre\s+semana/,
    /(\d+)\s*caf(?:e|é)s?\s+por\s+d(?:i|í)a\s+entre\s+semana/,
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
  if (message.includes("otro a media manana") || message.includes("otro a media mañana")) return 3;
  if (message.includes("uno pronto por la manana") || message.includes("uno pronto por la mañana")) return 3;

  const patterns = [
    /fin(?:es)?\s+de\s+semana.*?(\d+)\s*caf(?:e|é)s?/,
    /(\d+)\s*caf(?:e|é)s?.*?fin(?:es)?\s+de\s+semana/,
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

function extractNumberBefore(text: string, phrase: string): number | null {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(\\d+)\\s+${escaped}`, "i");
  const match = text.match(regex);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function formatKg(value: number): string {
  return `${roundToOneDecimal(value).toFixed(1)} kg`;
}

function formatBagSize(value: number): string {
  if (value >= 1000 && value % 1000 === 0) {
    return `${value / 1000} kg`;
  }

  return `${value} g`;
}

function formatEuro(value: number): string {
  return `${roundMoney(value).toFixed(2)} €`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}