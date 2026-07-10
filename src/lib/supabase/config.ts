export const getSupabaseServerConfig = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  const normalizedUrl = (() => {
    try {
      const url = new URL(supabaseUrl);
      if (url.pathname.replace(/\/+$/, "") === "/rest/v1") {
        return url.origin;
      }
      return url.toString().replace(/\/+$/, "");
    } catch {
      return supabaseUrl.replace(/\/+$/, "");
    }
  })();

  return {
    supabaseUrl: normalizedUrl,
    supabasePublishableKey,
  };
};

export const isSupabaseConfigured = () => getSupabaseServerConfig() !== null;

export const getSupabaseAdminConfig = () => {
  const serverConfig = getSupabaseServerConfig();
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverConfig || !supabaseSecretKey) {
    return null;
  }
  return {
    ...serverConfig,
    supabaseSecretKey,
  };
};
