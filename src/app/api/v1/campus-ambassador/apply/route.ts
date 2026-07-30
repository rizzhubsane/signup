import type { NextRequest } from "next/server";

import {
  isDuplicateError,
  jsonError,
  jsonOk,
  validationError,
} from "@/lib/api-response";
import { campusAmbassadorSchema } from "@/lib/schemas";
import {
  assertRequestBodySize,
  assertTrustedOrigin,
  getClientIp,
  hashIp,
  hashRateLimitKey,
  isHoneypotTripped,
  isWithinRateLimit,
} from "@/lib/security";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 12_288;

export async function POST(request: NextRequest) {
  try {
    if (!assertRequestBodySize(request, MAX_BODY_BYTES)) {
      return jsonError(413, "payload_too_large", "Request is too large.");
    }

    if (!assertTrustedOrigin(request)) {
      return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
    }

    const body = await request.json();
    const parsed = campusAmbassadorSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    if (isHoneypotTripped(parsed.data.website)) {
      return jsonOk(
        {
          applicationId: "00000000-0000-4000-8000-000000000000",
          status: "applied",
        },
        { status: 201 },
      );
    }

    const clientIp = getClientIp(request);
    const supabase = createSupabaseServiceClient();
    const ipHash = hashIp(clientIp);

    const ipAllowed = await isWithinRateLimit({
      supabase,
      route: "POST /api/v1/campus-ambassador/apply",
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

    const registrantAllowed = await isWithinRateLimit({
      supabase,
      route: "POST /api/v1/campus-ambassador/apply/registrant",
      ipHash: hashRateLimitKey(parsed.data.registrantId),
      limit: 3,
      windowSeconds: 3600,
    });

    if (!registrantAllowed) {
      return jsonError(
        429,
        "rate_limited",
        "Too many attempts. Please try again later.",
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
        "Application failed. Please check your details and try again.",
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
  } catch {
    return jsonError(
      500,
      "application_error",
      "Application failed. Please try again.",
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
