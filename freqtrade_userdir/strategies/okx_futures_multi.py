"""Merged OKX futures strategy: MA cross (forceenter-only) + OkxGrid.

One bot, two execution paths, dispatched per pair by OkxGrid's hooks:

- pairs WITHOUT a grid signal/plan → pure OkxFuturesMaCross behaviour:
  no self-entry (notify-service forceenters via plans), plan-owned exits,
  static stoploss -0.80 (exchange-level safety net), MA leverage/stake logic.
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

    # 交易所级安全网：同步链路延迟/失败时兜底。20x 杠杆下 -0.80 意味着
    # 价格反向 4% 即触发（亏 80% 保证金 ≈ 4u），远早于强平线 ~5%。
    # 正常退出由 notify-service 的 plan_stoploss 同步机制负责，这里只是最后防线。
    stoploss = -0.80
    use_custom_stoploss = True  # 网格品种用 plan.stop_price 动态追踪；MA 品种保持静态
    minimal_roi = {}
    trailing_stop = False
    use_exit_signal = True

    # order_types / order_time_in_force / risk knobs come from
    # OkxFuturesMaCross via MRO (OkxGrid defines none of them).
