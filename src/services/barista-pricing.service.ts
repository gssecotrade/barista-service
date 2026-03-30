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
    suggestedCupPriceMultiplier: 8.5,
    minimumSuggestedCupPrice: 2.2,
    role: "base diaria / volumen",
  },
  pacamara: {
    name: "Pacamara",
    recommendedGramsPerCup: 8.5,
    suggestedCupPriceMultiplier: 9.5,
    minimumSuggestedCupPrice: 2.8,
    role: "sobremesa / valor gastronómico",
  },
  geisha: {
    name: "Geisha",
    recommendedGramsPerCup: 9,
    suggestedCupPriceMultiplier: 11,
    minimumSuggestedCupPrice: 3.8,
    role: "premium / diferenciación",
  },
};

export async function buildCupEconomicsReply(params: {
  message: string;
}): Promise<string | null> {
  const { message } = params;

  if (!isCupEconomicsIntent(message)) return null;

  const mode: PricingMode = isCompleteEconomicsIntent(message)
    ? "complete"
    : "simple";

  const averageCupPrice = extractAverageCupPrice(message);
  const handles = extractCoffeeHandlesFromMessage(message);
  const targetHandles: CoffeeHandle[] =
    handles.length > 0 ? handles : ["catuai", "pacamara", "geisha"];

  const products = await Promise.all(
    targetHandles.map((handle) => getProductPricing(handle))
  );

  const lines: string[] = [];

  if (averageCupPrice !== null) {
    lines.push(
      `Tomando como referencia tu precio medio actual de ${formatEuro(
        averageCupPrice
      )} por taza, esta sería la orientación por variedad:`,
      ""
    );
  } else {
    lines.push(
      "No trataría igual las tres referencias: mantendría Catuai como base de rotación, subiría Pacamara como taza más gastronómica y reservaría Geisha como propuesta claramente premium.",
      "",
      "Orientación por variedad:",
      ""
    );
  }

  for (const product of products) {
    const preferredVariant = pickPreferredVariant(product.handle, product.variants);
    if (!preferredVariant) continue;

    const costPerGramB2B =
      preferredVariant.priceB2B / preferredVariant.bagSizeGrams;
    const costPerCup = roundMoney(
      costPerGramB2B * product.recommendedGramsPerCup
    );

    lines.push(`${product.name}:`);
    lines.push(
      `- formato de referencia: ${formatBagSize(preferredVariant.bagSizeGrams)}`
    );
    lines.push(
      `- gramos recomendados por taza: ${product.recommendedGramsPerCup} g`
    );
    lines.push(`- coste real por taza: ${formatEuro(costPerCup)}`);

    if (mode === "complete") {
      const suggestedCupPrice = buildSuggestedCupPrice({
        handle: product.handle,
        costPerCup,
        averageCupPrice,
      });

      const marginPerCup = roundMoney(suggestedCupPrice - costPerCup);

      lines.push(`- precio sugerido por taza: ${formatEuro(suggestedCupPrice)}`);
      lines.push(`- margen por taza: ${formatEuro(marginPerCup)}`);
      lines.push(`- rol en carta: ${coffeeBusinessRules[product.handle].role}`);
    }

    lines.push("");
  }

  if (mode === "simple") {
    lines.push(
      "Si quieres, te doy también una propuesta completa con precio sugerido y margen por taza para cada variedad."
    );
  }

  return lines.join("\n").trim();
}

export function isCupEconomicsIntent(message: string): boolean {
  const text = message.toLowerCase();

  return (
    text.includes("margen por taza") ||
    text.includes("coste por taza") ||
    text.includes("costo por taza") ||
    text.includes("precio por taza") ||
    text.includes("precio recomendado") ||
    text.includes("precio sugerido") ||
    text.includes("rentabilidad") ||
    text.includes("gramos por taza") ||
    text.includes("precio medio") ||
    text.includes("coste de cada variedad") ||
    text.includes("costo de cada variedad") ||
    text.includes("margen de cada variedad") ||
    text.includes("precio de venta") ||
    text.includes("a qué precio vender") ||
    text.includes("a que precio vender") ||
    text.includes("beneficio por taza")
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
  costPerCup: number;
  averageCupPrice: number | null;
}): number {
  const { handle, costPerCup, averageCupPrice } = params;

  const rule = coffeeBusinessRules[handle];
  const baseSuggested = roundToTenCents(
    Math.max(
      costPerCup * rule.suggestedCupPriceMultiplier,
      rule.minimumSuggestedCupPrice
    )
  );

  if (averageCupPrice === null) {
    return baseSuggested;
  }

  if (handle === "geisha") {
    return Math.max(baseSuggested, roundToTenCents(averageCupPrice + 1.2));
  }

  if (handle === "pacamara") {
    return Math.max(baseSuggested, roundToTenCents(averageCupPrice + 0.5));
  }

  return Math.max(baseSuggested, roundToTenCents(averageCupPrice));
}

function extractCoffeeHandlesFromMessage(message: string): CoffeeHandle[] {
  const text = message.toLowerCase();
  const handles: CoffeeHandle[] = [];

  if (text.includes("catuai")) handles.push("catuai");
  if (text.includes("pacamara")) handles.push("pacamara");
  if (text.includes("geisha")) handles.push("geisha");

  return Array.from(new Set(handles));
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
    const costPerCup = computeLiveShopifyCostPerCup(line.handle);

    const suggestedPrice = buildSuggestedCupPrice({
      handle: line.handle,
      costPerCup,
      averageCupPrice,
    });

    const marginPerCup = roundMoney(suggestedPrice - costPerCup);

    let monthlyMargin: number | null = null;
    if (totalCupsPeriod > 0 && typeof line.percentage === "number") {
      const cupsForThisVariety = totalCupsPeriod * line.percentage;
      monthlyMargin = roundMoney(cupsForThisVariety * marginPerCup);
    }

    lines.push(`${line.name}:`);
    lines.push(`- gramos recomendados por taza: ${gramsPerCup} g`);
    lines.push(`- coste real por taza: ${formatEuro(costPerCup)}`);
    lines.push(`- precio sugerido por taza: ${formatEuro(suggestedPrice)}`);
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
  }): Promise<string> {
    const { currentPricePerCup, coffees } = params;
  
    console.log("USING buildProfessionalPricingStrategyReply", {
      currentPricePerCup,
      coffeesCount: coffees.length,
      coffees,
    });
  
    const uniqueHandles = Array.from(
      new Set(
        (coffees.length
          ? coffees
          : [
              { handle: "catuai" as CoffeeHandle, percentage: 0.42, targetKg: 20.2 },
              { handle: "pacamara" as CoffeeHandle, percentage: 0.33, targetKg: 15.8 },
              { handle: "geisha" as CoffeeHandle, percentage: 0.25, targetKg: 12.1 },
            ]).map((coffee) => coffee.handle)
      )
    ) as CoffeeHandle[];
  
    const products = await Promise.all(
      uniqueHandles.map((handle) => getProductPricing(handle))
    );
  
    const totalCupsPeriod = 30 * 30; // base neutra comercial: 30 cafés/día x 30 días
    const lines: string[] = [];
  
    lines.push(
      `Partiendo de tu precio medio actual de ${formatEuro(
        currentPricePerCup
      )} por taza, la oportunidad no está en vender más barato, sino en capturar más valor por taza sin penalizar la rotación.`,
      "",
      "Propuesta por variedad:",
      ""
    );
  
    for (const product of products) {
      const preferredVariant = pickPreferredVariant(product.handle, product.variants);
      if (!preferredVariant) continue;
  
      const gramsPerCup = inferGramsPerCup(product.handle);
      const costPerGram = preferredVariant.priceB2B / preferredVariant.bagSizeGrams;
      const costPerCup = roundMoney(costPerGram * gramsPerCup);
  
      let suggestedPrice = currentPricePerCup;
  
      if (product.handle === "catuai") {
        suggestedPrice = Math.max(currentPricePerCup + 0.2, 2.2);
      } else if (product.handle === "pacamara") {
        suggestedPrice = Math.max(currentPricePerCup + 0.5, 2.9);
      } else if (product.handle === "geisha") {
        suggestedPrice = Math.max(currentPricePerCup + 1.0, 3.8);
      }
  
      suggestedPrice = roundToTenCents(suggestedPrice);
  
      const currentMarginPerCup = roundMoney(currentPricePerCup - costPerCup);
      const recommendedMarginPerCup = roundMoney(suggestedPrice - costPerCup);
      const incrementalPerCup = roundMoney(suggestedPrice - currentPricePerCup);
  
      const mixLine = coffees.find((coffee) => coffee.handle === product.handle);
      const percentage = typeof mixLine?.percentage === "number" ? mixLine.percentage : null;
  
      let upsideMonthly: number | null = null;
      if (percentage !== null) {
        const cupsForThisVariety = totalCupsPeriod * percentage;
        upsideMonthly = roundMoney(cupsForThisVariety * incrementalPerCup);
      }
  
      lines.push(
        `${product.name}:`,
        `- formato de referencia: ${formatBagSize(preferredVariant.bagSizeGrams)}`,
        `- gramos recomendados por taza: ${gramsPerCup} g`,
        `- coste real por taza: ${formatEuro(costPerCup)}`,
        `- precio actual estimado: ${formatEuro(currentPricePerCup)}`,
        `- precio recomendado por taza: ${formatEuro(suggestedPrice)}`,
        `- margen actual por taza: ${formatEuro(currentMarginPerCup)}`,
        `- margen recomendado por taza: ${formatEuro(recommendedMarginPerCup)}`,
        `- mejora por taza: ${formatEuro(incrementalPerCup)}`,
        upsideMonthly !== null
          ? `- potencial mensual estimado: ${formatEuro(upsideMonthly)}`
          : null,
        `- rol en carta: ${describeRole(product.handle)}`,
        `- argumento de venta: ${buildSalesArgument(product.handle)}`,
        ""
      );
    }
  
    lines.push(
      "Conclusión:",
      "Hoy ya tienes margen, pero estás infra monetizando parte del valor que puede aportar una carta de café de especialidad bien estructurada.",
      "Con una arquitectura correcta puedes aumentar margen, elevar percepción de calidad y sostener mejor la fidelización del cliente."
    );
  
    return lines.filter(Boolean).join("\n").trim();
  }

function computeLiveShopifyCostPerCup(handle: CoffeeHandle): number {
  // Esta función no se usa en runtime directamente porque getProductPricing es async.
  // Se deja para compatibilidad estructural.
  return 0;
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
