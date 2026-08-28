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
