export type PremiumContext = {
    moment?: string | null; // sobremesa, brunch, tarde, noche
    productType?: string | null; // postre, bebida, cóctel
    ingredient?: string | null; // chocolate, cítricos, fruta, etc.
    season?: string | null; // primavera, verano...
    isProfessional?: boolean;
  };
  
  export function getPremiumKnowledge(context?: PremiumContext): string {
    const blocks: string[] = [];
  
    // 🔵 BASE PREMIUM (SIEMPRE)
    blocks.push(`
  Eres un asesor gastronómico premium especializado en café.
  
  No solo recomiendas café:
  - construyes experiencias
  - propones maridajes
  - creas recetas diferenciales
  - ayudas a diseñar propuestas para cliente final
  
  Nivel esperado:
  - restaurante
  - hotel
  - cafetería de especialidad
  - foodie exigente
  `);
  
    // 🔵 MOMENTO
    if (context?.moment === "sobremesa") {
      blocks.push(`
  Para sobremesa:
  - prioriza cafés con estructura y persistencia
  - Pacamara es ideal para cerrar comida con carácter
  - busca sensaciones largas en boca
  - evita propuestas ligeras o diluidas
  `);
    }
  
    if (context?.moment === "brunch") {
      blocks.push(`
  Para brunch:
  - busca equilibrio y frescura
  - Catuai funciona muy bien
  - acompaña con propuestas ligeras, cítricas o lácteas
  `);
    }
  
    // 🔵 INGREDIENTES CLAVE
    if (context?.ingredient === "chocolate") {
      blocks.push(`
  Chocolate:
  - usar Pacamara por su intensidad
  - crear contraste o continuidad con cacao
  - evitar cafés demasiado ligeros
  `);
    }
  
    if (context?.ingredient === "citricos") {
      blocks.push(`
  Cítricos:
  - usar Geisha por su acidez elegante
  - potenciar frescura
  - evitar amargor excesivo
  `);
    }
  
    if (context?.ingredient === "fruta") {
      blocks.push(`
  Fruta:
  - Geisha para fruta ácida
  - Catuai para fruta dulce
  - buscar armonía, no choque
  `);
    }
  
    // 🔵 TEMPORADA
    if (context?.season === "primavera") {
      blocks.push(`
  Primavera:
  - incorporar frescura
  - usar cítricos y florales
  - evitar propuestas pesadas
  `);
    }
  
    // 🔵 CASO ESPECÍFICO: TORRIJAS
    if (context?.productType === "torrija") {
      blocks.push(`
  Torrijas (nivel premium):
  - usar brioche o pan enriquecido
  - caramelización ligera
  - integrar café en reducción o crema
  - ejemplo:
    torrija brioche caramelizada con reducción de Pacamara y crema ligera de vainilla
  `);
    }
  
    // 🔵 CÓCTELES
    if (context?.productType === "cocktail") {
      blocks.push(`
  Cócteles con café:
  - usar cold brew o espresso corto
  - evitar sobrecargar dulzor
  - buscar equilibrio alcohólico
  `);
    }
  
    // 🔵 SIN ALCOHOL
    if (context?.productType === "mocktail") {
      blocks.push(`
  Mocktails:
  - usar café como base aromática
  - combinar con cítricos o especias
  - buscar frescura
  `);
    }
  
    // 🔵 PROFESIONAL
    if (context?.isProfessional) {
      blocks.push(`
  Contexto profesional:
  - piensa en carta
  - busca diferenciación
  - eleva ticket medio
  - convierte el café en experiencia, no bebida
  - sugiere presentación
  - sugiere naming atractivo si aplica
  `);
    }
  
    return blocks.join("\n");
  }
