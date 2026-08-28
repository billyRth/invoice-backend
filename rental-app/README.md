# Ptas (ផ្ទះ) · rental app prototype

A working front-end prototype of a Cambodian rental app. Open `ptas.html` in a browser. It frames
itself as a phone on a desktop and goes full bleed on a handset. No build step, no backend.

## Why this and not another listings site

realestate.com.kh already carries 24,000+ rental listings, is free, and owns the agent and expat end
of the market. Competing on supply there is unwinnable for one person.

The gap is the other end: local renters trade rooms in Facebook groups. That is not a listings
problem, it is a trust and freshness problem. Posts never expire, nobody is verified, the deposit is
a surprise, and half the rooms are gone by the time you message. Those three failures are what the
interface is built around.

| Facebook groups | What this does |
| --- | --- |
| Posts live forever, most are already taken | Every card states when the landlord last confirmed the room is free. Past 14 days it is marked stale and sinks down the list. |
| Anyone can post as anyone | Landlords who have had ID checked are badged. Unbadged listings still appear, and are labelled as unbadged rather than hidden. |
| Deposit terms surface in chat, late | Deposit is on the card, and the detail screen shows the full move-in cost in one line. |
| Khmer posts, English-only portals | Khmer is the default language. The toggle is real, not a stub. |

## The business model, and why it is also the product

Listings cost **$1 per listing per month**, free for the first 14 days.

The fee is not really revenue. It is the mechanism that keeps the feed honest. A landlord whose room
is gone has a reason to take it down, and a landlord who has stopped paying attention stops paying,
at which point the listing **pauses itself and leaves search**. Dead inventory expires whether or not
anyone remembers to tidy it, which is the single thing every Cambodian listings site gets wrong.

The landlord side of this runs in the prototype. Open the You tab: three listings, one live, one on
free trial, one paused for non-payment. Paying puts a listing back into search and onto the bill.
Marking one as rented removes it from search and stops the billing in the same tap.

### On people doing the deal off-app

They will, and it does not matter here. A commission model has to police contact, because every
off-app deal is lost revenue, which is why ride apps fight cancellations. A subscription is paid for
**visibility**, not for the transaction. If a landlord and a renter meet through a listing and settle
it over the phone, the landlord has already paid, and then unlists, which is exactly the behaviour
the model wants.

Hiding phone numbers would make this worse than a Facebook group, where the number is right there.
So the numbers stay visible, and revenue never depends on the deal happening inside the app.

## One account, two modes

Sign in is a phone number, because that is what people have and what KHQR is tied to. After that the
app asks what you are here for, and the answer sets a mode rather than an account type.

**Not two logins.** In Cambodia the same person is often both: someone renting a room who also
sublets one, or a tenant whose family owns a shophouse. Two accounts would mean two identities and
two phone numbers for one human, so the mode is a switch in preferences that can be flipped at any
time.

The mode decides what the interface offers:

| | Renter | Landlord |
| --- | --- | --- |
| Third tab | **Renting**: the tenancy record, next rent due, KHQR | **Listings**: live and paused listings, monthly bill |
| Sees billing | No | Yes |
| Sees "mark as rented" | No | Yes |
| Explore and Saved | Yes | Yes, landlords check the competition too |

## What runs

Search, four quick filters, a filter sheet with price, bedrooms and type, save and unsave, a saved
tab, listing detail, and a full Khmer and English translation of every string.

## Borrowed patterns, and why each one

| Pattern | Seen in | Why it belongs here |
| --- | --- | --- |
| Report as already rented | Marketplace, Khmer24 | Renters are the sensor the monthly fee misses: a landlord can pay and still leave a taken room up. Two reports pause the listing until the landlord confirms it again. |
| Call and Telegram, not in-app chat | how Khmer rentals actually start | A phone call is the real first contact, and Telegram is the messenger people already have. `tel:` and `t.me` links, no attempt to trap the conversation. |
| Similar places on the detail screen | Airbnb, Zillow | Someone who rejects a room is still shopping. Same area first, then nearest price. |
| Recently viewed | Airbnb | People look at six rooms and want the third one back. |
| Share a listing | every marketplace | Listings spread through Telegram groups. Native share where available, clipboard otherwise. |

## The tenancy record

Once two people agree in person, they fill in a short form together: start date, term, the day rent
falls due, tenant name. After that both sides see the same record, and the renter gets the things
nobody currently has in one place: since when, until when, when the next rent is due and how many
days that is, how much deposit is held, and a KHQR button to pay.

**It is explicitly not the contract.** The paper contract is what the government needs and this does
not touch it. This is the shared record of what was agreed, which is a different and more useful
thing to have on a phone.

Two effects beyond convenience:

- **It closes the freshness loop for good.** Recording a tenancy takes the listing down, so a
  landlord no longer has to remember to unlist. Agreeing and unlisting become the same action.
- **It fixes the churn problem in the subscription model.** A landlord who lists once and vanishes
  is the main risk with a monthly fee. A landlord whose tenancy end date lives in the app has a
  reason to come back on that date, which is exactly when they need to list again.

## Putting it on a phone

It is one file, so this takes about a minute and needs no build step:

1. Open https://app.netlify.com/drop
2. Drag the `rental-app` folder onto the page
3. You get a public URL. Open it on a phone, or send it to a landlord.

`index.html` is a copy of `ptas.html` so the URL works without a filename, and
`netlify.toml` routes every path to it. To test locally on your own phone instead, run
`npx serve rental-app` and open the network address it prints while both devices are on the
same wifi.

## Themes

Four: Auto, Light, Dark and Khmer, in You then Preferences. Auto removes the theme attribute
entirely so the system preference takes over again, rather than freezing whichever mode happened to
be showing. The choice is remembered in the browser, wrapped in try/catch so private mode does not
break the app.

The Khmer theme is silk crimson on ivory card stock, the palette of a printed Khmer card rather than
of a software product. Gold appears only as the delight colour and never as structure, because
gold-on-everything is the version of Khmer design everybody already makes.

## Posting a listing

Four steps, each short enough to finish standing in the doorway of the room being listed, which is
where a landlord will actually do this: photos, the place, the money, then a check screen that shows
what the listing will say and what it will cost. Publishing puts it straight into search on the free
trial.

## What is not built

Auth, real payments, in-app chat, photo upload, the landlord side of posting. The listings are a
fixed array at the bottom of `ptas.html`.

## The map

Location is most of a rental decision, so Explore has a map view. Markers are prices, because that is
what someone is scanning for, and they follow the filters rather than showing everything.

Two deliberate choices:

- **Leaflet and the tiles load only when the map is first opened.** Someone who never taps Map pays
  nothing for it.
- **A failed map gives the list straight back.** If the library or the tiles cannot load, the panel
  does not sit there grey: the list returns and a line explains what happened. This is tested, both
  the working path and the failing one.

Coordinates are approximate district centres. Real listings would carry a pin dropped by the
landlord when posting, which is the obvious next step for the posting flow.

## Motion

One rule decides everything here: animate the moments people meet rarely, never the ones they
repeat all day.

**Earns a flourish, because it happens occasionally**

- **Card cascade.** Cards stagger in when the feed changes. Fires on a filter change, not on scroll.
- **Shared element.** The card photo flies into the detail header, so the listing keeps its identity
  across the transition. It cleans up on a timer as well as on `transitionend`, so a dropped event
  can never strand an image over the UI.
- **Save burst.** Six dots thrown out of the heart. Saving is rare, so it can afford to be fun.
- **Push and pop.** The pop is lighter and faster than the push: you are returning to something you
  have already seen.
- **Sheet drag.** The filter sheet follows your thumb and can be thrown away, closing on distance or
  on velocity, so a short fast flick works as well as a long drag.
- **Count roll.** The result count re-enters when it changes, so a filter change is legible without
  hunting for what moved.
- **Header condense.** The title bar collapses into a slim search bar as you leave the top, watched
  by an observer on a sentinel rather than a scroll listener.
- **Card parallax.** The photo drifts inside its frame, driven by `animation-timeline: view()` so
  the browser runs it off the main thread. Skipped entirely where unsupported.

**Deliberately not animated**

- **Tab switching.** People hit tabs dozens of times a session. The content swaps instantly and only
  the pill slides, so it reads as responsive rather than slow.
- **Typing in search.** Results update on the keystroke with no transition.

**Always**

- Skeletons reserve the exact card shape, so the feed does not jump when real cards land.
- Every animation above collapses under `prefers-reduced-motion`, and nothing becomes unusable:
  the burst, the parallax, the cascade and the pill transition all switch off.
- No `scroll` listener exists anywhere in the file. Everything scroll-aware uses
  `IntersectionObserver` or CSS scroll-driven animation.

## Before this becomes real

The prototype deliberately shows the honest version of the hard parts:

1. **Verification costs money and effort.** Someone has to check IDs. That is the moat and the
   operating cost at the same time.
2. **Freshness needs landlords to answer.** The 14 day expiry only works if confirming is one tap
   and there is a reason to bother.
3. **Supply comes first.** A hundred real rooms in one district beats a thousand across the city.
