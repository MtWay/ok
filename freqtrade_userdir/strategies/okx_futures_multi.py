"""Merged OKX futures strategy: MA cross (forceenter-only) + OkxGrid.

One bot, two execution paths, dispatched per pair by OkxGrid's hooks:

- pairs WITHOUT a grid signal/plan → pure OkxFuturesMaCross behaviour:
  no self-entry (notify-service forceenters via plans), plan-owned exits,
  static stoploss -0.99, MA leverage/stake logic.
- pairs WITH an active grid signal → OkxGrid behaviour: self-entry on grid
  line touch, layer adds via position adjustment, per-layer TPs, merged
  stop. Signal file: freqtrade_userdir/grid_signals.json (written by
  notify-service grid tasks); state: grid_state.json.

Class attribute conflicts are resolved here in favour of the grid where
required (process_only_new_candles=False so grid touches are seen intra-
candle; position_adjustment_enable=True — a no-op for MA pairs since
adjust_trade_position returns None for non-grid pairs).

Grid internals live in grid_core.py (unit-tested offline); the OkxGrid
hooks stay usable standalone for backtests (OKX_GRID_ALLOW_ALL=1).
"""

from okx_futures_ma_cross import OkxFuturesMaCross
from okx_grid import OkxGrid


class OkxFuturesMulti(OkxGrid, OkxFuturesMaCross):
    """OkxGrid first in MRO: its hooks dispatch and super() into the MA."""

    INTERFACE_VERSION = 3
    can_short = True  # MA shorts; grid is long-only by design
    timeframe = '1h'
    process_only_new_candles = False  # grid needs intra-candle touches
    position_adjustment_enable = True  # no-op for MA pairs
    startup_candle_count = 300  # grid lookback needs the deeper warmup

    stoploss = -0.99
    use_custom_stoploss = True  # custom_stoploss returns None for MA pairs
    minimal_roi = {}
    trailing_stop = False
    use_exit_signal = True

    # order_types / order_time_in_force / risk knobs come from
    # OkxFuturesMaCross via MRO (OkxGrid defines none of them).
