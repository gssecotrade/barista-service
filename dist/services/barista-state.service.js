class BaristaStateService {
    constructor() {
        this.usersByUserId = new Map();
        this.userIdByExternalUserId = new Map();
    }
    createOrGetUser(externalUserId) {
        const existingUserId = this.userIdByExternalUserId.get(externalUserId);
        if (existingUserId) {
            const existing = this.usersByUserId.get(existingUserId);
            if (existing) {
                return existing;
            }
        }
        const now = new Date().toISOString();
        const userId = this.generateUserId();
        const user = {
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
    getUserByUserId(userId) {
        return this.usersByUserId.get(userId) || null;
    }
    getUserByExternalUserId(externalUserId) {
        const userId = this.userIdByExternalUserId.get(externalUserId);
        if (!userId)
            return null;
        return this.usersByUserId.get(userId) || null;
    }
    updateConversationState(userId, payload) {
        const user = this.usersByUserId.get(userId);
        if (!user)
            return null;
        const nextConversation = {
            ...user.conversation,
            ...payload,
            lastInteractionAt: payload.lastInteractionAt || new Date().toISOString(),
        };
        const updated = {
            ...user,
            updatedAt: new Date().toISOString(),
            conversation: nextConversation,
        };
        this.usersByUserId.set(userId, updated);
        return updated;
    }
    clearConversationState(userId) {
        const user = this.usersByUserId.get(userId);
        if (!user)
            return null;
        const updated = {
            ...user,
            updatedAt: new Date().toISOString(),
            conversation: this.emptyConversationState(),
        };
        this.usersByUserId.set(userId, updated);
        return updated;
    }
    getResumeSnapshot(userId) {
        const user = this.usersByUserId.get(userId);
        if (!user) {
            return this.emptyResumeSnapshot();
        }
        const c = user.conversation;
        const hasContext = !!c.lastInteractionAt &&
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
    buildResumeSummary(conversation) {
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
    friendlyCoffee(name) {
        const value = String(name || "").trim();
        if (!value)
            return "";
        const lower = value.toLowerCase();
        if (lower.includes("geisha"))
            return "Geisha";
        if (lower.includes("pacamara"))
            return "Pacamara";
        if (lower.includes("catuai"))
            return "Catuai";
        return value;
    }
    friendlyIntent(intent) {
        const map = {
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
    emptyConversationState() {
        return {
            lastCoffee: "",
            lastIntent: "",
            lastUserMessage: "",
            lastAssistantReply: "",
            lastInteractionAt: "",
        };
    }
    emptyResumeSnapshot() {
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
    generateUserId() {
        return `barista_${Math.random().toString(36).slice(2, 10)}${Date.now()
            .toString(36)
            .slice(-4)}`;
    }
}
export const baristaStateService = new BaristaStateService();
