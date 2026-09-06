alter table public.repair_requests
  add column route_paths jsonb null;

alter table public.repair_requests
  add constraint repair_requests_route_paths_array_check
  check (
    route_paths is null
    or jsonb_typeof(route_paths) = 'array'
  );
