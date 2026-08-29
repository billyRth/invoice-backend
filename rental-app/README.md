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

## Sign-in checks nothing yet

`PTAS.devAuth` is `true`, so a phone number is taken at its word: the app calls
the `dev-signin` edge function, which maps the number onto an ordinary account
and hands back a real session. Anyone can sign in as anyone. The gate says so.

Everything downstream is real — a real token, real `auth.uid()`, real row level
security — so the only missing piece is proof that the number belongs to
whoever typed it. Turning that on is one flag: connect Twilio to the Supabase
project (about $0.03 a code, and only landlords ever need one), set `devAuth`
to `false`, and delete the function. The OTP path and the code step in the gate
are already written.

## What is not built yet

A map pin is the centre of its district until somebody drags it, and the app
marks those as approximate rather than pretending otherwise. Approving a
payment is a SQL statement, not a screen — see `supabase/README.md`.
