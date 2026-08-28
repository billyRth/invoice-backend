# Ptas

A rental app for Phnom Penh, in one HTML file with no build step.

## The idea

Every rental page in Cambodia has the same problem: nobody takes a listing down
when the room is gone. You call ten numbers and seven are already rented. The
answer here is not moderation, it is money — a listing costs $1 a month, and
paying is never automatic, so a landlord who has stopped caring stops paying
and the listing pauses itself.

Three things follow from that, and all three are enforced in the database
rather than in this file:

* A listing is visible only while somebody is paying for it.
* Recording a tenancy takes the room off the market, so the landlord never has
  to remember to unlist it.
* Anything unconfirmed for fourteen days sinks below everything else — below
  cheaper rooms, when the renter asked for cheapest first.

See `supabase/README.md` for how those are written down.

## Running it

Open `ptas.html`. With no network it shows eleven sample listings and says so;
everything except real sign-in still works, so it demonstrates on a phone with
no signal. Connected, it reads and writes the real database.

## Deploying

Drag `rental-app/` onto https://app.netlify.com/drop. The redirect in
`netlify.toml` serves `ptas.html` at `/`.

For a host that needs a literal `index.html`, run `npm run build:app` first —
`index.html` is generated, not checked in, because a checked-in copy went stale
without anyone noticing.

## Checking it

```sh
npm run audit:app     # contrast, touch targets, 360px overflow, every theme
npm run test:app      # the app against the real schema; see test/README.md
```

## What is not built yet

Sending the sign-in code needs an SMS provider on the Supabase project. A map
pin is the centre of the district until somebody drags it. Approving a payment
is a SQL statement, not a screen.
