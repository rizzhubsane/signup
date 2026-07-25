# BECon Pre-Registration

Standalone pre-registration microsite for BECon by eDC IIT Delhi.

The product is intentionally minimal on the surface: a BECon mark, real counters, and one `Pre-register` CTA. Underneath, it uses Supabase Postgres, transactional registration RPCs, edition-scoped data, duplicate prevention, and a cheap counter read model.

## Stack

- Next.js App Router
- TypeScript
- Supabase Postgres
- Supabase Realtime for counter updates
- Zod validation
- Optional Cloudflare Turnstile

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env.local
```

3. Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `IP_HASH_SECRET`
- `NEXT_PUBLIC_ACTIVE_EDITION_SLUG`

4. Apply the Supabase migration in `supabase/migrations/0001_becon_prereg_schema.sql`.

5. Run the app:

```bash
npm run dev
```

## Environment Variables

`SUPABASE_SERVICE_ROLE_KEY` must only exist on the server. Never expose it in browser code.

`TURNSTILE_SECRET_KEY` is optional locally. Once set, public POST routes require a valid Turnstile token.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` enables the frontend Turnstile widget.

## API Routes

- `GET /api/v1/counters/:editionSlug`
- `POST /api/v1/registrants`
- `POST /api/v1/campus-ambassador/apply`

All writes are validated with Zod, rate-limited by hashed IP, and executed server-side through Supabase RPCs.

## Data Guarantees

- Duplicate emails are blocked per edition in Postgres.
- Individual/startup registration increments happen in the same database transaction as the insert.
- Campus ambassador counts increment only when an application record is created.
- Sponsor counts come from actual sponsor lead records, not dummy values.
- Public counter reads use `edition_counters`, not `COUNT(*)`.

## Production Checklist

- Apply migrations to the production Supabase project.
- Confirm `becon-26` is the active edition.
- Set all production environment variables.
- Configure Cloudflare Turnstile before public launch.
- Verify Supabase Realtime is enabled for `edition_counters`.
- Run `npm run typecheck`, `npm run lint`, and `npm run build`.
- Test duplicate registration behavior with concurrent submissions.
- Test individual, startup, and campus ambassador flows.
- Confirm sponsor counter copy is acceptable if no sponsor intake is public yet.
- Review privacy/consent copy with the organizing team.

## Scaling Notes

The landing page is static and edge-cacheable. The counter endpoint reads one small row and returns short-lived cache headers. Public write routes are intentionally thin and push consistency into Postgres RPCs so launch-day spikes do not create application-level race conditions.
