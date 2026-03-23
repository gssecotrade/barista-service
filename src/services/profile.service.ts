import { prisma } from "../db/prisma";

export async function upsertPreference(
  userId: string,
  key: string,
  value: string
) {
  const existing = await prisma.preference.findFirst({
    where: {
      userId,
      key,
    },
  });

  if (existing) {
    return prisma.preference.update({
      where: { id: existing.id },
      data: { value },
    });
  }

  return prisma.preference.create({
    data: {
      userId,
      key,
      value,
    },
  });
}

export async function detectAndStorePreferences(userId: string, message: string) {
  const text = message.toLowerCase();

  if (
    text.includes("suave") ||
    text.includes("equilibrado") ||
    text.includes("dulce")
  ) {
    await upsertPreference(userId, "taste_profile", "suave_equilibrado");
  }

  if (
    text.includes("intenso") ||
    text.includes("cuerpo") ||
    text.includes("fuerte")
  ) {
    await upsertPreference(userId, "taste_profile", "intenso_con_cuerpo");
  }

  if (text.includes("ácido") || text.includes("acido")) {
    await upsertPreference(userId, "acidity_sensitivity", "mentions_acidity");
  }

  if (text.includes("espresso")) {
    await upsertPreference(userId, "brew_method", "espresso");
  }

  if (text.includes("filtro") || text.includes("v60") || text.includes("chemex")) {
    await upsertPreference(userId, "brew_method", "filtro");
  }

  if (text.includes("cafetería") || text.includes("cafeteria") || text.includes("restaurante")) {
    await upsertPreference(userId, "user_mode", "profesional");
  }

  if (text.includes("casa") || text.includes("hogar")) {
    await upsertPreference(userId, "user_mode", "consumidor");
  }
}
