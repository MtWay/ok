# Futures dry-run runbook

The futures bot is intentionally separate from the existing spot bot.

## Start

From the repository root:

```bash
./install-freqtrade.sh  # first-time setup only
yarn futures:dry-run
```

The script validates the safety flags before starting Freqtrade. It is also
uses only `~/freqtrade-venv/bin/freqtrade`, created by the installer. It does
not use a globally installed Freqtrade, which prevents system Python package
conflicts from affecting the simulated bot.

The config uses `dry_run: true` and starts in the running state. The bot API is
on `127.0.0.1:8081` so it is not publicly exposed.

## Logs

The package startup command writes the Freqtrade console output to both the
terminal and `logs/freqtrade-dryrun.log` at the repository root:

```bash
tail -f /work/ok/logs/freqtrade-dryrun.log
tail -f /tmp/premium-notifier.log
```

## Control service

Set these variables in `freqtrade-webui/notify-service/.env`:

```env
FREQTRADE_API_URL=http://127.0.0.1:8091
FREQTRADE_API_USER=freqtrader
FREQTRADE_API_PASSWORD=the-value-from-the-freqtrade-config
```

The notification service obtains a short-lived Freqtrade token and only reads
status and balance. It has no order, cancel, or force-entry route yet.

## Safety checks

- Confirm `dry_run: true`, `trading_mode: futures`, and `margin_mode: isolated`.
- Keep leverage at or below 2x and use only the whitelist pairs.
- Treat an approved plan as a paper-trading approval, not an exchange order.
- Stop the bot before changing strategy or risk parameters.
