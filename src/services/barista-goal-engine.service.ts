export type PrimaryGoal =
  | "margin"
  | "daily_consumption"
  | "premium_experience"
  | "operational_stability"
  | "specialty_filter"
  | "consistency"
  | "upselling"
  | "workflow";

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

export function detectPrimaryGoal(message: string): PrimaryGoal {
  const text = normalize(message);

  // margen / rentabilidad
  if (
    text.includes("margen") ||
    text.includes("rentabilidad") ||
    text.includes("beneficio") ||
    text.includes("coste por taza") ||
    text.includes("precio de venta")
  ) {
    return "margin";
  }

  // volumen / workflow horeca
  if (
    text.includes("mucho volumen") ||
    text.includes("alto volumen") ||
    text.includes("140 cafés") ||
    text.includes("flujo") ||
    text.includes("rotación")
  ) {
    return "operational_stability";
  }

  // experiencia premium
  if (
    text.includes("gastronómico") ||
    text.includes("especial") ||
    text.includes("premium") ||
    text.includes("sobremesa")
  ) {
    return "premium_experience";
  }

  // filtro specialty
  if (
    text.includes("v60") ||
    text.includes("filtro") ||
    text.includes("origami") ||
    text.includes("kalita")
  ) {
    return "specialty_filter";
  }

  // consumo diario
  if (
    text.includes("diario") ||
    text.includes("cada día") ||
    text.includes("todos los días")
  ) {
    return "daily_consumption";
  }

  return "consistency";
}
