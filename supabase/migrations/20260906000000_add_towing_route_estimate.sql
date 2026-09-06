alter table public.repair_requests
  add column route_distance_meters double precision,
  add column route_duration_seconds double precision,
  add constraint repair_requests_route_distance_meters_range_check
    check (route_distance_meters is null or route_distance_meters >= 0),
  add constraint repair_requests_route_duration_seconds_range_check
    check (route_duration_seconds is null or route_duration_seconds >= 0);
