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
  assertRequestBodySize,
  assertTrustedOrigin,
  getClientIp,
  hashIp,
  hashRateLimitKey,
  isHoneypotTripped,
  isWithinRateLimit,
  verifyTurnstile,
} from "@/lib/security";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_384;

export async function POST(request: NextRequest) {
  try {
    if (!assertRequestBodySize(request, MAX_BODY_BYTES)) {
      return jsonError(413, "payload_too_large", "Request is too large.");
    }

    if (!assertTrustedOrigin(request)) {
      return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
    }

    const body = await request.json();
    const parsed = registrantSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    // Silent reject — do not tip off scrapers that the field is a trap.
    if (isHoneypotTripped(parsed.data.website)) {
      return jsonOk(
        {
          registrantId: "00000000-0000-4000-8000-000000000000",
          type: parsed.data.type,
          status: "registered",
        },
        { status: 201 },
      );
    }

    const clientIp = getClientIp(request);
    const turnstile = await verifyTurnstile(
      parsed.data.turnstileToken,
      clientIp,
    );

    if (!turnstile.ok) {
      if (turnstile.reason === "misconfigured") {
        return jsonError(
          503,
          "bot_protection_unavailable",
          "Registration is temporarily unavailable. Please try again later.",
        );
      }

      return jsonError(
        400,
        "bot_check_failed",
        "Please complete the verification challenge.",
      );
    }

    const supabase = createSupabaseServiceClient();
    const ipHash = hashIp(clientIp);

    const ipAllowed = await isWithinRateLimit({
      supabase,
      route: "POST /api/v1/registrants",
      ipHash,
      limit: 3,
      windowSeconds: 60,
    });

    if (!ipAllowed) {
      return jsonError(
        429,
        "rate_limited",
        "Too many attempts. Please wait a minute and try again.",
      );
    }

    const emailAllowed = await isWithinRateLimit({
      supabase,
      route: "POST /api/v1/registrants/email",
      ipHash: hashRateLimitKey(parsed.data.email),
      limit: 5,
      windowSeconds: 3600,
    });

    if (!emailAllowed) {
      return jsonError(
        429,
        "rate_limited",
        "Too many attempts for this email. Please try again later.",
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
        "Registration failed. Please check your details and try again.",
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
      "Registration failed. Please try again.",
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
