# Vosha Studio

Turns a product photo + price + 3 selling points into a 10-second vertical promo video,
payable by any AI agent through PayBox via x402 (USDC on Base).

Built for MoonPay Hackathons, Chapter 1.

## Status

- [x] Remotion `brutal` template (1080x1920, 30fps, 10s)
- [x] Copywriter (LLM + fallback, en/pcg/yo)
- [x] Express server (routes, render flow)
- [x] x402 payment flow (PayAI facilitator, Base Sepolia / Base)
- [x] Dockerfile (Coolify deploy steps in NOTES.md)
- [ ] Deploy + mainnet PayBox end-to-end test

## Development

```bash
bun install
bun run studio        # Remotion Studio preview
bun run render:local  # render a sample + stress-test drop to data/media/
bun run typecheck
bun run test
bun run start        # server on $PORT (needs PAYOUT_ADDRESS, see .env.example)
bun run pay-test     # real x402 payment test, needs TEST_PAYER_PRIVATE_KEY with USDC
```

## Calling it via PayBox (once deployed)

An agent with PayBox connected calls `use_service` against `POST /drop` with a JSON body
(product_name, price, photo_url, points, language, template). PayBox probes for the x402
`402`, pays `$0.25` in USDC on Base, then re-fetches and returns the response — a JSON
payload with `video_url`, `poster_url`, `page_url`, and a generated caption.

See the full spec for the request/response contract.
