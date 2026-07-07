import { router, publicProcedure } from "./trpc.js";
import { authRouter } from "./routers/auth.js";
import { clustersRouter } from "./routers/clusters.js";

/**
 * Root API router. Feature routers (clusters, cost, recommendations,
 * utilization) get merged in here in later stages. `health` proves the tRPC
 * pipeline end-to-end without needing auth.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    api: "trpc",
    ts: new Date(),
  })),
  auth: authRouter,
  clusters: clustersRouter,
});

/** The type the frontend imports for end-to-end type safety (no codegen). */
export type AppRouter = typeof appRouter;
