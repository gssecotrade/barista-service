import { prisma } from "../db/prisma";
export async function getOrCreateUser(externalUserId) {
    let user = await prisma.user.findUnique({
        where: { externalUserId },
    });
    if (!user) {
        user = await prisma.user.create({
            data: {
                externalUserId,
            },
        });
    }
    return user;
}
export async function updateUserProfileSummary(userId, profileSummary) {
    return prisma.user.update({
        where: { id: userId },
        data: { profileSummary },
    });
}
