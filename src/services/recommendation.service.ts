import { prisma } from "../db/prisma";

async function recommendCoffeeForUser(userId: string) {
  const preferences = await prisma.preference.findMany({
    where: { userId },
  });

  const prefMap = Object.fromEntries(
    preferences.map((p) => [p.key, p.value])
  );

  const tasteProfile = prefMap["taste_profile"];

  if (tasteProfile === "suave_equilibrado") {
    return {
      handle: "catuai",
      name: "Catuai",
      reason:
        "Encaja por su perfil suave, equilibrado y fácil de disfrutar desde el principio.",
    };
  }

  if (tasteProfile === "intenso_con_cuerpo") {
    return {
      handle: "pacamara",
      name: "Pacamara",
      reason:
        "Encaja por su mayor cuerpo, estructura y carácter en taza.",
    };
  }

  return {
    handle: "catuai",
    name: "Catuai",
    reason:
      "Es la recomendación más versátil para empezar con una experiencia amable y equilibrada.",
  };
}

export { recommendCoffeeForUser };
