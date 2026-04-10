export type ConversationMode = "continue" | "new" | null;
export type DrinkType = "coffee" | "cocktail" | "mocktail" | null;

export type ProfessionalPlanCoffee = {
  handle: "catuai" | "geisha" | "pacamara";
  name: string;
  percentage: number;
  targetKg: number;
  totalB2B?: number;
  roundedTargetGrams?: number;
  formatBreakdown?: Array<{
    variantId?: number | string | null;
    bagSizeGrams: number;
    quantity: number;
    priceB2B?: number;
    priceB2C?: number;
  }>;
};

export type ProfessionalPlanState = {
  coffeesPerDay?: number | null;
  days?: number | null;
  coffees?: ProfessionalPlanCoffee[];
} | null;

export type BaristaState = {
  activeTopic:
    | "coffee_selection"
    | "preparation"
    | "pairing"
    | "cocktail"
    | "orders"
    | "subscription"
    | "education"
    | "professional"
    | "general"
    | null;
  activeCoffee: "catuai" | "geisha" | "pacamara" | null;
  activeMethod: string | null;
  tasteProfile: string | null;
  pendingQuestion: string | null;

  activeRecipe: string | null;
  activeDrinkType: DrinkType;
  lastUserGoal: string | null;
  lastAssistantSummary: string | null;
  conversationMode: ConversationMode;

  lastProfessionalPlan: ProfessionalPlanState;

  updatedAt: string | null;
};

export const EMPTY_BARISTA_STATE: BaristaState = {
  activeTopic: null,
  activeCoffee: null,
  activeMethod: null,
  tasteProfile: null,
  pendingQuestion: null,

  activeRecipe: null,
  activeDrinkType: null,
  lastUserGoal: null,
  lastAssistantSummary: null,
  conversationMode: null,

  lastProfessionalPlan: null,

  updatedAt: null,
};

export function normalizeBaristaState(
  input?: Partial<BaristaState> | null
): BaristaState {
  return {
    activeTopic: input?.activeTopic ?? null,
    activeCoffee: input?.activeCoffee ?? null,
    activeMethod: input?.activeMethod ?? null,
    tasteProfile: input?.tasteProfile ?? null,
    pendingQuestion: input?.pendingQuestion ?? null,

    activeRecipe: input?.activeRecipe ?? null,
    activeDrinkType: input?.activeDrinkType ?? null,
    lastUserGoal: input?.lastUserGoal ?? null,
    lastAssistantSummary: input?.lastAssistantSummary ?? null,
    conversationMode: input?.conversationMode ?? null,

    lastProfessionalPlan: normalizeProfessionalPlan(input?.lastProfessionalPlan),

    updatedAt: input?.updatedAt ?? null,
  };
}

export function mergeBaristaState(
  current: Partial<BaristaState> | null | undefined,
  patch: Partial<BaristaState> | null | undefined
): BaristaState {
  const base = normalizeBaristaState(current);

  const next = normalizeBaristaState({
    ...base,
    ...(patch || {}),
    lastProfessionalPlan:
      patch && "lastProfessionalPlan" in patch
        ? patch.lastProfessionalPlan ?? null
        : base.lastProfessionalPlan,
    updatedAt: new Date().toISOString(),
  });

  return next;
}

export function hasMeaningfulState(
  state?: Partial<BaristaState> | null
): boolean {
  if (!state) return false;

  return Boolean(
    state.activeCoffee ||
      state.activeTopic ||
      state.activeMethod ||
      state.tasteProfile ||
      state.pendingQuestion ||
      state.activeRecipe ||
      state.activeDrinkType ||
      state.lastUserGoal ||
      state.lastAssistantSummary ||
      state.lastProfessionalPlan
  );
}

export function summarizeStateForWelcome(
  state?: Partial<BaristaState> | null
): string | null {
  if (!state) return null;

  if (state.lastAssistantSummary) return state.lastAssistantSummary;

  if (state.activeRecipe && state.activeCoffee) {
    return `La última vez estábamos con ${prettyCoffee(state.activeCoffee)} y una receta de ${state.activeRecipe}.`;
  }

  if (state.activeDrinkType === "cocktail" && state.activeCoffee) {
    return `La última vez estábamos hablando de un cóctel con ${prettyCoffee(state.activeCoffee)}.`;
  }

  if (state.activeDrinkType === "mocktail" && state.activeCoffee) {
    return `La última vez estábamos hablando de una propuesta sin alcohol con ${prettyCoffee(state.activeCoffee)}.`;
  }

  if (state.activeTopic === "pairing" && state.activeCoffee) {
    return `La última vez estábamos hablando de maridajes con ${prettyCoffee(state.activeCoffee)}.`;
  }

  if (state.activeTopic === "preparation" && state.activeCoffee) {
    return `La última vez estábamos viendo cómo preparar ${prettyCoffee(state.activeCoffee)}.`;
  }

  if (
    state.activeTopic === "professional" &&
    state.lastProfessionalPlan?.coffeesPerDay
  ) {
    return `La última vez estábamos trabajando una propuesta profesional sobre ${state.lastProfessionalPlan.coffeesPerDay} cafés al día.`;
  }

  if (state.activeCoffee) {
    return `La última vez estuvimos hablando de ${prettyCoffee(state.activeCoffee)}.`;
  }

  return null;
}

function normalizeProfessionalPlan(
  input?: ProfessionalPlanState | undefined
): ProfessionalPlanState {
  if (!input || typeof input !== "object") return null;

  const coffees = Array.isArray(input.coffees)
    ? input.coffees
        .filter(
          (
            coffee
          ): coffee is NonNullable<ProfessionalPlanState>["coffees"][number] =>
            !!coffee &&
            typeof coffee === "object" &&
            (coffee.handle === "catuai" ||
              coffee.handle === "pacamara" ||
              coffee.handle === "geisha") &&
            typeof coffee.name === "string" &&
            typeof coffee.percentage === "number" &&
            typeof coffee.targetKg === "number"
        )
        .map((coffee) => ({
          handle: coffee.handle,
          name: coffee.name,
          percentage: coffee.percentage,
          targetKg: coffee.targetKg,
          totalB2B:
            typeof coffee.totalB2B === "number" ? coffee.totalB2B : undefined,
          roundedTargetGrams:
            typeof coffee.roundedTargetGrams === "number"
              ? coffee.roundedTargetGrams
              : undefined,
          formatBreakdown: Array.isArray(coffee.formatBreakdown)
            ? coffee.formatBreakdown
                .filter(
                  (item) =>
                    !!item &&
                    typeof item === "object" &&
                    typeof item.bagSizeGrams === "number" &&
                    typeof item.quantity === "number"
                )
                .map((item) => ({
                  variantId:
                    typeof item.variantId === "string" ||
                    typeof item.variantId === "number"
                      ? item.variantId
                      : null,
                  bagSizeGrams: item.bagSizeGrams,
                  quantity: item.quantity,
                  priceB2B:
                    typeof item.priceB2B === "number"
                      ? item.priceB2B
                      : undefined,
                  priceB2C:
                    typeof item.priceB2C === "number"
                      ? item.priceB2C
                      : undefined,
                }))
            : undefined,
        }))
    : [];

  return {
    coffeesPerDay:
      typeof input.coffeesPerDay === "number" ? input.coffeesPerDay : null,
    days: typeof input.days === "number" ? input.days : null,
    coffees,
  };
}

function prettyCoffee(coffee: string): string {
  if (coffee === "catuai") return "Catuai";
  if (coffee === "geisha") return "Geisha";
  if (coffee === "pacamara") return "Pacamara";
  return coffee;
}

export const baristaStateService = {
  normalizeBaristaState,
  mergeBaristaState,
  hasMeaningfulState,
  summarizeStateForWelcome,
};
