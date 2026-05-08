# Express + `@kashdao/sdk` starter

Minimal Express service that wraps the SDK in a few HTTP endpoints.
Use this as a template if your frontend is on a different domain /
host than your trading logic, and you want a thin Kash proxy your
own clients call.

## What it shows

| Concern | Pattern |
|---|---|
| Authenticated reads | `GET /markets`, `GET /markets/:id` — proxied with the server-side `KashClient`; the API key never leaves your origin |
| Authenticated trade | `POST /trades` — uses server-side `KashClient`; forwards `Idempotency-Key` from the caller |
| High-value confirmation | `isAwaitingConfirmation(trade)` returns `202` with the token |
| Webhook receiver | `POST /webhooks/kash` — `express.raw()` for signature verification on the original bytes |
| Health probe | `GET /health` — wraps `kash.healthCheck()` |
| Error mapping | Centralised handler turns `KashError` subclasses into structured HTTP responses |

## Run

```sh
cp .env.example .env.local       # then edit with your KASH_API_KEY + KASH_WEBHOOK_SECRET
pnpm install
pnpm dev                         # tsx watch — hot reload on edits
```

Then:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/markets
```

## Production checklist

- [ ] Run behind your own reverse proxy / load balancer
- [ ] Apply rate limiting per upstream caller (the SDK already retries 429s, but you don't want a runaway client to exhaust your quota)
- [ ] Persist `Idempotency-Key` mappings in your own store if you re-issue them server-side
- [ ] Forward W3C `traceparent` from upstream into the SDK via `headers: { traceparent: req.header('traceparent') }`
- [ ] Move `KASH_API_KEY` and `KASH_WEBHOOK_SECRET` into your secret manager (AWS SM, GCP Secret Manager, Vault, Doppler) — never commit them
