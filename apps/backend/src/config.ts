import { z } from "zod";

/**
 * Runtime configuration, validated at startup. Fails fast with a clear error
 * if anything required is missing/mis-typed.
 */
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_DATABASE_URL: z.string().min(1),
  REDIS_QUEUE_URL: z.string().min(1),
  REDIS_CACHE_URL: z.string().min(1),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
