type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

const getClientKey = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "local";
};

export const checkRateLimit = (
  request: Request,
  scope: string,
  { limit, windowMs }: RateLimitOptions,
) => {
  const now = Date.now();
  const key = `${scope}:${getClientKey(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count <= limit) {
    return null;
  }

  return Response.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도하십시오." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)),
      },
    },
  );
};
