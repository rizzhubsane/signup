import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

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
    process.env.IP_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "local-development-only";

  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
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

export async function verifyTurnstile(token?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    return { ok: true, skipped: true };
  }

  if (!token) {
    return { ok: false, skipped: false };
  }

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);

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
      return { ok: false, skipped: false };
    }

    const result = (await response.json()) as { success?: boolean };
    return { ok: result.success === true, skipped: false };
  } catch {
    return { ok: false, skipped: false };
  }
}
