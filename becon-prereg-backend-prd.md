# BECon Pre-Registration — Product, Frontend & Backend PRD

**Owner:** Rishabh (eDC Tech)  
**Status:** Draft v2  
**Scope:** Standalone pre-registration microsite, Supabase backend, realtime counters, and migration path into `becon.edciitd.com`

---

## 1. Product intent

BECon is eDC IIT Delhi's flagship entrepreneurship summit: a national-scale platform for founders, investors, builders, students, policymakers, and startup ecosystem partners. The pre-registration product should not feel like a generic form. It should feel like an early-access gateway into BECon.

The first version is intentionally minimal:

- A clean BECon logo/icon.
- A real-time credibility strip showing real counts.
- One primary `Pre-register` action.
- A polished modal flow that lets visitors register as an individual or startup.
- An optional campus ambassador application path after individual registration.

The experience should be simple on the surface and serious underneath: accurate data, low-latency reads, transactional writes, duplicate prevention, abuse controls, and a schema that survives future BECon editions.

---

## 2. Product principles

1. **Classy minimalism over visual noise.** The landing screen should feel premium and confident, not crowded.
2. **Real numbers only.** Counters must never be faked or hardcoded. If the count is zero, say so honestly or use supportive copy like "Be among the first."
3. **Conversion first.** The first form asks only for name, email, and phone. Startup details and campus ambassador interest come after intent is captured.
4. **Multi-edition from day one.** Every durable record is scoped to an edition so BECon'27 does not require a schema rewrite.
5. **Atomic counters.** Counter increments happen in the same transaction as the registration they represent.
6. **Frontend can move later.** The standalone microsite should be easy to migrate into the main BECon/eDC site because the backend contracts stay stable.

---

## 3. User journeys

### 3.1 Visitor journey

1. Visitor opens the standalone pre-registration link.
2. Visitor sees the BECon logo, counters, and a single `Pre-register` CTA.
3. Visitor clicks CTA and enters:
   - full name
   - email
   - contact number
4. Visitor chooses:
   - `Individual`
   - `Startup`
5. Individual registration completes immediately.
6. Individual registrant is offered an optional campus ambassador application.
7. Startup registrant enters startup details:
   - startup name
   - LinkedIn URL, optional
   - website URL, optional
   - about the startup, optional
8. Visitor sees a clean success state.

### 3.2 Organizer journey

1. Organizer can inspect registration counts without running full table scans.
2. Organizer can later search, filter, export, flag, and review records from an admin surface.
3. Organizer can separate attendees, startups, campus ambassador applicants, and sponsor leads.

---

## 4. Frontend requirements

### 4.1 Landing page

The first screen should contain only what matters:

- BECon mark/logo.
- Short line of supporting copy, optional.
- Real counters:
  - people pre-registered
  - startups registered
  - sponsors/partners registered or interested
- Primary `Pre-register` button.

The visual direction should be:

- dark or deep neutral background
- elegant typography
- subtle gradient/glow
- minimal animation
- mobile-first spacing
- high contrast and accessible form states

Avoid heavy 3D assets, large video, unnecessary sections, or anything that slows the first load.

### 4.2 Modal flow

The pre-registration flow should run in a modal/dialog so the page remains focused.

Steps:

1. `identity`
   - full name
   - email
   - phone
2. `type`
   - individual
   - startup
3. `startup-details`, only for startup
   - startup name
   - LinkedIn URL, optional
   - website URL, optional
   - about, optional
4. `campus-ambassador`, optional after individual registration
5. `success`

The modal must support:

- keyboard navigation
- escape-to-close before submit
- validation errors near fields
- duplicate email handling
- loading state during submit
- clear recovery if the network fails

---

## 5. Data model

All tables are edition-scoped unless they are lookup/security tables. Supabase Postgres is the source of truth.

### `editions`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `slug` | text, unique | e.g. `becon-26` |
| `name` | text | e.g. `BECon'26` |
| `is_active` | boolean | active edition accepts public registrations |
| `starts_at` / `ends_at` | timestamptz | optional |
| `created_at` | timestamptz | |

### `registrants`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `edition_id` | uuid, FK | |
| `full_name` | text | |
| `email` | citext | unique per edition |
| `phone` | text | normalize where possible |
| `type` | enum | `individual` or `startup` |
| `source` | text | default `standalone_prereg` |
| `status` | enum | `registered`, `flagged`, `removed` |
| `utm_source` / `utm_medium` / `utm_campaign` | text | optional campaign attribution |
| `referral_code` | text | optional ambassador/referral attribution |
| `consent_version` | text | e.g. `prereg-v1` |
| `consented_at` | timestamptz | set on submit |
| `ip_hash` | text | hashed IP only, never raw |
| `created_at` | timestamptz | |

### `startup_profiles`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `registrant_id` | uuid, FK, unique | one startup profile per registrant |
| `edition_id` | uuid, FK | denormalized for filtering |
| `startup_name` | text | required for startup path |
| `linkedin_url` | text | optional |
| `website_url` | text | optional |
| `about` | text | optional |
| `verification_status` | enum | `pending`, `verified`, `rejected` |
| `updated_at` | timestamptz | |

### `campus_ambassador_applications`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `registrant_id` | uuid, FK, unique | one CA application per registrant |
| `edition_id` | uuid, FK | |
| `college` | text | optional in v1, useful for selection later |
| `city` | text | optional |
| `year_of_study` | text | optional |
| `social_url` | text | optional |
| `motivation` | text | optional |
| `status` | enum | `applied`, `shortlisted`, `accepted`, `rejected` |
| `created_at` | timestamptz | |

### `sponsor_registrations`

Sponsor count must come from real records. If sponsor intake is not live, the sponsor counter should show `0` or be labelled as `partner interest` only after an actual lead form exists.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `edition_id` | uuid, FK | |
| `organization_name` | text | |
| `contact_name` | text | |
| `email` | citext | |
| `phone` | text | optional |
| `status` | enum | `interested`, `contacted`, `confirmed`, `rejected` |
| `created_at` | timestamptz | |

### `edition_counters`

| Field | Type | Notes |
| --- | --- | --- |
| `edition_id` | uuid, PK, FK | one row per edition |
| `people_count` | integer | all registered people |
| `startup_count` | integer | startup registrants |
| `campus_ambassador_count` | integer | CA applicants |
| `sponsor_count` | integer | real sponsor records only |
| `updated_at` | timestamptz | |

### `admin_actions`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `actor_id` | uuid | Supabase auth user id |
| `action` | text | e.g. `flag_registrant` |
| `target_table` | text | |
| `target_id` | uuid | |
| `reason` | text | |
| `created_at` | timestamptz | |

---

## 6. API contracts

All public APIs live under `/api/v1`.

### `GET /api/v1/counters/:edition_slug`

Returns cached public counters.

```json
{
  "edition": "becon-26",
  "people": 1240,
  "startups": 128,
  "sponsors": 0,
  "campusAmbassadors": 42,
  "updatedAt": "2026-07-25T17:00:00.000Z"
}
```

### `POST /api/v1/registrants`

Creates an individual or startup registration.

Request:

```json
{
  "editionSlug": "becon-26",
  "fullName": "Rishabh Sain",
  "email": "rishabh@example.com",
  "phone": "+919999999999",
  "type": "startup",
  "startup": {
    "name": "Acme AI",
    "linkedinUrl": "https://linkedin.com/company/acme",
    "websiteUrl": "https://acme.example",
    "about": "Building AI tools for student founders."
  },
  "consentVersion": "prereg-v1",
  "turnstileToken": "optional-client-token"
}
```

Response:

```json
{
  "registrantId": "uuid",
  "type": "startup",
  "status": "registered"
}
```

Errors:

- `400` validation error
- `409` duplicate email for the edition
- `429` rate-limited
- `500` unexpected server error

### `POST /api/v1/campus-ambassador/apply`

Creates an optional CA application for an existing individual registrant.

Request:

```json
{
  "registrantId": "uuid",
  "college": "IIT Delhi",
  "city": "Delhi",
  "yearOfStudy": "2nd year",
  "socialUrl": "https://linkedin.com/in/example",
  "motivation": "I want to bring builders from my campus to BECon."
}
```

---

## 7. Supabase strategy

### 7.1 Writes

Use a Postgres RPC function for registration creation so the following happen atomically:

1. Resolve active edition by slug.
2. Insert registrant.
3. Insert startup profile when `type = startup`.
4. Increment `edition_counters.people_count`.
5. Increment `edition_counters.startup_count` when needed.
6. Return the registrant id.

Campus ambassador applications use a second RPC:

1. Validate that the registrant exists.
2. Validate that the registrant type is `individual`.
3. Insert application.
4. Increment `edition_counters.campus_ambassador_count`.

### 7.2 Reads

Counter reads query `edition_counters` by edition slug. They never run `COUNT(*)` on the registrations table during public traffic.

### 7.3 Realtime

The frontend may subscribe to Supabase Realtime updates on `edition_counters`. If realtime is disconnected, the UI falls back to polling the counter API every 10-15 seconds.

---

## 8. Security, privacy, and abuse controls

- Use Supabase service role only in server-side API routes.
- Never expose service role keys to the browser.
- Use RLS so anon clients can read counters but cannot write registrations directly.
- Use Cloudflare Turnstile before large public promotion.
- Apply IP-based rate limiting on public POST routes.
- Store only hashed IPs for abuse signals.
- Add consent copy near submit: "By pre-registering, you agree to be contacted by eDC IIT Delhi about BECon."
- Support soft removal via `status = removed`.
- Log admin moderation actions.

---

## 9. Production readiness checklist

- Supabase project configured with migrations applied.
- Active edition seeded.
- Environment variables configured in local and hosting environments.
- Vercel or equivalent deployment connected.
- Turnstile secret configured before public launch.
- Counter endpoint verified under load.
- Duplicate email race tested.
- Registration RPC tested for individual and startup paths.
- CA application RPC tested for idempotency and duplicate submissions.
- Privacy copy reviewed.
- Export/admin scope confirmed before organizers need it.

---

## 10. Acceptance criteria

- The page opens fast and shows a clean BECon-first visual.
- The only primary action is `Pre-register`.
- People can submit name, email, and phone.
- People can choose individual or startup.
- Startup LinkedIn, website, and about fields are optional.
- Individual registrants can optionally apply for the campus ambassador program.
- Public counters are real and accurate.
- Duplicate registrations are blocked by the database.
- All writes are edition-scoped.
- The backend can support future BECon editions without schema rewrite.
