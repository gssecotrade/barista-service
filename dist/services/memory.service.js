import { prisma } from "../db/prisma";
export async function saveMessage(userId, role, content) {
    return prisma.message.create({
        data: {
            userId,
            role,
            content,
        },
    });
}
export async function getRecentMessages(userId, limit = 12) {
    const messages = await prisma.message.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
    return messages.reverse();
}
export async function buildMemorySummary(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            preferences: true,
            messages: {
                orderBy: { createdAt: "desc" },
                take: 6,
            },
        },
    });
    if (!user)
        return "Sin memoria disponible.";
    const prefs = user.preferences.length > 0
        ? user.preferences.map((p) => `${p.key}: ${p.value}`).join(", ")
        : "Sin preferencias explícitas guardadas todavía.";
    const recentTopics = user.messages.length > 0
        ? user.messages
            .slice()
            .reverse()
            .map((m) => `${m.role}: ${m.content}`)
            .join(" | ")
        : "Sin mensajes previos.";
    return `
Perfil conocido:
- externalUserId: ${user.externalUserId}
- email: ${user.email ?? "no disponible"}
- resumen previo: ${user.profileSummary ?? "sin resumen"}
- preferencias: ${prefs}

Conversación reciente:
${recentTopics}
`.trim();
}
