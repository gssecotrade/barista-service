export const coffees = [
    {
        handle: "geisha",
        name: "Geisha",
        category: "single_origin",
        profile: ["floral", "elegante", "aromático"],
        notes: ["jazmín", "cítricos", "miel"],
        moments: ["tarde", "ritual", "degustación"],
        methods: ["filtro", "v60", "chemex"],
        whyChooseIt: "Ideal para quien busca una experiencia refinada, muy aromática y con personalidad delicada.",
        idealFor: ["hogar", "regalo", "restauración premium"],
    },
    {
        handle: "catuai",
        name: "Catuai",
        category: "single_origin",
        profile: ["equilibrado", "dulce", "versátil"],
        notes: ["caramelo", "chocolate", "fruta madura"],
        moments: ["mañana", "diario", "en cualquier momento"],
        methods: ["espresso", "moka", "con leche"],
        whyChooseIt: "Es la opción más versátil para quien quiere empezar a disfrutar el café con una taza amable y equilibrada.",
        idealFor: ["hogar", "oficina", "cafetería"],
    },
    {
        handle: "pacamara",
        name: "Pacamara",
        category: "single_origin",
        profile: ["intenso", "estructurado", "con cuerpo"],
        notes: ["cacao", "especias", "fruta madura"],
        moments: ["sobremesa", "después de comer", "cafés con más carácter"],
        methods: ["espresso", "moka"],
        whyChooseIt: "Perfecto para quien busca una taza con más presencia, cuerpo y persistencia.",
        idealFor: ["hogar", "hostelería", "coctelería"],
    },
];
export function buildKnowledgeBlock() {
    return coffees
        .map((coffee) => `
Café: ${coffee.name}
Handle: ${coffee.handle}
Perfil: ${coffee.profile.join(", ")}
Notas: ${coffee.notes.join(", ")}
Momentos: ${coffee.moments.join(", ")}
Métodos: ${coffee.methods.join(", ")}
Ideal para: ${coffee.idealFor.join(", ")}
Por qué elegirlo: ${coffee.whyChooseIt}
`.trim())
        .join("\n\n");
}
