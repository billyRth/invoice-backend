-- Ptas — tell the landlord what happened to their money
--
-- notifications already allows 'payment_approved' and 'payment_rejected', and
-- the notify function has been carrying Khmer wording for both since it was
-- written. Nothing ever enqueued either one, so those two branches were dead
-- code that read as a finished feature.
--
-- It matters more than the other messages. A landlord who has paid $1 and
-- uploaded a receipt is now waiting on a person to look at it, with no idea
-- how long that takes. Silence there is the difference between "the app is
-- slow" and "the app took my money".

create or replace function approve_payment_order(p_order uuid, p_reference text default null)
returns listings
language plpgsql security definer set search_path = public as $$
declare
  o payment_orders;
  l listings;
  from_ts timestamptz;
begin
  if not is_admin() then raise exception 'not an admin'; end if;

  select * into o from payment_orders where id = p_order for update;
  if o.id is null then raise exception 'no such order'; end if;
  if o.state = 'approved' then
    select * into l from listings where id = o.listing_id;
    return l;                                  -- idempotent: double-tap is safe
  end if;

  select * into l from listings where id = o.listing_id for update;
  from_ts := greatest(coalesce(l.paid_until, now()), now());

  insert into listing_periods (listing_id, paid_by, amount_usd, method, reference, starts_at, ends_at)
  values (o.listing_id, o.created_by, o.amount_usd, 'khqr',
          coalesce(p_reference, o.order_code),
          from_ts, from_ts + (o.months || ' months')::interval);

  update payment_orders
     set state = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_order;

  update listings
     set paid_until = from_ts + (o.months || ' months')::interval,
         status = case when status in ('draft','trial','paused') then 'live' else status end,
         last_confirmed_at = now()
   where id = o.listing_id
  returning * into l;

  delete from reports where listing_id = o.listing_id;

  -- Keyed on the order, not the listing: a landlord paying for a second month
  -- is a second thing worth hearing about.
  perform enqueue(o.created_by, 'payment_approved',
                  jsonb_build_object('listing_id', l.id, 'title', l.title,
                                     'order_code', o.order_code,
                                     'paid_until', l.paid_until),
                  'approved:' || o.id);
  return l;
end $$;

create or replace function reject_payment_order(p_order uuid, p_reason text)
returns payment_orders
language plpgsql security definer set search_path = public as $$
declare
  o payment_orders;
  l listings;
begin
  if not is_admin() then raise exception 'not an admin'; end if;
  update payment_orders
     set state = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = p_reason
   where id = p_order and state <> 'approved'
  returning * into o;
  if o.id is null then raise exception 'no such open order'; end if;

  select * into l from listings where id = o.listing_id;

  -- Rejection is the message that must never go missing. Somebody has paid, or
  -- believes they have, and is waiting for a listing that is not going to
  -- appear. The reason travels with it so they can fix it rather than guess.
  perform enqueue(o.created_by, 'payment_rejected',
                  jsonb_build_object('listing_id', l.id, 'title', l.title,
                                     'order_code', o.order_code,
                                     'reason', p_reason),
                  'rejected:' || o.id || ':' || o.decided_at);
  return o;
end $$;

grant execute on function approve_payment_order(uuid, text) to authenticated;
grant execute on function reject_payment_order(uuid, text)  to authenticated;
