alter table public.repair_requests
  add column pickup_lat double precision,
  add column pickup_lng double precision,
  add column destination_lat double precision,
  add column destination_lng double precision,
  add constraint repair_requests_pickup_lat_range_check
    check (pickup_lat is null or pickup_lat between -90 and 90),
  add constraint repair_requests_pickup_lng_range_check
    check (pickup_lng is null or pickup_lng between -180 and 180),
  add constraint repair_requests_destination_lat_range_check
    check (destination_lat is null or destination_lat between -90 and 90),
  add constraint repair_requests_destination_lng_range_check
    check (destination_lng is null or destination_lng between -180 and 180);
