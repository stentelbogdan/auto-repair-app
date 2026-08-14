create table public.conversation_inbox_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.repair_requests(id) on delete cascade,
  offer_id uuid null references public.repair_offers(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  constraint conversation_inbox_states_user_conversation_key
    unique nulls not distinct (user_id, request_id, offer_id)
);

create or replace function public.set_conversation_inbox_hidden_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.hidden_at = now();
  return new;
end;
$$;

create trigger set_conversation_inbox_hidden_at
before insert or update on public.conversation_inbox_states
for each row
execute function public.set_conversation_inbox_hidden_at();

revoke all on function public.set_conversation_inbox_hidden_at()
from public;

alter table public.conversation_inbox_states enable row level security;

create policy "Users can read their own conversation inbox states"
on public.conversation_inbox_states
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.repair_requests request
    where request.id = conversation_inbox_states.request_id
      and (
        (
          conversation_inbox_states.offer_id is null
          and request.request_type = 'direct_message'
          and (
            request.user_id = auth.uid()
            or request.target_workshop_id = auth.uid()
          )
        )
        or (
          conversation_inbox_states.offer_id is not null
          and exists (
            select 1
            from public.repair_offers offer
            where offer.id = conversation_inbox_states.offer_id
              and offer.request_id = conversation_inbox_states.request_id
              and (
                request.user_id = auth.uid()
                or offer.workshop_user_id = auth.uid()
              )
          )
        )
      )
  )
);

create policy "Users can insert their own conversation inbox states"
on public.conversation_inbox_states
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.repair_requests request
    where request.id = conversation_inbox_states.request_id
      and (
        (
          conversation_inbox_states.offer_id is null
          and request.request_type = 'direct_message'
          and (
            request.user_id = auth.uid()
            or request.target_workshop_id = auth.uid()
          )
        )
        or (
          conversation_inbox_states.offer_id is not null
          and exists (
            select 1
            from public.repair_offers offer
            where offer.id = conversation_inbox_states.offer_id
              and offer.request_id = conversation_inbox_states.request_id
              and (
                request.user_id = auth.uid()
                or offer.workshop_user_id = auth.uid()
              )
          )
        )
      )
  )
);

create policy "Users can update their own conversation inbox states"
on public.conversation_inbox_states
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.repair_requests request
    where request.id = conversation_inbox_states.request_id
      and (
        (
          conversation_inbox_states.offer_id is null
          and request.request_type = 'direct_message'
          and (
            request.user_id = auth.uid()
            or request.target_workshop_id = auth.uid()
          )
        )
        or (
          conversation_inbox_states.offer_id is not null
          and exists (
            select 1
            from public.repair_offers offer
            where offer.id = conversation_inbox_states.offer_id
              and offer.request_id = conversation_inbox_states.request_id
              and (
                request.user_id = auth.uid()
                or offer.workshop_user_id = auth.uid()
              )
          )
        )
      )
  )
);

create policy "Users can delete their own conversation inbox states"
on public.conversation_inbox_states
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete
on public.conversation_inbox_states
to authenticated;

create or replace function public.hide_conversation_from_inbox(
  p_request_id uuid,
  p_offer_id uuid default null
)
returns public.conversation_inbox_states
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hidden_state public.conversation_inbox_states;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.conversation_inbox_states (
    user_id,
    request_id,
    offer_id,
    hidden_at
  )
  values (
    auth.uid(),
    p_request_id,
    p_offer_id,
    now()
  )
  on conflict (user_id, request_id, offer_id)
  do update set hidden_at = now()
  returning * into hidden_state;

  return hidden_state;
end;
$$;

revoke all on function public.hide_conversation_from_inbox(uuid, uuid)
from public;

grant execute on function public.hide_conversation_from_inbox(uuid, uuid)
to authenticated;
