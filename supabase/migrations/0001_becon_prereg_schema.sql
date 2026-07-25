create extension if not exists "pgcrypto";
create extension if not exists "citext";

create type public.registrant_type as enum ('individual', 'startup');
create type public.registrant_status as enum ('registered', 'flagged', 'removed');
create type public.campus_ambassador_status as enum ('applied', 'shortlisted', 'accepted', 'rejected');
create type public.startup_verification_status as enum ('pending', 'verified', 'rejected');
create type public.sponsor_status as enum ('interested', 'contacted', 'confirmed', 'rejected');

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index editions_only_one_active_idx
  on public.editions (is_active)
  where is_active;

create table public.registrants (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete restrict,
  full_name text not null,
  email citext not null,
  phone text not null,
  type public.registrant_type not null,
  source text not null default 'standalone_prereg',
  status public.registrant_status not null default 'registered',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referral_code text,
  consent_version text not null default 'prereg-v1',
  consented_at timestamptz not null default now(),
  ip_hash text,
  created_at timestamptz not null default now(),
  constraint registrants_full_name_not_blank check (length(trim(full_name)) >= 2),
  constraint registrants_phone_not_blank check (length(trim(phone)) >= 7),
  constraint registrants_email_per_edition_unique unique (edition_id, email)
);

create index registrants_edition_created_at_idx
  on public.registrants (edition_id, created_at desc);

create index registrants_edition_type_idx
  on public.registrants (edition_id, type);

create index registrants_referral_code_idx
  on public.registrants (referral_code)
  where referral_code is not null;

create table public.startup_profiles (
  id uuid primary key default gen_random_uuid(),
  registrant_id uuid not null unique references public.registrants (id) on delete cascade,
  edition_id uuid not null references public.editions (id) on delete restrict,
  startup_name text not null,
  linkedin_url text,
  website_url text,
  about text,
  verification_status public.startup_verification_status not null default 'pending',
  updated_at timestamptz not null default now(),
  constraint startup_name_not_blank check (length(trim(startup_name)) >= 2)
);

create index startup_profiles_edition_idx
  on public.startup_profiles (edition_id);

create table public.campus_ambassador_applications (
  id uuid primary key default gen_random_uuid(),
  registrant_id uuid not null unique references public.registrants (id) on delete cascade,
  edition_id uuid not null references public.editions (id) on delete restrict,
  college text,
  city text,
  year_of_study text,
  social_url text,
  motivation text,
  status public.campus_ambassador_status not null default 'applied',
  created_at timestamptz not null default now()
);

create index campus_ambassador_applications_edition_idx
  on public.campus_ambassador_applications (edition_id, created_at desc);

create table public.sponsor_registrations (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete restrict,
  organization_name text not null,
  contact_name text not null,
  email citext not null,
  phone text,
  status public.sponsor_status not null default 'interested',
  created_at timestamptz not null default now(),
  constraint sponsor_email_per_edition_unique unique (edition_id, email)
);

create index sponsor_registrations_edition_status_idx
  on public.sponsor_registrations (edition_id, status);

create table public.edition_counters (
  edition_id uuid primary key references public.editions (id) on delete cascade,
  people_count integer not null default 0 check (people_count >= 0),
  startup_count integer not null default 0 check (startup_count >= 0),
  campus_ambassador_count integer not null default 0 check (campus_ambassador_count >= 0),
  sponsor_count integer not null default 0 check (sponsor_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_table text not null,
  target_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);

create table public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx
  on public.rate_limit_events (route, ip_hash, created_at desc);

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'organizer');
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger startup_profiles_touch_updated_at
before update on public.startup_profiles
for each row execute function public.touch_updated_at();

create or replace function public.ensure_edition_counter()
returns trigger
language plpgsql
as $$
begin
  insert into public.edition_counters (edition_id)
  values (new.id)
  on conflict (edition_id) do nothing;
  return new;
end;
$$;

create trigger editions_create_counter
after insert on public.editions
for each row execute function public.ensure_edition_counter();

create or replace function public.register_preregistrant(
  p_edition_slug text,
  p_full_name text,
  p_email citext,
  p_phone text,
  p_type public.registrant_type,
  p_startup jsonb default null,
  p_source text default 'standalone_prereg',
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_referral_code text default null,
  p_consent_version text default 'prereg-v1',
  p_ip_hash text default null
)
returns table (registrant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edition_id uuid;
  v_registrant_id uuid;
  v_startup_name text;
begin
  select id
    into v_edition_id
    from public.editions
    where slug = p_edition_slug
      and is_active = true;

  if v_edition_id is null then
    raise exception 'active edition not found'
      using errcode = 'P0002';
  end if;

  if p_type = 'startup' then
    v_startup_name := nullif(trim(coalesce(p_startup ->> 'name', '')), '');

    if v_startup_name is null then
      raise exception 'startup name is required'
        using errcode = '23514';
    end if;
  end if;

  insert into public.registrants (
    edition_id,
    full_name,
    email,
    phone,
    type,
    source,
    utm_source,
    utm_medium,
    utm_campaign,
    referral_code,
    consent_version,
    consented_at,
    ip_hash
  )
  values (
    v_edition_id,
    trim(p_full_name),
    lower(trim(p_email::text))::citext,
    trim(p_phone),
    p_type,
    coalesce(nullif(trim(p_source), ''), 'standalone_prereg'),
    nullif(trim(coalesce(p_utm_source, '')), ''),
    nullif(trim(coalesce(p_utm_medium, '')), ''),
    nullif(trim(coalesce(p_utm_campaign, '')), ''),
    nullif(trim(coalesce(p_referral_code, '')), ''),
    coalesce(nullif(trim(p_consent_version), ''), 'prereg-v1'),
    now(),
    p_ip_hash
  )
  returning id into v_registrant_id;

  if p_type = 'startup' then
    insert into public.startup_profiles (
      registrant_id,
      edition_id,
      startup_name,
      linkedin_url,
      website_url,
      about
    )
    values (
      v_registrant_id,
      v_edition_id,
      v_startup_name,
      nullif(trim(coalesce(p_startup ->> 'linkedinUrl', '')), ''),
      nullif(trim(coalesce(p_startup ->> 'websiteUrl', '')), ''),
      nullif(trim(coalesce(p_startup ->> 'about', '')), '')
    );
  end if;

  update public.edition_counters
    set people_count = people_count + 1,
        startup_count = startup_count + case when p_type = 'startup' then 1 else 0 end,
        updated_at = now()
    where edition_id = v_edition_id;

  return query select v_registrant_id;
end;
$$;

create or replace function public.apply_campus_ambassador(
  p_registrant_id uuid,
  p_college text default null,
  p_city text default null,
  p_year_of_study text default null,
  p_social_url text default null,
  p_motivation text default null
)
returns table (application_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edition_id uuid;
  v_type public.registrant_type;
  v_application_id uuid;
begin
  select edition_id, type
    into v_edition_id, v_type
    from public.registrants
    where id = p_registrant_id
      and status = 'registered';

  if v_edition_id is null then
    raise exception 'registrant not found'
      using errcode = 'P0002';
  end if;

  if v_type <> 'individual' then
    raise exception 'campus ambassador applications require individual registrants'
      using errcode = '23514';
  end if;

  insert into public.campus_ambassador_applications (
    registrant_id,
    edition_id,
    college,
    city,
    year_of_study,
    social_url,
    motivation
  )
  values (
    p_registrant_id,
    v_edition_id,
    nullif(trim(coalesce(p_college, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_year_of_study, '')), ''),
    nullif(trim(coalesce(p_social_url, '')), ''),
    nullif(trim(coalesce(p_motivation, '')), '')
  )
  returning id into v_application_id;

  update public.edition_counters
    set campus_ambassador_count = campus_ambassador_count + 1,
        updated_at = now()
    where edition_id = v_edition_id;

  return query select v_application_id;
end;
$$;

create or replace function public.update_sponsor_counter()
returns trigger
language plpgsql
as $$
declare
  v_edition_id uuid;
  v_delta integer := 0;
begin
  if tg_op = 'INSERT' and new.status <> 'rejected' then
    v_edition_id := new.edition_id;
    v_delta := 1;
  elsif tg_op = 'UPDATE' then
    v_edition_id := new.edition_id;

    if old.status = 'rejected' and new.status <> 'rejected' then
      v_delta := 1;
    elsif old.status <> 'rejected' and new.status = 'rejected' then
      v_delta := -1;
    end if;
  elsif tg_op = 'DELETE' and old.status <> 'rejected' then
    v_edition_id := old.edition_id;
    v_delta := -1;
  end if;

  if v_delta <> 0 then
    update public.edition_counters
      set sponsor_count = greatest(0, sponsor_count + v_delta),
          updated_at = now()
      where edition_id = v_edition_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger sponsor_registrations_counter_insert
after insert on public.sponsor_registrations
for each row execute function public.update_sponsor_counter();

create trigger sponsor_registrations_counter_update
after update of status on public.sponsor_registrations
for each row execute function public.update_sponsor_counter();

create trigger sponsor_registrations_counter_delete
after delete on public.sponsor_registrations
for each row execute function public.update_sponsor_counter();

alter table public.editions enable row level security;
alter table public.registrants enable row level security;
alter table public.startup_profiles enable row level security;
alter table public.campus_ambassador_applications enable row level security;
alter table public.sponsor_registrations enable row level security;
alter table public.edition_counters enable row level security;
alter table public.admin_actions enable row level security;
alter table public.rate_limit_events enable row level security;

create policy "Public can read active edition counters"
on public.edition_counters
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.editions
    where editions.id = edition_counters.edition_id
      and editions.is_active = true
  )
);

create policy "Public can read active edition metadata"
on public.editions
for select
to anon, authenticated
using (is_active = true);

create policy "Authenticated admins can read registrants"
on public.registrants
for select
to authenticated
using (public.is_admin());

create policy "Authenticated admins can read startup profiles"
on public.startup_profiles
for select
to authenticated
using (public.is_admin());

create policy "Authenticated admins can read campus ambassador applications"
on public.campus_ambassador_applications
for select
to authenticated
using (public.is_admin());

create policy "Authenticated admins can read sponsor registrations"
on public.sponsor_registrations
for select
to authenticated
using (public.is_admin());

revoke execute on function public.register_preregistrant(
  text,
  text,
  citext,
  text,
  public.registrant_type,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

revoke execute on function public.apply_campus_ambassador(
  uuid,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.register_preregistrant(
  text,
  text,
  citext,
  text,
  public.registrant_type,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

grant execute on function public.apply_campus_ambassador(
  uuid,
  text,
  text,
  text,
  text,
  text
) to service_role;

insert into public.editions (slug, name, is_active)
values ('becon-26', 'BECon''26', true)
on conflict (slug) do update
  set name = excluded.name,
      is_active = excluded.is_active;

-- Supabase Realtime uses this publication. If your project already manages it,
-- this statement is safe to remove before applying the migration manually.
alter publication supabase_realtime add table public.edition_counters;
