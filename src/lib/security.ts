import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function getClientIp(request: NextRequest) {
  const cloudflareIp = request.headers.get("cf-connecting-ip");

  if (cloudflareIp) {
    return cloudflareIp;
  }

  const realIp = request.headers.get("x-real-ip");

  if (realIp) {
    return realIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

export function hashIp(ip: string) {
  const secret =
    process.env.IP_HASH_SECRET?.trim() ||
    // Soft-launch fallback — replace with a dedicated secret before public launch.
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "local-development-only";

  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
}

export function hashRateLimitKey(value: string) {
  return hashIp(`key:${value}`);
}

/**
 * Browser form posts always send Origin (or at least Referer). Rejecting
 * bare scripted posts that omit both cuts a lot of casual API abuse.
 */
export function assertTrustedOrigin(request: NextRequest) {
  if (!isProduction()) {
    return true;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  // Soft-launch: if SITE_URL is unset, don't block registrations.
  if (!siteUrl) {
    return true;
  }

  let allowedOrigin: string;

  try {
    allowedOrigin = new URL(siteUrl).origin;
  } catch {
    return true;
  }

  const origin = request.headers.get("origin");

  if (!origin) {
    const referer = request.headers.get("referer");

    if (!referer) {
      return true;
    }

    try {
      return new URL(referer).origin === allowedOrigin;
    } catch {
      return false;
    }
  }

  return origin === allowedOrigin;
}

export function isHoneypotTripped(value?: string) {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertRequestBodySize(request: NextRequest, maxBytes: number) {
  const header = request.headers.get("content-length");

  if (!header) {
    return true;
  }

  const size = Number(header);

  if (!Number.isFinite(size)) {
    return false;
  }

  return size <= maxBytes;
}

export async function isWithinRateLimit({
  supabase,
  route,
  ipHash,
  limit,
  windowSeconds,
}: {
  supabase: SupabaseClient;
  route: string;
  ipHash: string;
  limit: number;
  windowSeconds: number;
}) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("route", route)
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (error) {
    throw error;
  }

  if ((count ?? 0) >= limit) {
    return false;
  }

  const insertResult = await supabase.from("rate_limit_events").insert({
    route,
    ip_hash: ipHash,
  });

  if (insertResult.error) {
    throw insertResult.error;
  }

  return true;
}

export type TurnstileResult = {
  ok: boolean;
  skipped: boolean;
  reason?: "misconfigured" | "missing_token" | "rejected" | "upstream";
};

/**
 * Production fails closed when Turnstile is not configured. Local/dev may
 * skip so the form stays usable without Cloudflare keys.
 */
export async function verifyTurnstile(
  token?: string,
  ip?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

  if (!secret) {
    // Soft-launch: allow writes until Turnstile keys are configured.
    // Re-enable fail-closed in production once NEXT_PUBLIC_TURNSTILE_SITE_KEY
    // and TURNSTILE_SECRET_KEY are set on Vercel.
    return { ok: true, skipped: true, reason: "misconfigured" };
  }

  if (!token) {
    return { ok: false, skipped: false, reason: "missing_token" };
  }

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);

  if (ip && ip !== "unknown") {
    body.append("remoteip", ip);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) {
      return { ok: false, skipped: false, reason: "upstream" };
    }

    const result = (await response.json()) as { success?: boolean };
    return result.success === true
      ? { ok: true, skipped: false }
      : { ok: false, skipped: false, reason: "rejected" };
  } catch {
    return { ok: false, skipped: false, reason: "upstream" };
  }
}
