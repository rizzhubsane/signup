import type { NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/api-response";
import type { CounterPayload } from "@/lib/schemas";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ editionSlug: string }> },
) {
  const { editionSlug } = await context.params;

  try {
    const supabase = createSupabaseServiceClient();

    const { data: counter, error: counterError } = await supabase
      .from("edition_counters")
      .select(
        "edition_id, people_count, startup_count, sponsor_count, campus_ambassador_count, updated_at, editions!inner(id, slug)",
      )
      .eq("editions.slug", editionSlug)
      .eq("editions.is_active", true)
      .single();

    if (counterError || !counter) {
      return jsonError(404, "counter_not_found", "Active counter row not found.");
    }

    const edition = Array.isArray(counter.editions)
      ? counter.editions[0]
      : counter.editions;

    if (!edition?.slug) {
      return jsonError(404, "edition_not_found", "Active edition not found.");
    }

    const payload: CounterPayload = {
      editionId: counter.edition_id,
      edition: edition.slug,
      people: counter.people_count,
      startups: counter.startup_count,
      sponsors: counter.sponsor_count,
      campusAmbassadors: counter.campus_ambassador_count,
      updatedAt: counter.updated_at,
    };

    return jsonOk(payload, {
      headers: {
        "cache-control": "public, s-maxage=3, stale-while-revalidate=30",
      },
    });
  } catch {
    return jsonError(
      500,
      "counter_error",
      "Could not load counters.",
    );
  }
}
