import type { NextRequest } from "next/server";

import {
  isDuplicateError,
  jsonError,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { campusAmbassadorSchema } from "@/lib/schemas";
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
    const parsed = campusAmbassadorSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const supabase = createSupabaseServiceClient();
    const ipHash = hashIp(getClientIp(request));
    const allowed = await isWithinRateLimit({
      supabase,
      route: "POST /api/v1/campus-ambassador/apply",
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

    const { data, error } = await supabase.rpc("apply_campus_ambassador", {
      p_registrant_id: parsed.data.registrantId,
      p_college: parsed.data.college ?? null,
      p_city: parsed.data.city ?? null,
      p_year_of_study: parsed.data.yearOfStudy ?? null,
      p_social_url: parsed.data.socialUrl ?? null,
      p_motivation: parsed.data.motivation ?? null,
    });

    if (error) {
      if (isDuplicateError(error)) {
        return jsonError(
          409,
          "duplicate_application",
          "You have already applied for the campus ambassador program.",
        );
      }

      return jsonError(
        400,
        "application_failed",
        error.message || "Application failed.",
      );
    }

    const applicationId = extractRpcId(data, "application_id");

    if (!applicationId) {
      return jsonError(
        500,
        "application_missing_id",
        "Application completed but no id was returned.",
      );
    }

    return jsonOk(
      {
        applicationId,
        status: "applied",
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(
      500,
      "application_error",
      error instanceof Error ? error.message : "Application failed.",
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
