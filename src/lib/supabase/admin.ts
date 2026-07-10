import { createClient } from "@supabase/supabase-js";

import { getSupabaseAdminConfig } from "./config";

export const createSupabaseAdminClient = () => {
  const config = getSupabaseAdminConfig();
  if (!config) {
    throw new Error("Supabase admin environment variables are not configured.");
  }

  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
