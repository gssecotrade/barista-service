export type ConversationMode = "continue" | "new" | null;
export type DrinkType = "coffee" | "cocktail" | "mocktail" | null;

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

  updatedAt: null,
};

export function normalizeBaristaState(input?: Partial<BaristaState> | null): BaristaState {
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
    updatedAt: new Date().toISOString(),
  });

  return next;
}

export function hasMeaningfulState(state?: Partial<BaristaState> | null): boolean {
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
      state.lastAssistantSummary
  );
}

export function summarizeStateForWelcome(state?: Partial<BaristaState> | null): string | null {
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

  if (state.activeCoffee) {
    return `La última vez estuvimos hablando de ${prettyCoffee(state.activeCoffee)}.`;
  }

  return null;
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