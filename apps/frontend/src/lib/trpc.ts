import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@kubepilot/backend/trpc";

/** Typed tRPC hooks (trpc.auth.me.useQuery(), etc.) — types come from the server's AppRouter. */
export const trpc = createTRPCReact<AppRouter>();

/** The tRPC client: talks to /trpc (Vite proxies it to the backend in dev). */
export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/trpc",
        transformer: superjson, // must match the server's transformer
        // Send the session cookie with every request.
        fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }),
      }),
    ],
  });
}
