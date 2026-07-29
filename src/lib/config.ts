export const ACTIVE_EDITION_SLUG =
  process.env.NEXT_PUBLIC_ACTIVE_EDITION_SLUG?.trim() || "becon-26";

export const CONSENT_VERSION = "prereg-v1";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

/** Display floor — live DB counts are added on top of these. */
export const COUNTER_BASE = {
  people: 64,
  startups: 38,
} as const;
