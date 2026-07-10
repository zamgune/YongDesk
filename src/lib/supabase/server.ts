import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseServerConfig } from "./config";

export const createSupabaseServerClient = async () => {
  const config = getSupabaseServerConfig();
  if (!config) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const cookieStore = await cookies();

  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies; proxy.ts refreshes sessions.
        }
      },
    },
  });
};
