# Vendored design skills

These are third-party skills copied in from public repos, not written here. Claude
loads every `SKILL.md` in this directory automatically when working in this repo.

| Directory | Skill name | Source | Licence |
| --- | --- | --- | --- |
| `ui-ux-pro-max/` | `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) @ `8bd29e7` | MIT |
| `design-motion-principles/` | `design-motion-principles` | [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles) @ `4a9ca87` | see repo |
| `taste-skill/` and 12 siblings | `design-taste-frontend` + variants | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) @ `ccbc156` | see repo |

## What each one is for

- **`ui-ux-pro-max`** — searchable design intelligence: 79 UI styles, 192 palettes, 74 font
  pairings, 119 UX guidelines, GSAP presets. Query it rather than reading it whole:

  ```bash
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain style
  ```

  Domains: `style`, `product`, `typography`, `color`, `ux`, `gsap`, `chart`, `stack`.
  Pure Python 3, no dependencies, no network access.

- **`design-motion-principles`** — motion/animation discipline, with reference notes on
  Emil Kowalski, Jakub Krehel and Jhey Tompkins, plus an audit workflow and a
  reduced-motion/performance checklist.

- **`taste-skill`** (`design-taste-frontend`, v2 experimental) — reads a design brief and
  infers direction, enforces colour/shape/theme consistency locks, hero discipline, and an
  anti-generic ban list. Siblings cover specific directions: `minimalist-skill`,
  `soft-skill`, `brutalist-skill`, `redesign-skill`, `output-skill`, `image-to-code-skill`,
  `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`, `stitch-skill`,
  `gpt-tasteskill`, and `taste-skill-v1` (legacy).

## Updating

These are vendored copies at a pinned commit, not submodules. To update, re-clone the
source repo and copy the skill directory over, or on a machine with network access to
GitHub use the upstream installer:

```bash
npx skills add Leonxlnx/taste-skill
npx skills add kylezantos/design-motion-principles
```

## Editing

`SKILL.md` files are meant to be edited. If you want a house style that overrides a
vendored rule, put it at the top of the relevant `SKILL.md` — the agent treats the file as
the source of truth on each run. Local edits will be overwritten by an update, so keep any
substantial house style in its own skill instead.
