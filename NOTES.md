# Build notes

## Scope cut for the 3pm deadline
Dropped from tonight's MVP: `market` template, background removal, HTML landing page,
Bazaar discovery metadata. `StatusDrop.tsx` falls back to `brutal` for `template: "market"`
until/unless that template gets built.

## Repo layout
- `remotion/` — the video template (this phase). Entry: `remotion/index.ts`.
  `Brutal.tsx` composes four `Sequence`s (hook / product+points / price slam / CTA) from
  `remotion/templates/scenes/`. Auto-fit text via `@remotion/layout-utils` in
  `components/AutoFitText.tsx` — shrinks font size so a line never overflows its width;
  stress-tested with a 60-char product name and 80-char points in `scripts/render-local.ts`.
- `src/` — server (Express routes, x402, image handling, store/queue) — not built yet,
  Tanta's track (see Linear MON-36 onward).
- `scripts/render-local.ts` — renders a sample + a stress-test drop to `data/media/`
  without the server or payment, for checking the template in isolation. Run with
  `bun run render:local`.

## Open items
- PayBox developer portal submission requirements: TBD once account is registered (Track 1).
- x402 settlement-on-failure behavior (spec §6.3 rule 3): to confirm once `@x402/express`
  is wired up (Tanta's track) — note here whether it settles only on 2xx or needs restructuring.
- Mainnet drop transaction hash: TBD after Phase 5.
