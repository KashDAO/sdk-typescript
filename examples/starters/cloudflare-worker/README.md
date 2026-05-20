# Cloudflare Worker + `@kashdao/sdk` starter

Edge-runtime starter showing the SDK working on Workers without
polyfills. The SDK is built on native `fetch` + Web Crypto, so it
runs unmodified.

## What it shows

| Concern                         | Pattern                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated reads at the edge | `GET /markets`, `GET /markets/:id` — low-latency from any region; `KASH_API_KEY` lives in Cloudflare secrets and never reaches the browser |
| Webhook verification            | `POST /webhooks/kash` using `kash.webhooks.verifySignature` (Web Crypto, portable)                                                         |
| Health probe                    | `GET /health`                                                                                                                              |
| Edge-friendly errors            | `KashError.isKashError` translates SDK errors to JSON responses                                                                            |

Authenticated mutations (`POST /trades`, etc.) are intentionally
**not** exposed here — Workers are typically the public-facing edge.
For server-to-server trade placement, the [Express starter](../express)
is the better fit.

## Run locally

```sh
# 1. Set local secrets in .dev.vars (gitignored — don't commit)
cat > .dev.vars <<EOF
KASH_API_KEY=kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
KASH_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF

pnpm install
pnpm dev                 # wrangler dev — http://localhost:8787
```

Then:

```sh
curl http://localhost:8787/health
curl http://localhost:8787/markets
```

## Deploy

```sh
wrangler secret put KASH_API_KEY
wrangler secret put KASH_WEBHOOK_SECRET
pnpm deploy
```

## Production checklist

- [ ] Set `usage_model = "bundled"` (or `"unbound"` for long-running webhook processors) in `wrangler.toml`
- [ ] Add a Cloudflare WAF rule limiting `/webhooks/kash` to Kash's egress IPs
- [ ] Forward `traceparent` from incoming requests via `headers: { traceparent: request.headers.get('traceparent') ?? '' }`
- [ ] Set a tight `timeoutMs` (e.g. 5000) on the `KashClient` — Workers' CPU budget is finite
