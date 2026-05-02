type CoffeeHandle = "catuai" | "pacamara" | "geisha";
type PricingMode = "simple" | "complete";

type ProductVariantInfo = {
  id: number | null;
  title: string;
  priceB2C: number;
  priceB2B: number;
  bagSizeGrams: number;
};

type ProductPricingInfo = {
  handle: CoffeeHandle;
  name: string;
  variants: ProductVariantInfo[];
  recommendedGramsPerCup: number;
};

type ProfessionalMixLineLike = {
  handle: CoffeeHandle;
  name: string;
  percentage: number;
  targetKg: number;
  roundedTargetGrams?: number;
  totalB2B?: number;
  totalB2C?: number;
  formatBreakdown?: Array<{
    variantId?: number | string | null;
    bagSizeGrams: number;
    quantity: number;
    priceB2B?: number;
    priceB2C?: number;
  }>;
};

type ProfessionalEngineResultLike = {
  meta?: {
    coffeesPerDay?: number;
    days?: number;
    totalKg?: number;
  };
  mix?: {
    lines?: ProfessionalMixLineLike[];
  };
};

type SalesVolumeContext = {
  cupsPerDay: number | null;
  cupsPerWeek: number | null;
  cupsPerMonth: number | null;
  normalizedMonthlyCups: number | null;
};

type ShopifyProductJson = {
  title?: string;
  handle?: string;
  variants?: Array<{
    id?: number;
    title?: string;
    price?: number | string;
  }>;
};

const SHOPIFY_BASE_URL = "https://arte-coffee.com";
const B2B_DISCOUNT_FACTOR = 0.8;

const coffeeBusinessRules: Record<
  CoffeeHandle,
  {
    name: string;
    recommendedGramsPerCup: number;
    suggestedCupPriceMultiplier: number;
    minimumSuggestedCupPrice: number;
    role: string;
  }
> = {
  catuai: {
    name: "Catuai",
    recommendedGramsPerCup: 8,
    suggestedCupPriceMultiplier: 1.15,
    minimumSuggestedCupPrice: 2.3,
    role: "base diaria / volumen",
  },
  pacamara: {
    name: "Pacamara",
    recommendedGramsPerCup: 8,
    suggestedCupPriceMultiplier: 1.30,
    minimumSuggestedCupPrice: 2.6,
    role: "sobremesa / valor gastronómico",
  },
  geisha: {
    name: "Geisha",
    recommendedGramsPerCup: 8,
    suggestedCupPriceMultiplier: 1.45,
    minimumSuggestedCupPrice: 2.9,
    role: "premium / diferenciación",
  },
};

export async function buildCupEconomicsReply(params: {
  message: string;
}): Promise<string | null> {
  const { message } = params;

  if (!isCupEconomicsIntent(message)) return null;

  const text = message.toLowerCase();

  const isProfessional =
    text.includes("restaurante") ||
    text.includes("cafetería") ||
    text.includes("bar") ||
    text.includes("local") ||
    text.includes("horeca") ||
    text.includes("carta");

  const handles = extractCoffeeHandlesFromMessage(message);
  const targetHandles =
    handles.length > 0 ? handles : ["catuai", "pacamara", "geisha"];

  const products = await Promise.all(
    targetHandles.map((handle) => getProductPricing(handle))
  );

  const lines: string[] = [];

  // 🔵 B2C
  if (!isProfessional) {
    lines.push("Coste por taza (8 g por dosis):");
    lines.push("");

    for (const product of products) {
      const v = pickPreferredVariant(product.handle, product.variants);
      if (!v) continue;

      const cost = roundMoney((v.priceB2C / v.bagSizeGrams) * 8);

      lines.push(`${product.name}: ${formatEuro(cost)}`);
    }

    return lines.join("\n");
  }

  // 🔴 B2B
  const avg = extractAverageCupPrice(message) ?? 2.3;

  const targetPrices = {
    catuai: 2.3,
    pacamara: 2.6,
    geisha: 2.9,
  };

  lines.push("Análisis profesional (8 g por taza):");
  lines.push("");

  for (const product of products) {
    const v = pickPreferredVariant(product.handle, product.variants);
    if (!v) continue;

    const cost = roundMoney((v.priceB2B / v.bagSizeGrams) * 8);
    const suggested = targetPrices[product.handle];

    lines.push(`${product.name}:`);
    lines.push(`- coste: ${formatEuro(cost)}`);
    lines.push(`- precio recomendado: ${formatEuro(suggested)}`);
    lines.push(`- margen: ${formatEuro(suggested - cost)}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function isCupEconomicsIntent(message: string): boolean {
  const text = message.toLowerCase();

  return (
    text.includes("margen por taza") ||
    text.includes("coste por taza") ||
    text.includes("costo por taza") ||
    text.includes("cuánto cuesta la taza") ||
    text.includes("cuanto cuesta la taza") ||
    text.includes("cuánto me costaría cada taza") ||
    text.includes("cuanto me costaria cada taza") ||
    text.includes("costaría cada taza") ||
    text.includes("costaria cada taza") ||
    text.includes("precio por taza") ||
    text.includes("precio recomendado") ||
    text.includes("precio sugerido") ||
    text.includes("a qué precio") ||
    text.includes("a que precio") ||
    text.includes("a qué precio me sugieres") ||
    text.includes("a que precio me sugieres") ||
    text.includes("a qué precio lo vendo") ||
    text.includes("a que precio lo vendo") ||
    text.includes("a qué precio venderlo") ||
    text.includes("a que precio venderlo") ||
    text.includes("precio de venta") ||
    text.includes("rentabilidad") ||
    text.includes("beneficio por taza") ||
    text.includes("margen de cada variedad") ||
    text.includes("coste de cada variedad") ||
    text.includes("costo de cada variedad") ||
    text.includes("cada variedad") ||
    text.includes("cada taza de cada variedad")
  );
}

export function isCompleteEconomicsIntent(message: string): boolean {
  const text = message.toLowerCase();

  return (
    text.includes("margen") ||
    text.includes("precio recomendado") ||
    text.includes("precio sugerido") ||
    text.includes("rentabilidad") ||
    text.includes("a qué precio") ||
    text.includes("a que precio") ||
    text.includes("precio de venta")
  );
}

export function extractAverageCupPrice(message: string): number | null {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();

  const patterns = [
    /precio medio de venta por taza(?: es| de)?\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
    /precio medio actual(?: es| de)?\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
    /mi precio medio de venta(?: por taza)?(?: es| de)?\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
    /actualmente mi precio medio de venta por taza es de\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
    /precio medio por taza es de\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
    /mi café comercial de media(?: es)?\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
    /vendo(?: de media)? .*? a\s*(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const value = Number(match[1].replace(",", "."));
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

export function extractSalesVolumeContext(message: string): SalesVolumeContext {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();

  const perDayPatterns = [
    /(\d+)\s*caf(?:e|é)s?\s*(?:al|por)?\s*d[ií]a/,
    /(\d+)\s*tazas?\s*(?:al|por)?\s*d[ií]a/,
    /vendo\s*(\d+)\s*caf(?:e|é)s?\s*(?:al|por)?\s*d[ií]a/,
    /sirvo\s*(\d+)\s*caf(?:e|é)s?\s*(?:al|por)?\s*d[ií]a/,
    /sirvo\s*(\d+)\s*tazas?\s*(?:al|por)?\s*d[ií]a/,
    /vendo\s*(\d+)\s*caf(?:e|é)s?\s*diarios?/,
    /sirvo\s*(\d+)\s*caf(?:e|é)s?\s*diarios?/,
    /(\d+)\s*caf(?:e|é)s?\s*diarios?/,
  ];

  const perWeekPatterns = [
    /(\d+)\s*caf(?:e|é)s?\s*(?:a la|por)?\s*semana/,
    /(\d+)\s*tazas?\s*(?:a la|por)?\s*semana/,
    /vendo\s*(\d+)\s*caf(?:e|é)s?\s*(?:a la|por)?\s*semana/,
    /sirvo\s*(\d+)\s*caf(?:e|é)s?\s*(?:a la|por)?\s*semana/,
  ];

  const perMonthPatterns = [
    /(\d+)\s*caf(?:e|é)s?\s*(?:al|por)?\s*mes/,
    /(\d+)\s*tazas?\s*(?:al|por)?\s*mes/,
    /vendo\s*(\d+)\s*caf(?:e|é)s?\s*(?:al|por)?\s*mes/,
    /sirvo\s*(\d+)\s*caf(?:e|é)s?\s*(?:al|por)?\s*mes/,
  ];

  const weekdayPatterns = [
    /(\d+)\s*caf(?:e|é)s?\s*(?:de lunes a viernes|entre semana)/,
    /(\d+)\s*tazas?\s*(?:de lunes a viernes|entre semana)/,
  ];

  const cupsPerDay = matchFirstNumber(text, perDayPatterns);
  const cupsPerWeek = matchFirstNumber(text, perWeekPatterns);
  const cupsPerMonth = matchFirstNumber(text, perMonthPatterns);
  const weekdayDaily = matchFirstNumber(text, weekdayPatterns);

  let normalizedMonthlyCups: number | null = null;

  if (cupsPerMonth !== null) {
    normalizedMonthlyCups = cupsPerMonth;
  } else if (cupsPerWeek !== null) {
    normalizedMonthlyCups = Math.round(cupsPerWeek * 4.33);
  } else if (weekdayDaily !== null) {
    normalizedMonthlyCups = weekdayDaily * 22;
  } else if (cupsPerDay !== null) {
    normalizedMonthlyCups = cupsPerDay * 30;
  }

  return {
    cupsPerDay,
    cupsPerWeek,
    cupsPerMonth,
    normalizedMonthlyCups,
  };
}

async function getProductPricing(handle: CoffeeHandle): Promise<ProductPricingInfo> {
  const response = await fetch(`${SHOPIFY_BASE_URL}/products/${handle}.js`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error(`Shopify pricing fetch failed for ${handle}: ${response.status}`);
    return {
      handle,
      name: coffeeBusinessRules[handle].name,
      variants: [],
      recommendedGramsPerCup: coffeeBusinessRules[handle].recommendedGramsPerCup,
    };
  }

  const data = (await response.json()) as ShopifyProductJson;

  const variants = (data.variants || [])
    .map((variant) => {
      const bagSizeGrams = parseBagSizeGrams(variant.title || "");
      if (!bagSizeGrams) return null;

      const priceB2C = normalizePrice(variant.price);
      const priceB2B = roundMoney(priceB2C * B2B_DISCOUNT_FACTOR);

      return {
        id: typeof variant.id === "number" ? variant.id : null,
        title: variant.title || "",
        priceB2C,
        priceB2B,
        bagSizeGrams,
      } satisfies ProductVariantInfo;
    })
    .filter(Boolean)
    .sort((a, b) => b.bagSizeGrams - a.bagSizeGrams) as ProductVariantInfo[];

  return {
    handle,
    name: coffeeBusinessRules[handle].name,
    variants,
    recommendedGramsPerCup: coffeeBusinessRules[handle].recommendedGramsPerCup,
  };
}

export async function buildProductPriceReply(message: string): Promise<{
  reply: string;
  handles: CoffeeHandle[];
} | null> {
  const source = message.toLowerCase();

  const isPriceIntent =
    source.includes("precio") ||
    source.includes("cuánto vale") ||
    source.includes("cuanto vale") ||
    source.includes("cuánto cuesta") ||
    source.includes("cuanto cuesta") ||
    source.includes("coste");

  if (!isPriceIntent) return null;

  const handles: CoffeeHandle[] = [];

  if (source.includes("catuai")) handles.push("catuai");
  if (source.includes("pacamara")) handles.push("pacamara");
  if (source.includes("geisha")) handles.push("geisha");

  const targetHandles = handles.length ? handles : ["catuai", "pacamara", "geisha"];

  const products = await Promise.all(
    targetHandles.map((handle) => getProductPricing(handle))
  );

  const lines: string[] = [];

  lines.push("Estos son los precios actuales en Arte Coffee:");
  lines.push("");

  for (const product of products) {
    lines.push(`${product.name}:`);

    if (!product.variants.length) {
      lines.push("- Precio no disponible ahora mismo.");
      lines.push("");
      continue;
    }

    product.variants
      .sort((a, b) => a.bagSizeGrams - b.bagSizeGrams)
      .forEach((variant) => {
        lines.push(
          `- ${formatBagSize(variant.bagSizeGrams)}: ${formatEuro(variant.priceB2C)}`
        );
      });

    lines.push("");
  }

  lines.push(
    "Si me dices cuántos cafés tomas al día, te recomiendo el formato o pack más eficiente para tu consumo."
  );

  return {
    reply: lines.join("\n").trim(),
    handles: targetHandles,
  };
}

function parseBagSizeGrams(title: string): number {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();

  const kgMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*kg\.?\b/);
  if (kgMatch) {
    const kilos = Number(kgMatch[1].replace(",", "."));
    return Number.isFinite(kilos) ? Math.round(kilos * 1000) : 0;
  }

  const gramMatch = normalized.match(/(\d+)\s*g(?:r)?\.?\b/);
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

function pickPreferredVariant(
  handle: CoffeeHandle,
  variants: ProductVariantInfo[]
): ProductVariantInfo | null {
  if (!variants.length) return null;

  const preferredOrder =
    handle === "catuai"
      ? [1000, 500, 250]
      : handle === "pacamara"
      ? [500, 250]
      : [250];

  for (const grams of preferredOrder) {
    const match = variants.find((variant) => variant.bagSizeGrams === grams);
    if (match) return match;
  }

  return variants[0] ?? null;
}

function buildSuggestedCupPrice(params: {
  handle: CoffeeHandle;
  averageCupPrice?: number | null;
}): number {
  const { handle, averageCupPrice } = params;

  const floorByCoffee: Record<CoffeeHandle, number> = {
    catuai: 2.3,
    pacamara: 2.6,
    geisha: 2.9,
  };

  const target = floorByCoffee[handle];

  if (typeof averageCupPrice === "number" && averageCupPrice > 0) {
    if (handle === "catuai") return Math.max(target, roundToTenCents(averageCupPrice));
    if (handle === "pacamara") return Math.max(target, roundToTenCents(averageCupPrice + 0.4));
    return Math.max(target, roundToTenCents(averageCupPrice + 0.7));
  }

  return target;
}

function extractCoffeeHandlesFromMessage(message: string): CoffeeHandle[] {
  const text = message.toLowerCase();
  const handles: CoffeeHandle[] = [];

  if (text.includes("catuai")) handles.push("catuai");
  if (text.includes("pacamara")) handles.push("pacamara");
  if (text.includes("geisha")) handles.push("geisha");

  return Array.from(new Set(handles));
}

function detectPricingAudience(message: string): "consumer" | "professional" {
  const text = message.toLowerCase();

  const looksProfessional =
    text.includes("restaurante") ||
    text.includes("cafetería") ||
    text.includes("cafeteria") ||
    text.includes("bar") ||
    text.includes("local") ||
    text.includes("carta") ||
    text.includes("vendo") ||
    text.includes("sirvo") ||
    text.includes("ticket medio") ||
    text.includes("rotación") ||
    text.includes("rotacion") ||
    text.includes("horeca") ||
    text.includes("sobremesa");

  return looksProfessional ? "professional" : "consumer";
}

function matchFirstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
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

function roundToTenCents(value: number): number {
  return Math.ceil(value * 10) / 10;
}

export function buildProfessionalEconomicsReply(
  engineResult: ProfessionalEngineResultLike
): string {
  const mix = engineResult?.mix;
  const meta = engineResult?.meta;

  if (!mix || !mix.lines?.length) {
    return "Para poder estimar coste y margen necesito primero definir el volumen y las variedades.";
  }

  const averageCupPrice = extractAverageCupPriceFromEngineContext(engineResult);
  const totalCupsPeriod = (meta?.coffeesPerDay ?? 0) * (meta?.days ?? 0);

  const lines: string[] = [
    averageCupPrice !== null
      ? `Tomando como referencia tu precio medio actual de ${formatEuro(
          averageCupPrice
        )} por taza, esta sería la orientación por variedad:`
      : "Análisis económico por variedad:",
    "",
  ];

  for (const line of mix.lines) {
    const gramsPerCup = inferGramsPerCup(line.handle);
    const costPerCup = computeCostPerCupFromMixLine(line, gramsPerCup);

    const suggestedPrice = buildSuggestedCupPrice({
      handle: line.handle,
      averageCupPrice,
    });

    const marginPerCup = roundMoney(suggestedPrice - costPerCup);

    let monthlyMargin: number | null = null;
    if (totalCupsPeriod > 0 && typeof line.percentage === "number") {
      const cupsForThisVariety = totalCupsPeriod * line.percentage;
      monthlyMargin = roundMoney(cupsForThisVariety * marginPerCup);
    }

    lines.push(`${line.name}:`);
    lines.push(`- coste por taza: ${formatEuro(costPerCup)}`);
    lines.push(`- precio sugerido: ${formatEuro(suggestedPrice)}`);
    lines.push(`- margen por taza: ${formatEuro(marginPerCup)}`);
    if (monthlyMargin !== null) {
      lines.push(`- margen estimado del periodo: ${formatEuro(monthlyMargin)}`);
    }
    lines.push(`- rol en carta: ${describeRole(line.handle)}`);
    lines.push("");
  }

  lines.push(
    "Conclusión:",
    "Usaría Catuai como base de volumen, Pacamara para elevar la sobremesa y Geisha como taza de mayor valor percibido."
  );

  return lines.join("\n").trim();
}

export async function buildProfessionalPricingStrategyReply(params: {
  currentPricePerCup: number;
  coffees: ProfessionalMixLineLike[];
  message?: string;
  context?: {
    coffeesPerDay?: number | null;
    days?: number | null;
  } | null;
}): Promise<string> {
  const { currentPricePerCup, coffees, message, context } = params;

  const uniqueHandles = Array.from(
    new Set(
      (coffees.length
        ? coffees
        : [
            { handle: "catuai" as CoffeeHandle, percentage: 0.42, targetKg: 20.2, name: "Catuai" },
            { handle: "pacamara" as CoffeeHandle, percentage: 0.33, targetKg: 15.8, name: "Pacamara" },
            { handle: "geisha" as CoffeeHandle, percentage: 0.25, targetKg: 12.1, name: "Geisha" },
          ]).map((coffee) => coffee.handle)
    )
  ) as CoffeeHandle[];

  const products = await Promise.all(
    uniqueHandles.map((handle) => getProductPricing(handle))
  );

  const parsedVolume = extractSalesVolumeContext(message ?? "");

  const effectiveCoffeesPerDay =
    typeof context?.coffeesPerDay === "number" && context.coffeesPerDay > 0
      ? context.coffeesPerDay
      : parsedVolume.cupsPerDay;

  const effectiveDays =
    typeof context?.days === "number" && context.days > 0
      ? context.days
      : 30;

  let totalCupsPeriod: number | null = null;

  if (
    typeof effectiveCoffeesPerDay === "number" &&
    effectiveCoffeesPerDay > 0 &&
    Number.isFinite(effectiveDays)
  ) {
    totalCupsPeriod = effectiveCoffeesPerDay * effectiveDays;
  } else if (parsedVolume.normalizedMonthlyCups !== null) {
    totalCupsPeriod = parsedVolume.normalizedMonthlyCups;
  }

  const lines: string[] = [];

  lines.push(
    `Con tu precio actual de ${formatEuro(
      currentPricePerCup
    )} por taza, tienes margen para mejorar rentabilidad sin afectar la rotación.`
  );

  if (
    typeof effectiveCoffeesPerDay === "number" &&
    effectiveCoffeesPerDay > 0 &&
    totalCupsPeriod !== null
  ) {
    lines.push(
      `He tomado como referencia un volumen de ${effectiveCoffeesPerDay} cafés al día durante ${effectiveDays} días (${totalCupsPeriod} cafés en el periodo).`
    );
  } else if (parsedVolume.normalizedMonthlyCups !== null) {
    lines.push(
      `He tomado como referencia un volumen aproximado de ${parsedVolume.normalizedMonthlyCups} cafés al mes.`
    );
  } else {
    lines.push(
      "Como no has indicado un volumen exacto, tomo una referencia estándar de 900 cafés al mes."
    );
    totalCupsPeriod = 900;
  }

  lines.push("");
  lines.push("Propuesta por variedad:");
  lines.push("");

  for (const product of products) {
    const preferredVariant = pickPreferredVariant(product.handle, product.variants);
    if (!preferredVariant) continue;

    const gramsPerCup = inferGramsPerCup(product.handle);
    const costPerCup = roundMoney(
      (preferredVariant.priceB2B / preferredVariant.bagSizeGrams) * gramsPerCup
    );

    const suggestedPrice = buildSuggestedCupPrice({
      handle: product.handle,
      averageCupPrice: currentPricePerCup,
    });

    const improvementPerCup = roundMoney(suggestedPrice - (currentPricePerCup ?? 0));

    const mixLine = coffees.find((coffee) => coffee.handle === product.handle);
    const percentage =
      typeof mixLine?.percentage === "number" ? mixLine.percentage : null;

    let upsideMonthly: number | null = null;

    if (
      totalCupsPeriod !== null &&
      percentage !== null &&
      Number.isFinite(totalCupsPeriod) &&
      Number.isFinite(percentage)
    ) {
      const cupsForThisVariety = totalCupsPeriod * percentage;
      upsideMonthly = roundMoney(cupsForThisVariety * improvementPerCup);
    }

    lines.push(`${product.name}:`);
    lines.push(`- coste por taza: ${formatEuro(costPerCup)}`);
    lines.push(`- precio actual: ${formatEuro(currentPricePerCup)}`);
    lines.push(`- precio recomendado: ${formatEuro(suggestedPrice)}`);
    lines.push(`- mejora por taza: ${formatEuro(improvementPerCup)}`);
    if (upsideMonthly !== null) {
      lines.push(`- impacto mensual estimado: ${formatEuro(upsideMonthly)}`);
    }
    lines.push(`- rol en carta: ${describeRole(product.handle)}`);
    lines.push(`- argumento: ${buildSalesArgument(product.handle)}`);
    lines.push("");
  }

  lines.push(
    "Conclusión:",
    "El café de especialidad no solo mejora la percepción del cliente: bien estructurado te permite aumentar ingreso por taza, elevar margen y defender mejor el ticket medio.",
    "Estrategia recomendada: Catuai como base de rotación, Pacamara para sobremesa y Geisha como propuesta premium."
  );

  return lines.join("\n").trim();
}

function computeCostPerCupFromMixLine(
  line: ProfessionalMixLineLike,
  gramsPerCup: number
): number {
  const costPerGram = computeWeightedB2BCostPerGram(line);
  return roundMoney(costPerGram * gramsPerCup);
}

function computeWeightedB2BCostPerGram(coffee: {
  roundedTargetGrams?: number;
  totalB2B?: number;
  formatBreakdown?: Array<{
    bagSizeGrams: number;
    quantity: number;
    priceB2B?: number;
    priceB2C?: number;
  }>;
}): number {
  const breakdown = coffee.formatBreakdown ?? [];

  if (breakdown.length > 0) {
    const totalCostB2B = breakdown.reduce((sum, item) => {
      const itemPriceB2B =
        typeof item.priceB2B === "number"
          ? item.priceB2B
          : typeof item.priceB2C === "number"
          ? item.priceB2C * B2B_DISCOUNT_FACTOR
          : 0;

      return sum + itemPriceB2B * item.quantity;
    }, 0);

    const totalGrams = breakdown.reduce((sum, item) => {
      return sum + item.bagSizeGrams * item.quantity;
    }, 0);

    return totalGrams > 0 ? totalCostB2B / totalGrams : 0;
  }

  const fallbackGrams =
    typeof coffee.roundedTargetGrams === "number" ? coffee.roundedTargetGrams : 0;

  return fallbackGrams > 0 && typeof coffee.totalB2B === "number"
    ? coffee.totalB2B / fallbackGrams
    : 0;
}

function inferGramsPerCup(handle: CoffeeHandle): number {
  return coffeeBusinessRules[handle].recommendedGramsPerCup;
}

function describeRole(handle: CoffeeHandle): string {
  return coffeeBusinessRules[handle].role;
}

function buildSalesArgument(handle: CoffeeHandle): string {
  if (handle === "catuai") {
    return "base house de rotación, equilibrado, rentable y fácil de defender en volumen";
  }

  if (handle === "pacamara") {
    return "ideal para sobremesa y momentos gastronómicos, con más valor percibido y mejor ticket medio";
  }

  return "referencia premium para diferenciar la carta y justificar un precio superior por experiencia";
}

function extractAverageCupPriceFromEngineContext(
  _engineResult: ProfessionalEngineResultLike
): number | null {
  return null;
}
