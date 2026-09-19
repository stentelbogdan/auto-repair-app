create extension if not exists postgis with schema extensions;

create table public.workshop_service_areas (
  workshop_id uuid primary key
    references public.profiles(id) on delete cascade,
  location extensions.geography(Point, 4326) not null,
  locality text not null,
  postal_code text null,
  country_code text not null,
  radius_km integer null,
  geocoded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workshop_service_areas_locality_not_blank_check
    check (btrim(locality) <> ''),
  constraint workshop_service_areas_country_code_not_blank_check
    check (btrim(country_code) <> ''),
  constraint workshop_service_areas_radius_km_check
    check (radius_km is null or radius_km between 1 and 1000)
);

create index workshop_service_areas_location_gist_idx
  on public.workshop_service_areas
  using gist (location);

alter table public.workshop_service_areas enable row level security;

create policy "Workshops can view own service area"
on public.workshop_service_areas
for select
to authenticated
using (
  workshop_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  )
);

create policy "Workshops can insert own service area"
on public.workshop_service_areas
for insert
to authenticated
with check (
  workshop_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  )
);

create policy "Workshops can update own service area"
on public.workshop_service_areas
for update
to authenticated
using (
  workshop_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  )
)
with check (
  workshop_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  )
);

create policy "Workshops can delete own service area"
on public.workshop_service_areas
for delete
to authenticated
using (
  workshop_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  )
);

revoke all on table public.workshop_service_areas
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.workshop_service_areas
  to authenticated;
grant all on table public.workshop_service_areas
  to postgres, service_role;

create table public.repair_request_discovery_locations (
  request_id uuid primary key
    references public.repair_requests(id) on delete cascade,
  location extensions.geography(Point, 4326) not null,
  locality text not null,
  postal_code text null,
  country_code text not null,
  source text not null,
  geocoded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repair_request_discovery_locations_locality_not_blank_check
    check (btrim(locality) <> ''),
  constraint repair_request_discovery_locations_country_code_not_blank_check
    check (btrim(country_code) <> ''),
  constraint repair_request_discovery_locations_source_not_blank_check
    check (btrim(source) <> '')
);

create index repair_request_discovery_locations_location_gist_idx
  on public.repair_request_discovery_locations
  using gist (location);

alter table public.repair_request_discovery_locations
  enable row level security;

revoke all on table public.repair_request_discovery_locations
  from public, anon, authenticated;
grant all on table public.repair_request_discovery_locations
  to postgres, service_role;
