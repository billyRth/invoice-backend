-- Ptas — where a new listing goes on the map
--
-- The posting flow asks for a district and a landmark, not a pin. Asking a
-- landlord to drag a map marker on a phone, before they have seen a single
-- renter, is a step most of them will not finish.
--
-- So a new listing starts at the centre of its district and says so. That is
-- honest: it is roughly right, and the app can draw it differently from a pin
-- somebody actually placed. What it must never do is pretend a centroid is an
-- address.

alter table districts
  add column lat double precision,
  add column lng double precision;

update districts set lat = v.lat, lng = v.lng from (values
  ('chamkarmon',    11.5450, 104.9210),
  ('daunpenh',      11.5700, 104.9250),
  ('prampirmakara', 11.5620, 104.9130),
  ('toulkork',      11.5780, 104.8900),
  ('dangkao',       11.4820, 104.8600),
  ('meanchey',      11.5150, 104.9350),
  ('russeykeo',     11.6070, 104.9060),
  ('sensok',        11.5960, 104.8720),
  ('pousenchey',    11.5350, 104.8250),
  ('chroychangvar', 11.5900, 104.9380),
  ('prekpnov',      11.6650, 104.8600),
  ('chbarampov',    11.5250, 104.9560),
  ('boengkengkang', 11.5460, 104.9190),
  ('kamboul',       11.4900, 104.7900)
) as v(code, lat, lng) where districts.code = v.code;

alter table districts
  alter column lat set not null,
  alter column lng set not null;

-- False means "this is the middle of the district, not the building". The app
-- draws those pins differently and says so, rather than quietly implying a
-- precision nobody entered.
alter table listings
  add column location_exact boolean not null default false;

-- Everything seeded so far has real coordinates taken from the prototype.
update listings set location_exact = true;
