import { buildCupEconomicsReply, isCupEconomicsIntent } from "./barista-pricing.service";

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
};

export type DecisionEngineResult =
  | {
      type: "professional_volume";
      reply: string;
      meta: ProfessionalVolumeResult;
    }
  | {
      type: "cup_economics";
      reply: string;
    }
  | {
      type: "monthly_quantity";
      reply: string;
    }
  | null;

export async function runBaristaDecisionEngine(params: {
  message: string;
}): Promise<DecisionEngineResult> {
  const { message } = params;
  const intent = detectDecisionIntent(message);

  if (intent === "cup_economics") {
    const reply = await buildCupEconomicsReply({ message });
    if (!reply) return null;

    return {
      type: "cup_economics",
      reply,
    };
  }

  if (intent === "professional_volume") {
    const parsed = parseProfessionalVolumeQuery(message);
    if (!parsed) return null;

    const calculated = calculateProfessionalCoffeeVolume(parsed);

    return {
      type: "professional_volume",
      reply: buildProfessionalVolumeReply(calculated),
      meta: calculated,
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
  if (isCupEconomicsIntent(text)) return "cup_economics";
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
      text.includes("sirvo")) &&
    (
      text.includes("cafes al dia") ||
      text.includes("cafés al día") ||
      text.includes("cada 15 dias") ||
      text.includes("cada 15 días") ||
      text.includes("cuanto cafe tendria que comprar") ||
      text.includes("cuánto café tendría que comprar") ||
      text.includes("cuanto cafe comprar") ||
      text.includes("volumen de cafe") ||
      text.includes("volumen de café")
    )
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
} | null {
  const text = normalize(message);

  const coffeesPerDay =
    extractNumberBefore(text, "cafes") ??
    extractNumberBefore(text, "cafés") ??
    extractNumberBefore(text, "cafes diarios") ??
    extractNumberBefore(text, "cafes al dia") ??
    extractNumberBefore(text, "cafés al día");

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
    extractExplicitGramsPerCup(text) ??
    inferGramsPerCupFromContext(text) ??
    8;

  return {
    coffeesPerDay,
    days,
    gramsPerCup,
  };
}

export function calculateProfessionalCoffeeVolume(input: {
  coffeesPerDay: number;
  days: number;
  gramsPerCup: number;
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
  };
}

export function buildProfessionalVolumeReply(result: ProfessionalVolumeResult): string {
  const periodLabel = result.days === 15 ? "cada 15 días" : result.days === 7 ? "por semana" : "al mes";

  return [
    `Necesitarías aproximadamente ${formatKg(result.totalKg)} de café ${periodLabel}.`,
    ``,
    `Compra recomendada:`,
    `- ${result.recommended1kgBags} bolsas de 1 kg en formato profesional`,
    ``,
    `Tomas como referencia ${result.gramsPerCup} g por taza y ${result.coffeesPerDay} cafés al día.`,
  ].join("\n");
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
  return `${(Math.round(value * 10) / 10).toFixed(1)} kg`;
}
