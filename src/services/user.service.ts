import { prisma } from "../db/prisma";

export async function getOrCreateUser(externalUserId: string) {
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

export async function updateUserProfileSummary(userId: string, profileSummary: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { profileSummary },
  });
}
