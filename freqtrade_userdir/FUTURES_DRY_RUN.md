# OKX USDT perpetual dry-run

This configuration is isolated from the existing spot bot and starts stopped.
It is for simulation only; do not set `dry_run` to `false` in this file.

1. Copy `config_okx_futures_dryrun.json` to a private, untracked runtime file.
2. Replace all `CHANGE_ME` API-server values with long random secrets.
3. Keep the API server bound to `127.0.0.1`.
4. Start only after validating the configuration:

   ```bash
   freqtrade trade --config config_okx_futures_dryrun.json --strategy OkxFuturesMaCross
   ```

The strategy limits leverage to 2x, sizes entries at 0.5% account risk, and
uses an ATR-derived stop.  It is not approved for real-money trading.
