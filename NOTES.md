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

## Critical discovery: the hackathon needs a PayBox plugin too
The submission portal (your "Submission" tab) requires uploading `dist/plugin.mjs` — a
separate MCP tool bundle built with **Node 24 + pnpm 11.11.0** (not bun), from
`developer.paybox.sh/skill.md` + `requirements.md`. This is NOT a replacement for the
Express/x402/Docker/Coolify server — it's a thin wrapper: one MCP tool
(`generate_status_drop` in `plugin/src/plugin.ts`) that calls `proposeX402()` to propose
an x402 payment against our own hosted `/drop` endpoint. PayBox's runtime handles
approval, payment, and the actual fetch; the plugin just proposes.

Starter kit lives in `plugin/` (own package.json, separate from the root bun project).
`DROP_ENDPOINT` in `plugin/src/plugin.ts` is still a placeholder
(`https://drop.CHANGE-ME.sslip.io/drop`) — must be updated once the server is deployed
(MON-42), then `pnpm build` and upload `plugin/dist/plugin.mjs` via the portal, adding
that hostname as a configured network host there.

Known gap: couldn't get `pnpm test`'s stricter local conformance check running — it hard-
requires Node 24.x exactly (not 24+), and installing node@24 via Homebrew on this machine
hits a persistent `openssl@3` lock error with no actual process holding it (tried 3x,
removed stale lock files, same result — looks like corrupted local Homebrew state, not
our code). Not blocking: `pnpm typecheck` and `pnpm build` both pass clean, and PayBox's
own hosted checks after upload will be the real conformance gate regardless.

## Deviation from spec: facilitator swapped from Coinbase CDP to PayAI
Coinbase CDP's portal (`portal.cdp.coinbase.com`) is geo-blocked for both of us (Nigeria) —
confirmed DNS-level failure for both, not just an OTP/verification issue. Found an
alternative in x402's own docs: **PayAI** (`https://facilitator.payai.network`) is a
production-ready facilitator that supports both `eip155:8453` (Base mainnet) and
`eip155:84532` (Base Sepolia testnet) — confirmed via `GET /supported`, same USDC asset
addresses as the spec. No account or API key required for free-tier usage (an optional
Bearer token only lifts settlement caps, not needed for a hackathon demo). Using it for
**both** testnet and mainnet — one facilitator, no CDP dependency, no geo-block. Just
flip `X402_NETWORK` between `base-sepolia` and `base`; `X402_FACILITATOR_URL` stays the
same. MON-27 (CDP key) and the CDP portion of MON-43 are no longer needed.

## Deviation from spec: claude-haiku-5-5 needs thinking disabled
Two issues hit building `copywriter.ts` against the real API (not in the spec, found by
testing):
1. `temperature` is rejected outright for this model ("deprecated for this model") — dropped
   the param entirely rather than setting a value.
2. More serious: on `pcg`/`yo` prompts (not `en`), the model would sometimes spend its whole
   `max_tokens` budget on extended thinking and return zero text content blocks
   (`stop_reason: "max_tokens"`, `thinking_tokens: 400/400`) — silently producing nothing
   to parse. Fixed by passing `thinking: {type: "disabled"}` on the request. This is a
   pure copywriting task with no need for deliberation, so turning it off is correct, not
   just a workaround. `src/copywriter.ts` always falls back to a deterministic template on
   any parse/response failure regardless, so this fails safe either way — but disabling
   thinking makes the LLM path actually succeed instead of silently falling back.

## Photo fetch (`src/image.ts`, MON-37)
Choices beyond the issue text, all on the strict side:
- **Default port only** (443) and no `user:pass@` in the URL — no reason for a product
  photo to live elsewhere, and it stops `/drop` being used to port-scan public hosts.
- **Every** resolved address must be public, not just the first; the check runs inside the
  socket's own DNS lookup, so the vetted IP is the one connected to (no rebinding gap).
  IP literals (incl. `0x7f.1`, `2130706433`, `[::ffff:127.0.0.1]`) are checked before
  connecting because Node skips the lookup hook for them. IPv6 is allow-listed to global
  unicast; 6to4/Teredo/NAT64/IPv4-mapped are judged by (or blocked for) the embedded IPv4.
- The 5s deadline covers the whole fetch including redirects and body, not per hop.
- Small photos are **upscaled** to 1080 on the long edge (issue says "resize to 1080px long
  edge"); flip to `withoutEnlargement` if that looks bad in renders. Transparent images stay
  PNG, everything else becomes JPEG q88; EXIF rotation applied, metadata stripped.
- Errors are `PhotoError` with a `code` (`photo_blocked_host`, `photo_too_large`, ...) for
  the route to map to a 4xx.

## Render queue (`src/queue.ts`, MON-38)
`MAX_CONCURRENT_RENDERS` is clamped to 1..2. "503 if queue > 5" is read as: at most 5 jobs
waiting behind the running ones; the 6th is refused. `renderQueue.isFull()` is for the
pre-payment check; `run()` re-checks because two requests can race for the last slot.

## Important for Tanta too: tsx does not auto-load .env
`bun run <script>` auto-loads `.env` when bun runs the file directly — but `render-local.ts`
(and any future entry point run via `tsx` or plain `node`, which is how the server **must**
run per the Node/Remotion requirement) does NOT get `.env` for free. This failed completely
silently: copywriter.ts and voiceover.ts both have safe fallbacks for a missing key, so
render-local.ts ran for a long time quietly using fallback copy and no audio, no error, no
warning. Fixed with `src/env.ts` (calls `process.loadEnvFile()`), imported as the first line
of every entry script. **Tanta's server.ts needs this same import** — same silent-failure
risk applies to `PAYOUT_ADDRESS`, `X402_FACILITATOR_URL`, etc. if it's started via tsx/node
without it.

## TTS voiceover (`src/voiceover.ts`, MON-51)
ElevenLabs. "Library" voices (incl. Tolani, Nigerian accent — would have been the better
fit for pcg copy) need a paid plan/credits for API access (402 `paid_plan_required`); using
free-tier "premade" voice Sarah instead (`EXAVITQu4vr4xnSDxMaL`) until/unless funded.
Script is deliberately short (hook + first point + price + cta, not all 3 points) to fit
the fixed 10s video without the `<Audio>` track running past the composition and getting
cut off mid-sentence — placed unwrapped (not in a limited `Sequence`) so the composition's
own 300-frame length does the clipping.

Also observed: the copywriter's `lines` array occasionally comes back longer than
`input.points` (zod `.max(3)` rejects it), triggering the existing retry-then-fallback
path — working as designed (no crash, graceful fallback), just noting it's a real model
behavior, not hypothetical.

## Open items
- PayBox developer portal submission requirements: TBD once account is registered (Track 1).
- x402 settlement-on-failure behavior (spec §6.3 rule 3): to confirm once `@x402/express`
  is wired up (Tanta's track) — note here whether it settles only on 2xx or needs restructuring.
- Mainnet drop transaction hash: TBD after Phase 5.
