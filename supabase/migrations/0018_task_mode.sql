-- Task mode (owner decision 2026-11-04): with task mode on in a chat, approval cards are approved automatically in code,
-- except payments and deletes, which still wait for the user. Every auto-approved action is logged with auto = true.
alter table public.conversations add column if not exists task_mode boolean not null default false;
alter table public.approval_requests add column if not exists auto boolean not null default false;

-- The guard from 0006, plus: an auto-approval made by the server (service role, no auth.uid()) is recorded as decided
-- by the owner of the row, and auto can only be set together with approving a pending request (never cleared later).
create or replace function public.approval_requests_guard() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id
     or new.action_type is distinct from old.action_type
     or new.payload is distinct from old.payload
     or new.summary is distinct from old.summary
     or new.destination is distinct from old.destination
     or new.created_at is distinct from old.created_at then
    raise exception 'approval request details are immutable';
  end if;
  if old.auto and not new.auto then
    raise exception 'auto flag cannot be cleared';
  end if;
  if new.auto and not old.auto and not (old.status = 'pending' and new.status = 'approved') then
    raise exception 'auto is only set when approving a pending request';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending'   and new.status in ('approved','rejected','cancelled'))
    or (old.status = 'approved'  and new.status in ('executing','cancelled'))
    or (old.status = 'executing' and new.status in ('executed','failed'))
    or (old.status = 'failed'    and new.status in ('approved','cancelled'))
  ) then
    raise exception 'invalid approval transition % -> %', old.status, new.status;
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.decided_by := coalesce(auth.uid(), case when new.auto then new.user_id end);
    new.decided_at := now();
  elsif new.status in ('rejected','cancelled') and old.status is distinct from new.status then
    new.decided_by := auth.uid();
    new.decided_at := now();
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
