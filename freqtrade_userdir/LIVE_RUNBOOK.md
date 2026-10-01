# OKX Futures Live Trading Runbook

This configuration trades **real money**. Read this file in full before
starting anything.

## Before you start — safety checklist

1. **API Key permissions** — on OKX, the API Key must have **Trade**
   enabled and **Withdraw** disabled. Never commit a key with withdraw
   access.
2. **Fill the credentials** — open `config_okx_futures_live.json` and
   replace the three empty strings under `exchange.key / secret / password`
   with your real OKX API credentials.
3. **Set matching API passwords** — `api_server.password` in the live
   config and `FREQTRADE_API_PASSWORD` in `.env.production` must be the
   **same value**. Pick a long random string, paste it into both.
4. **Replace JWT secrets** — `jwt_secret_key` and `ws_token` should also
   be long random strings (64+ chars). Generate them with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
5. **Proxy still required** — OKX REST / WebSocket are blocked from
   mainland China. Confirm `http://127.0.0.1:7890` is reachable before
   starting.
6. **Tiny balance first** — start with ≤ 100 USDT in the futures
   account. Once the bot proves stable for a week, top up gradually.

## First run — verify connectivity only

Do NOT trade yet. Run:

```bash
freqtrade list-markets --config config_okx_futures_live.json
```

If this errors, fix credentials or proxy issues before continuing.

## Startup

From the repo root:

```bash
# 1. Stop the dry-run bot if it is still running (it uses port 8091 too)
# 2. Start live Freqtrade
freqtrade trade --config freqtrade_userdir/config_okx_futures_live.json --strategy OkxFuturesMaCross

# 3. Copy production env, then start notify-service
cp freqtrade-webui/notify-service/.env.production freqtrade-webui/notify-service/.env
cd freqtrade-webui/notify-service && node src/index.ts
```

The live bot binds to `127.0.0.1:8091` — it is not publicly exposed.

## What the live config does

| Parameter | Value | Rationale |
|---|---|---|
| `dry_run` | `false` | **Replaces paper trades with real orders** |
| `max_open_trades` | 3 | Tight cap for first live run |
| `stake_amount` | `unlimited` | Lets `TRADING_RISK_FRACTION` size each entry |
| `TRADING_RISK_FRACTION` | 0.001 | 0.1% account risk per entry (down from 0.5% in dry-run) |
| `pair_whitelist` | BTC / ETH / SOL only | Most liquid, lowest spread |
| `margin_mode` | isolated | Losses stay inside one position |
| leverage | ≤ 2x (in strategy) | Hard-coded in OkxFuturesMaCross |

## Emergency stop

```bash
# Graceful: close Freqtrade + notify-service terminals
# Hard: Ctrl+C in both processes

# Exchange side: go to OKX web UI and manually close any open futures
# positions if the bot cannot.
```

## Never

- Run live and dry-run on the same machine at the same time (they
  collide on port 8091 and the same whitelist).
- Commit `config_okx_futures_live.json` or `.env` with real credentials
  (both are in `.gitignore`).
- Increase leverage or risk fraction on a whim — stop the bot first,
  change the config, then restart.
