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
- `src/` — server: `app.ts` routes, `x402.ts` + `validate-paid.ts` payment, `render.ts`, `image.ts`, `store.ts`, `queue.ts`,
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
`DROP_ENDPOINT` now points at the live server: `https://vosha-studio.brimble.app/drop`
(confirmed live: /health, /, /templates, and bodyless POST /drop → 402 all checked by
hand). Builds clean (`dist/plugin.mjs`, 385KB).

**Not ready to upload yet**: the plugin proposes `chain: "eip155:8453"` (Base mainnet,
correct for the final submission), but the live server is still on testnet
(`eip155:84532` — confirmed via the 402 response's payment requirements). Uploading now
would make every proposal target the wrong chain for what the server actually accepts.
Wait for MON-43 (mainnet switch on Brimble) before uploading via the portal and adding
`vosha-studio.brimble.app` as a configured network host there.

Also found and fixed before this: the live deployment's `PUBLIC_BASE_URL` wasn't set
(defaulted to the `https://drop.example.com` placeholder), which would have put a dead
domain in every `resource.url` AND every `video_url`/`poster_url`/`page_url` returned to
a paying caller. Fixed on Brimble, reconfirmed in the 402 response.

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

## Server routes (`src/app.ts`, MON-36)
`createApp(deps)` holds every route; `src/server.ts` only reads env, runs `ensureBrowser()` +
the Remotion bundle once, then listens. Choices to check against spec §6 (not in the repo):
- **`POST /drop` is synchronous**: the 200 is sent only after the render finishes (~25s
  locally for 10s of video). That keeps "render failure → no settlement" simple, but PayBox's
  fetch timeout must allow for it, plus queue wait when busy. Unknown so far.
- **Response**: `{id, video_url, poster_url, page_url, caption, hashtags}`. Errors are
  `{error: <code>, message}` (+ `issues` on 400). Status codes: 400 schema/bad JSON/
  `photo_invalid_url`; 413 body > 16kb; 422 other `photo_*` codes; 503 + `Retry-After: 60`
  when the queue is full; 500 `render_failed`.
- `photo_url` must be https (the plugin schema accepts any URL).
- The processed photo is saved as `media/<id>-photo.{jpg,png}`, and the renderer loads it
  from `http://127.0.0.1:$PORT/media/...` instead of `PUBLIC_BASE_URL`, so renders don't
  depend on the public proxy being reachable from inside the container.
- `GET /templates` lists `market` with `available: false` (renders as brutal).
- Found in smoke testing: if Chrome Headless Shell isn't present, Remotion downloads it on
  the first render, and a failed download crashes the whole process (an uncaught rejection).
  Hence `ensureBrowser()` at startup. **MON-42: download the browser at image build time**
  (`npx remotion browser ensure`) so a container never downloads it at runtime.

## x402 (`src/x402.ts`, `src/validate-paid.ts`, MON-39/40/43)
**Settlement finding (spec §6.3 rule 3), from reading `@x402/express` 2.28.0 source:** no
restructuring needed. For the `exact` EVM scheme the payment flow is "authorization": verify
*before* the handler, settle *after*. The middleware buffers everything the handler writes;
if the final status is >= 400, or the handler throws, it cancels settlement and sends the
error response unchanged. Only a < 400 response triggers `/settle`, and the buffered body is
released only after settlement succeeds (a failed settle becomes a 402 and the video URLs are
never sent). That holds because `/drop` renders inside the request (see the synchronous note
above). Making `/drop` async would break it, so don't.

Middleware order on `/drop`: `express.json` → `validatePaid` → busy check (503) → x402 →
handler.
1. No body (or `{}`) → `validatePaid` passes it through → x402 answers 402. A paid request
   that somehow arrives bodyless gets a 400 from the handler, so it isn't settled.
2. A body that fails the schema → 400 from `validatePaid`, before x402 runs at all (no
   `/verify`, no `/settle`). Tested with a real signed payment header (`scripts/x402.test.ts`).
3. Render failure → 500 → settlement cancelled. Tested.
4. **Found while testing:** @x402/express settles any < 400 response even if the client has
   already disconnected, so a caller who gave up mid-render (timeout) would still be charged.
   `handleDrop` watches `res` for `close` and answers 499 `client_closed` in that case, which
   cancels settlement. There's a test for it, and it fails with the guard removed.

Config:
- `X402_NETWORK=base-sepolia` → `eip155:84532`, USDC `0x036C…dCF7e`; `base` → `eip155:8453`,
  USDC `0x8335…02913`. The asset is pinned explicitly (with USDC's EIP-712 domain name, which
  is "USDC" on Sepolia and "USD Coin" on mainnet), not left to @x402/evm's defaults.
- Facilitator defaults to PayAI. Checked live: `/supported` lists v2 `exact` for both chains,
  and `pay-test` check (a) passed against it locally.
- `maxTimeoutSeconds: 300` (the payer's authorization window). It must cover queue wait +
  render + settle, because settlement happens after the render.
- The server refuses to start on a bad `X402_NETWORK`, a missing or malformed
  `PAYOUT_ADDRESS`, or a bad `PRICE_USD`.
- **Spec §6.4 payment description is a placeholder** (`PAYMENT_DESCRIPTION` in `src/x402.ts`).
  Swap in the spec wording once we have it.
- `CDP_API_KEY_*` removed from `.env.example`: PayAI doesn't use them and nothing reads them.
- The x402 middleware fetches the facilitator's `/supported` at startup. If that fails, the
  request that triggered it gets a **500** from the library, and the next request retries.
  Seen once locally (PayAI connect timeout). If it shows up on Coolify, warm up with a
  bodyless `POST /drop` after each deploy.
- `server.ts` and `pay-test.ts` import `src/env.ts` first (Abdol's fix below). In Docker
  there's no `.env` and the env comes from Coolify. A value-less `KEY=   # comment` line
  loads as empty, not as the comment.

## Deploy (MON-42) and mainnet (MON-43)
`Dockerfile`: node:22-bookworm-slim + Chrome Headless Shell libs, bun 1.4.3 (must match the
bun that wrote `bun.lock`), `bun install --frozen-lockfile`, Chrome downloaded at build time,
runs as `node`, `/app/data` volume, `/health` healthcheck.

Coolify: new resource → this repo, build pack **Dockerfile**, port 3000, domain with HTTPS
(e.g. `https://drop.<server-ip>.sslip.io`), persistent storage mounted at `/app/data`. Env:
`PUBLIC_BASE_URL` (the https domain, no trailing slash), `X402_NETWORK`, `PAYOUT_ADDRESS`,
`PRICE_USD=0.25`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-haiku-5-5`,
`ELEVENLABS_API_KEY` (optional; without it videos are music-only, no voiceover),
`MAX_CONCURRENT_RENDERS=1` (2 only with 4+ GB RAM). Then from a laptop:
`TEST_PAYER_PRIVATE_KEY=0x... X402_NETWORK=base-sepolia bun run pay-test https://drop.<domain>`.
Then set `DROP_ENDPOINT` in `plugin/src/plugin.ts` (MON-49, Abdol).

Mainnet: change only `X402_NETWORK=base` in Coolify and redeploy. The plugin already
proposes `eip155:8453`. Testnet pay-tests against a mainnet server will fail, which is
expected.

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

## Background music (`src/music.ts`)
ElevenLabs' music-generation API also turned out to be paid-plan-only (402, confirmed by
testing — same wall as the library voices). No browser automation available in this
environment either, so instead of fighting either of those: 3 Mixkit tracks (free,
no-attribution license) downloaded manually and dropped in `public/music/`. One is picked
at random per drop (`pickRandomTrack()`) for variety across renders. Each track's
`startOffsetSeconds` (currently 15s for all three, untuned by ear) skips the quiet
intro most royalty-free loops have before the main beat — `<Audio trimBefore={...}>` in
Brutal.tsx converts that to frames. Mixed at `volume={0.25}` so it sits under the
voiceover rather than competing with it. Worth listening to all three and adjusting the
offsets if the "real beat" lands somewhere other than ~15s in.

## Brimble deploy (replaces Coolify for now)
Deployed from Tanta's fork (`tantasui/Vosha-Studio`, `main`) with the Dockerfile build.
- The first deploy crashed because env values were pasted with their `.env.example` comments.
  `src/env.ts` now strips them.
- The second deploy was OOM-killed at boot: the Remotion webpack bundle peaks around 650 MB,
  and the instance capped the Node heap near 256 MB. The Dockerfile now prebuilds the bundle
  (`remotion bundle` → `/app/build`, `REMOTION_BUNDLE_DIR`), so boot takes about 130 MB. A
  render still peaks around 700 MB, so the instance needs **≥ 1 GB RAM (2 GB recommended)**.

## Open items
- PayBox developer portal submission requirements: TBD once account is registered (Track 1).
- Mainnet drop transaction hash: TBD after Phase 5 (MON-44, joint run via PayBox from Claude.ai).
- Spec §6 / §6.3 / §6.4 wording: still not in the repo. Check response shape, error codes
  and the payment description against it.
- PayBox's request timeout vs our synchronous ~25s+ render: unknown, so confirm on the first
  E2E. If it times out, the video is still rendered (and visible at `/d/<id>`), but the
  caller isn't charged (see the disconnect guard below).
