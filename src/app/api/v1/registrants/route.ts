import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import {
  isDuplicateError,
  jsonError,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { registrantSchema } from "@/lib/schemas";
import {
  getClientIp,
  hashIp,
  isWithinRateLimit,
  verifyTurnstile,
} from "@/lib/security";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = registrantSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const supabase = createSupabaseServiceClient();
    const ipHash = hashIp(getClientIp(request));
    const allowed = await isWithinRateLimit({
      supabase,
      route: "POST /api/v1/registrants",
      ipHash,
      limit: 5,
      windowSeconds: 60,
    });

    if (!allowed) {
      return jsonError(
        429,
        "rate_limited",
        "Too many attempts. Please wait a minute and try again.",
      );
    }

    const turnstile = await verifyTurnstile(parsed.data.turnstileToken);

    if (!turnstile.ok) {
      return jsonError(
        400,
        "bot_check_failed",
        "Please complete the verification challenge.",
      );
    }

    const { data, error } = await supabase.rpc("register_preregistrant", {
      p_edition_slug: parsed.data.editionSlug,
      p_full_name: parsed.data.fullName,
      p_email: parsed.data.email,
      p_phone: parsed.data.phone,
      p_type: parsed.data.type,
      p_startup: parsed.data.startup ?? null,
      p_source: parsed.data.source,
      p_utm_source: parsed.data.utmSource ?? null,
      p_utm_medium: parsed.data.utmMedium ?? null,
      p_utm_campaign: parsed.data.utmCampaign ?? null,
      p_referral_code: parsed.data.referralCode ?? null,
      p_consent_version: parsed.data.consentVersion,
      p_ip_hash: ipHash,
    });

    if (error) {
      if (isDuplicateError(error)) {
        return jsonError(
          409,
          "duplicate_registration",
          "This email is already pre-registered for BECon.",
        );
      }

      return jsonError(
        400,
        "registration_failed",
        error.message || "Registration failed.",
      );
    }

    const registrantId = extractRpcId(data, "registrant_id");

    if (!registrantId) {
      return jsonError(
        500,
        "registration_missing_id",
        "Registration completed but no id was returned.",
      );
    }

    return jsonOk(
      {
        registrantId,
        type: parsed.data.type,
        status: "registered",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    return jsonError(
      500,
      "registration_error",
      error instanceof Error ? error.message : "Registration failed.",
    );
  }
}

function extractRpcId(data: unknown, key: string) {
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    return typeof first?.[key] === "string" ? first[key] : null;
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    return typeof record[key] === "string" ? record[key] : null;
  }

  return null;
}
