export type BaristaIntent =
  | "recommend_coffee"
  | "brewing_guidance"
  | "pairing"
  | "cocktails"
  | "subscription"
  | "orders"
  | "support"
  | string;

export interface ConversationState {
  lastCoffee: string;
  lastIntent: BaristaIntent | "";
  lastUserMessage: string;
  lastAssistantReply: string;
  lastInteractionAt: string;
}

export interface BaristaUserState {
  userId: string;
  externalUserId: string;
  createdAt: string;
  updatedAt: string;
  conversation: ConversationState;
}

export interface ResumeSnapshot {
  resumeAvailable: boolean;
  resumeSummary: string;
  lastCoffee: string;
  lastIntent: BaristaIntent | "";
  lastUserMessage: string;
  lastAssistantReply: string;
  lastInteractionAt: string;
}

type UpdateConversationInput = Partial<ConversationState>;

class BaristaStateService {
  private usersByUserId = new Map<string, BaristaUserState>();
  private userIdByExternalUserId = new Map<string, string>();

  createOrGetUser(externalUserId: string): BaristaUserState {
    const existingUserId = this.userIdByExternalUserId.get(externalUserId);

    if (existingUserId) {
      const existing = this.usersByUserId.get(existingUserId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const userId = this.generateUserId();

    const user: BaristaUserState = {
      userId,
      externalUserId,
      createdAt: now,
      updatedAt: now,
      conversation: this.emptyConversationState(),
    };

    this.usersByUserId.set(userId, user);
    this.userIdByExternalUserId.set(externalUserId, userId);

    return user;
  }

  getUserByUserId(userId: string): BaristaUserState | null {
    return this.usersByUserId.get(userId) || null;
  }

  getUserByExternalUserId(externalUserId: string): BaristaUserState | null {
    const userId = this.userIdByExternalUserId.get(externalUserId);
    if (!userId) return null;
    return this.usersByUserId.get(userId) || null;
  }

  updateConversationState(
    userId: string,
    payload: UpdateConversationInput
  ): BaristaUserState | null {
    const user = this.usersByUserId.get(userId);
    if (!user) return null;

    const nextConversation: ConversationState = {
      ...user.conversation,
      ...payload,
      lastInteractionAt:
        payload.lastInteractionAt || new Date().toISOString(),
    };

    const updated: BaristaUserState = {
      ...user,
      updatedAt: new Date().toISOString(),
      conversation: nextConversation,
    };

    this.usersByUserId.set(userId, updated);
    return updated;
  }

  clearConversationState(userId: string): BaristaUserState | null {
    const user = this.usersByUserId.get(userId);
    if (!user) return null;

    const updated: BaristaUserState = {
      ...user,
      updatedAt: new Date().toISOString(),
      conversation: this.emptyConversationState(),
    };

    this.usersByUserId.set(userId, updated);
    return updated;
  }

  getResumeSnapshot(userId: string): ResumeSnapshot {
    const user = this.usersByUserId.get(userId);

    if (!user) {
      return this.emptyResumeSnapshot();
    }

    const c = user.conversation;
    const hasContext =
      !!c.lastInteractionAt &&
      (!!c.lastCoffee ||
        !!c.lastIntent ||
        !!c.lastUserMessage ||
        !!c.lastAssistantReply);

    if (!hasContext) {
      return {
        resumeAvailable: false,
        resumeSummary: "",
        lastCoffee: "",
        lastIntent: "",
        lastUserMessage: "",
        lastAssistantReply: "",
        lastInteractionAt: "",
      };
    }

    return {
      resumeAvailable: true,
      resumeSummary: this.buildResumeSummary(c),
      lastCoffee: c.lastCoffee,
      lastIntent: c.lastIntent,
      lastUserMessage: c.lastUserMessage,
      lastAssistantReply: c.lastAssistantReply,
      lastInteractionAt: c.lastInteractionAt,
    };
  }

  private buildResumeSummary(conversation: ConversationState): string {
    const coffee = this.friendlyCoffee(conversation.lastCoffee);
    const intent = this.friendlyIntent(conversation.lastIntent);

    if (coffee && intent) {
      return `${coffee} y ${intent}`;
    }

    if (coffee) {
      return coffee;
    }

    if (intent) {
      return intent;
    }

    if (conversation.lastUserMessage) {
      return `"${conversation.lastUserMessage}"`;
    }

    return "tu consulta anterior";
  }

  private friendlyCoffee(name: string): string {
    const value = String(name || "").trim();
    if (!value) return "";

    const lower = value.toLowerCase();

    if (lower.includes("geisha")) return "Geisha";
    if (lower.includes("pacamara")) return "Pacamara";
    if (lower.includes("catuai")) return "Catuai";

    return value;
  }

  private friendlyIntent(intent: BaristaIntent | ""): string {
    const map: Record<string, string> = {
      recommend_coffee: "la selección del café",
      brewing_guidance: "la preparación",
      pairing: "el maridaje",
      cocktails: "la coctelería con café",
      subscription: "las suscripciones",
      orders: "los pedidos",
      support: "una consulta de soporte",
    };

    return intent ? map[intent] || intent : "";
  }

  private emptyConversationState(): ConversationState {
    return {
      lastCoffee: "",
      lastIntent: "",
      lastUserMessage: "",
      lastAssistantReply: "",
      lastInteractionAt: "",
    };
  }

  private emptyResumeSnapshot(): ResumeSnapshot {
    return {
      resumeAvailable: false,
      resumeSummary: "",
      lastCoffee: "",
      lastIntent: "",
      lastUserMessage: "",
      lastAssistantReply: "",
      lastInteractionAt: "",
    };
  }

  private generateUserId(): string {
    return `barista_${Math.random().toString(36).slice(2, 10)}${Date.now()
      .toString(36)
      .slice(-4)}`;
  }
}

export const baristaStateService = new BaristaStateService();
