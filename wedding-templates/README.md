# Wedding invitation templates

Standalone single-file templates. No build step, no dependencies. Open one in a browser or drop it
straight onto Netlify.

| File | What it is |
| --- | --- |
| `builder.html` | The tool. Describe a wedding in plain English, it calls `/api/fill-wedding`, fills the chosen template, and hands back a finished single-file invitation. |
| `popil-crimson.html` | Khmer template, bilingual. Silk crimson on ivory card stock, Moul for Khmer display, Marcellus for Latin. Bordered card, krama check and lotus petal dividers, pipal leaf marks, corner curls and a temple tier, all drawn in CSS or inline SVG. The day is laid out as the sequence of named rites, and the families do the inviting. |
| `cobalt-porcelain.html` | Universal template. Cobalt on cool porcelain, Bodoni Moda display, Instrument Sans body, all-sharp corners. |

## The Khmer template

Khmer sits above English throughout, the way a printed card reads. Every Khmer field is optional:
leave `partnerOneKh`, `partnerTwoKh`, `invitationHeadingKh`, `invitationNoteKh` and a rite's
`titleKh` empty and those lines are removed rather than left showing somebody else's Khmer, so the
same file also works for an English-only wedding.

The ornament is geometry drawn in the spirit of Khmer decoration, not a reproduction of kbach or any
other real carved pattern. If you want true kbach, it should come from a Khmer artist as artwork,
not from CSS.

**The Khmer strings in the sample were written without a native reviewer.** Have a Khmer speaker
check them before anything goes to guests. The endpoint is instructed to leave a Khmer field empty
rather than guess, and to warn you whenever it fills one.

## Using the builder

Serve the folder over http, because the builder fetches the template at runtime:

```bash
npx serve wedding-templates
```

Open `builder.html`, describe the wedding, press Generate. You get a live preview, a list of
anything the model had to assume, and two downloads: the finished `.html` invitation, and the
content as `.json` if you would rather edit it by hand.

The template is data driven. All the words live in one `window.WEDDING` object near the top of
`cobalt-porcelain.html`, and photo URLs live in `window.WEDDING_PHOTOS` right below it, kept
separate so the model never touches them. Opening the template on its own still shows the sample
invitation, so it works with or without the builder.

## Before a template goes live

1. **Photographs.** Every `picsum.photos` URL is a placeholder, marked `TODO` in the source with the
   aspect ratio it expects. One portrait (3:4), one venue (3:2), four gallery images (4:5).
2. **Fonts.** The two families load from Google Fonts through a `<link>`. Self-host them for
   production, both for speed and so the page does not depend on a third party staying up.
3. **RSVP.** Set `RSVP_ENDPOINT` near the bottom of the script. While it is `null` the form
   validates and shows its success state but sends nothing, and logs a warning to the console.
   Point it at Netlify Forms, Formspree, or an endpoint on this repo's backend.

## Filling one from a description

`POST /api/fill-wedding` on this repo's backend turns a plain-English description of a wedding into
the exact content shape this template renders: names, date, schedule, venue, details, RSVP deadline,
and the list of photographs still needed. See the main README.

## Design rules these templates follow

Both `taste-skill` and `design-motion-principles` in `.claude/skills` are applied here:

- One accent colour, one radius system, one theme across the whole page.
- No em-dashes anywhere in visible copy.
- Motion is reveal-on-scroll through IntersectionObserver, never a scroll listener, and only
  `transform`, `opacity` and `filter` are animated.
- Everything collapses to static under `prefers-reduced-motion`, and the page is fully readable
  with JavaScript disabled.
- The RSVP form carries real validation, inline errors, and success and failure states.
