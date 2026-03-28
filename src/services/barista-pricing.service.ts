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

const SHOPIFY_BASE_URL = "https://arte-coffee.com";
const B2B_DISCOUNT_FACTOR = 0.8; // 20% menos que B2C

const coffeeBusinessRules: Record<
  CoffeeHandle,
  {
    name: string;
    recommendedGramsPerCup: number;
    suggestedCupPriceMultiplier: number;
  }
> = {
  catuai: {
    name: "Catuai",
    recommendedGramsPerCup: 8,
    suggestedCupPriceMultiplier: 8.5,
  },
  pacamara: {
    name: "Pacamara",
    recommendedGramsPerCup: 8.5,
    suggestedCupPriceMultiplier: 9.5,
  },
  geisha: {
    name: "Geisha",
    recommendedGramsPerCup: 9,
    suggestedCupPriceMultiplier: 11,
  },
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

export async function buildCupEconomicsReply(params: {
  message: string;
}): Promise<string | null> {
  const { message } = params;

  if (!isCupEconomicsIntent(message)) return null;

  const mode: PricingMode = isCompleteEconomicsIntent(message)
    ? "complete"
    : "simple";

  const averageCupPrice = extractAverageCupPrice(message);

  const handles: CoffeeHandle[] = ["catuai", "pacamara", "geisha"];
  const products = await Promise.all(handles.map((handle) => getProductPricing(handle)));

  const lines: string[] = [];

  if (averageCupPrice !== null) {
    lines.push(
      `Tomando como referencia tu precio medio actual de ${formatEuro(
        averageCupPrice
      )} por taza, esta sería la orientación por variedad:`,
      ""
    );
  } else {
    lines.push("Orientación por variedad:", "");
  }

  for (const product of products) {
    const preferredVariant = pickPreferredVariant(product.variants);

    if (!preferredVariant) continue;

    const costPerGramB2B = preferredVariant.priceB2B / preferredVariant.bagSizeGrams;
    const costPerCup = costPerGramB2B * product.recommendedGramsPerCup;

    lines.push(`${product.name}:`);
    lines.push(`- formato de referencia: ${preferredVariant.bagSizeGrams} g`);
    lines.push(`- gramos recomendados por taza: ${product.recommendedGramsPerCup} g`);
    lines.push(`- coste real por taza: ${formatEuro(costPerCup)}`);

    if (mode === "complete") {
      const suggestedCupPrice = buildSuggestedCupPrice({
        handle: product.handle,
        costPerCup,
        averageCupPrice,
      });

      const marginPerCup = suggestedCupPrice - costPerCup;

      lines.push(`- precio sugerido por taza: ${formatEuro(suggestedCupPrice)}`);
      lines.push(`- margen por taza: ${formatEuro(marginPerCup)}`);
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
    text.includes("restaurante") ||
    text.includes("carta") ||
    text.includes("horeca")
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
    text.includes("a que precio")
  );
}

export function extractAverageCupPrice(message: string): number | null {
  const normalized = message.replace(",", ".");
  const match = normalized.match(
    /precio medio(?: actual)?(?: es| de)?(?: aproximadamente es| aproximadamente de)?\s*(\d+(?:\.\d+)?)\s*euros?/i
  );

  if (match) {
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  const fallback = normalized.match(/(\d+(?:\.\d+)?)\s*euros?/i);
  if (!fallback) return null;

  const value = Number(fallback[1]);
  return Number.isFinite(value) ? value : null;
}

async function getProductPricing(handle: CoffeeHandle): Promise<ProductPricingInfo> {
  const response = await fetch(`${SHOPIFY_BASE_URL}/products/${handle}.js`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudo leer el producto ${handle} desde Shopify`);
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
    .filter(Boolean) as ProductVariantInfo[];

  return {
    handle,
    name: coffeeBusinessRules[handle].name,
    variants,
    recommendedGramsPerCup: coffeeBusinessRules[handle].recommendedGramsPerCup,
  };
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
    // Shopify product.js suele devolver céntimos enteros
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

function pickPreferredVariant(variants: ProductVariantInfo[]): ProductVariantInfo | null {
  if (!variants.length) return null;

  const preferredOrder = [500, 250, 1000];
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

  const multiplier = coffeeBusinessRules[handle].suggestedCupPriceMultiplier;
  const baseSuggested = roundToTenCents(costPerCup * multiplier);

  if (averageCupPrice === null) {
    return baseSuggested;
  }

  const floorByPositioning =
    handle === "geisha"
      ? Math.max(baseSuggested, roundToTenCents(averageCupPrice + 1))
      : handle === "pacamara"
      ? Math.max(baseSuggested, roundToTenCents(averageCupPrice + 0.5))
      : Math.max(baseSuggested, roundToTenCents(averageCupPrice));

  return floorByPositioning;
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