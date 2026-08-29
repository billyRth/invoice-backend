-- Ptas — a tenant can read the room they live in
--
-- listings is readable in exactly two situations: it is on the market, or you
-- own it. Recording a tenancy takes the room OFF the market, so the moment the
-- record exists the tenant loses sight of the very listing their tenancy
-- points at. Their Currently Renting screen could read the tenancy row and
-- then not say which room it was for.
--
-- It reads like an edge case and it is the main path: the screen exists only
-- for people in exactly this state.
--
-- Two details that the first attempt got wrong, both worth stating:
--
--   The policy is scoped `to authenticated`. Written unscoped, Postgres
--   evaluates it for anon too, and the subquery then needs anon to hold SELECT
--   on tenancies - so every anonymous listing read failed with "permission
--   denied for table tenancies". A signed-out visitor is never a party to a
--   tenancy, so the policy has no business being consulted for them.
--
--   The lookup goes through a SECURITY DEFINER function rather than an inline
--   subquery, for the same reason is_admin() does: a policy runs with the
--   caller's privileges, and requiring every reader of `listings` to also hold
--   rights on `tenancies` couples two tables that should stay independent.

create or replace function in_tenancy(p_listing uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tenancies t
                  where t.listing_id = p_listing
                    and t.ended_at is null
                    and (t.tenant_id = auth.uid() or t.landlord_id = auth.uid()));
$$;

grant execute on function in_tenancy(uuid) to authenticated;

create policy listings_tenant_read on listings for select
  to authenticated
  using (in_tenancy(id));
