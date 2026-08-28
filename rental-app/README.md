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

## What runs

Search, four quick filters, a filter sheet with price, bedrooms and type, save and unsave, a saved
tab, listing detail, and a full Khmer and English translation of every string.

## What is not built

Auth, chat, payments, map view, photo upload, the landlord side of posting. The listings are a fixed
array at the bottom of `ptas.html`.

## Motion

Weighted for a mobile app: polish on the moments that matter, nothing on the ones that repeat.

- **Push and pop between screens.** A pop is faster and lighter than a push, because the user is
  returning to something already seen.
- **Shared element.** The card photo flies into the detail header, so the listing keeps its identity
  across the transition. It cleans itself up on a timer as well as on `transitionend`, so a dropped
  event can never leave an image stranded over the UI.
- **Tab switching is instant.** People move between tabs dozens of times a session, and animating
  that turns polish into friction.
- **Skeletons** reserve the exact card shape, so the feed does not jump when real cards land.
- Everything collapses under `prefers-reduced-motion`, and the whole app stays usable.

## Before this becomes real

The prototype deliberately shows the honest version of the hard parts:

1. **Verification costs money and effort.** Someone has to check IDs. That is the moat and the
   operating cost at the same time.
2. **Freshness needs landlords to answer.** The 14 day expiry only works if confirming is one tap
   and there is a reason to bother.
3. **Supply comes first.** A hundred real rooms in one district beats a thousand across the city.
