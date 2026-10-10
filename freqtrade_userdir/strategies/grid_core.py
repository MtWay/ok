"""Pure grid logic for the OKX futures grid strategy.

Shared by the freqtrade strategy (okx_grid.py) and the offline unit tests,
so it must stay free of any freqtrade/pandas imports. Semantics are kept
aligned 1:1 with the notify-service grid implementation
(freqtrade-webui/notify-service/src/position-signals.ts) and the webui
backtest engine (freqtrade-webui/src/composables/useStrategyEngines.ts):

- bounds: rolling window closes, 20th/80th percentile, step = range/gridCount
- trend filter: |linear-regression slope| > 0.1 %/bar blocks entries
- entry: previous close above the level AND low touches it, fill=min(open, level)
- min step guard: one-step gain must cover round-trip fees + slippage
- TP per layer: level + step, locked at detection time
- stop per layer: fill * (1 - stopPercent/100)
- merged-position stop: lowest REMAINING fill * (1 - stopPercent/100)

Candle layout: [[open, close, low, high], ...], oldest -> newest. The last
row is the still-forming candle in live mode (process_only_new_candles=False)
and a closed candle in backtest.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional

#: One grid step must at least cover round-trip taker fees (0.1%) plus a
#: 0.2% slippage buffer. Same default as notify-service GRID_MIN_STEP_PERCENT.
GRID_MIN_STEP_PERCENT = 0.3

#: |slope| above this (%/bar) is treated as a trending market; entries pause.
TREND_SLOPE_PERCENT = 0.1


@dataclass(frozen=True)
class GridParams:
    grid_count: int = 8
    lookback: int = 120
    stop_percent: float = 2.0
    min_step_percent: float = GRID_MIN_STEP_PERCENT


@dataclass(frozen=True)
class Bounds:
    lower: float
    upper: float
    step: float


@dataclass
class GridLevel:
    """One filled grid layer inside the merged position."""

    level: int          # grid index k (level_price = lower + k * step)
    level_price: float  # trigger price of the grid line
    fill: float         # actual fill price
    tp: float           # take profit, locked at detection time (level + step)

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> 'GridLevel':
        return GridLevel(level=int(d['level']), level_price=float(d['level_price']),
                         fill=float(d['fill']), tp=float(d['tp']))


@dataclass
class GridPlan:
    """State of one pair's merged grid position (persisted as JSON)."""

    pair: str
    params: GridParams
    trade_id: Optional[int] = None
    levels: list = field(default_factory=list)  # list[GridLevel], fills in time order
    last_seen_ms: int = 0  # heartbeat: last time an open-trade callback saw it

    def to_dict(self) -> dict:
        return {
            'pair': self.pair,
            'params': asdict(self.params),
            'trade_id': self.trade_id,
            'levels': [l.to_dict() for l in self.levels],
            'last_seen_ms': self.last_seen_ms,
        }

    @staticmethod
    def from_dict(d: dict) -> 'GridPlan':
        p = d['params']
        return GridPlan(
            pair=d['pair'],
            params=GridParams(**p),
            trade_id=d.get('trade_id'),
            levels=[GridLevel.from_dict(x) for x in d.get('levels', [])],
            last_seen_ms=int(d.get('last_seen_ms', 0)),
        )

    @property
    def stop_price(self) -> Optional[float]:
        """Merged-position stop: the lowest remaining fill minus stopPercent.

        Recomputed as deeper layers TP out, so the stop ratchets up.
        """
        if not self.levels:
            return None
        return min(l.fill for l in self.levels) * (1 - self.params.stop_percent / 100)

    def occupied(self) -> set:
        return {l.level for l in self.levels}

    def next_tp_layer(self) -> Optional[GridLevel]:
        """The layer whose TP is hit first (lowest TP among remaining)."""
        if not self.levels:
            return None
        return min(self.levels, key=lambda l: l.tp)

    def last_tp_layer(self) -> Optional[GridLevel]:
        """The layer with the highest TP — the final exit target."""
        if not self.levels:
            return None
        return max(self.levels, key=lambda l: l.tp)


# ---------------------------------------------------------------- bounds ----

def _window(closes: list, lookback: int) -> list:
    lb = min(lookback, len(closes))
    return closes[-lb:] if lb >= 2 else []


def compute_bounds(closes: list, grid_count: int, lookback: int = 120) -> Optional[Bounds]:
    win = _window(closes, lookback)
    if len(win) < 2:
        return None
    s = sorted(win)
    lower = s[int(len(s) * 0.2)]
    upper = s[int(len(s) * 0.8)]
    step = (upper - lower) / grid_count
    if step <= 0:
        return None
    return Bounds(lower=lower, upper=upper, step=step)


def slope_percent(closes: list, lookback: int = 120) -> float:
    """|linear regression slope| of the window closes, in %/bar."""
    win = _window(closes, lookback)
    n = len(win)
    if n < 2:
        return 0.0
    sum_x = sum(range(n))
    sum_y = sum(win)
    sum_xy = sum(j * y for j, y in enumerate(win))
    sum_x2 = sum(j * j for j in range(n))
    denom = n * sum_x2 - sum_x * sum_x
    if denom == 0:
        return 0.0
    slope = (n * sum_xy - sum_x * sum_y) / denom
    avg = sum_y / n
    if avg == 0:
        return 0.0
    return abs(slope / avg * 100)


def is_trending(closes: list, lookback: int = 120) -> bool:
    return slope_percent(closes, lookback) > TREND_SLOPE_PERCENT


def level_price(bounds: Bounds, grid_count: int, k: int) -> float:
    return bounds.lower + k * bounds.step


# --------------------------------------------------------------- triggers ---

def _candles_to_parts(candles: list):
    o = float(candles[-1][0])
    c = float(candles[-1][1])
    l = float(candles[-1][2])
    h = float(candles[-1][3])
    prev_close = float(candles[-2][1])
    return o, c, l, h, prev_close


def _scan_level(candles: list, params: GridParams, occupied: set) -> Optional[dict]:
    """Find the highest unoccupied grid line touched by the current candle.

    Mirrors detectGrid's entry loop: for k from grid_count down to 1, the
    previous close must be above the level and the low must touch it.
    Returns {'level','level_price','fill','tp'} or None.
    """
    if len(candles) < 3:
        return None
    closes = [float(c[1]) for c in candles]
    bounds = compute_bounds(closes, params.grid_count, params.lookback)
    if not bounds:
        return None
    if is_trending(closes, params.lookback):
        return None
    o, _c, l, _h, prev_close = _candles_to_parts(candles)
    for k in range(params.grid_count, 0, -1):
        if k in occupied:
            continue
        price = level_price(bounds, params.grid_count, k)
        # min-step guard: expected gain must cover fees + slippage
        if bounds.step / price * 100 < params.min_step_percent:
            continue
        if prev_close > price and l <= price:
            return {'level': k, 'level_price': price,
                    'fill': min(o, price), 'tp': price + bounds.step}
    return None


def detect_entry(candles: list, params: GridParams) -> Optional[dict]:
    """Entry trigger for a flat pair (no occupied levels)."""
    return _scan_level(candles, params, set())


def detect_add(candles: list, plan: GridPlan) -> Optional[dict]:
    """Next-layer add trigger for an existing grid position."""
    return _scan_level(candles, plan.params, plan.occupied())


def layer_tp_hit(plan: GridPlan, high: float) -> Optional[GridLevel]:
    """The remaining layer whose TP is reached by `high` (lowest TP first)."""
    layer = plan.next_tp_layer()
    if layer is not None and high >= layer.tp:
        return layer
    return None
