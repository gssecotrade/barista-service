import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY es obligatoria"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Error validando variables de entorno:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  port: parsed.data.PORT,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  databaseUrl: parsed.data.DATABASE_URL,
};
