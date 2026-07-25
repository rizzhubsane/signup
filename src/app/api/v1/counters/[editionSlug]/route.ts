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

    const { data: edition, error: editionError } = await supabase
      .from("editions")
      .select("id, slug")
      .eq("slug", editionSlug)
      .eq("is_active", true)
      .single();

    if (editionError || !edition) {
      return jsonError(404, "edition_not_found", "Active edition not found.");
    }

    const { data: counter, error: counterError } = await supabase
      .from("edition_counters")
      .select(
        "people_count, startup_count, sponsor_count, campus_ambassador_count, updated_at",
      )
      .eq("edition_id", edition.id)
      .single();

    if (counterError || !counter) {
      return jsonError(404, "counter_not_found", "Counter row not found.");
    }

    const payload: CounterPayload = {
      editionId: edition.id,
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
  } catch (error) {
    return jsonError(
      500,
      "counter_error",
      error instanceof Error ? error.message : "Could not load counters.",
    );
  }
}
