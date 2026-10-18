"""Offline unit tests for grid_core (no freqtrade/pandas required).

Run: python -m unittest freqtrade_userdir.tests.test_grid_core
"""

import importlib.util
import pathlib
import sys
import unittest

MODULE = pathlib.Path(__file__).parent.parent / 'strategies' / 'grid_core.py'
SPEC = importlib.util.spec_from_file_location('grid_core', MODULE)
grid_core = importlib.util.module_from_spec(SPEC)
# dataclasses with `from __future__ import annotations` resolve string
# annotations through sys.modules — register before exec.
sys.modules['grid_core'] = grid_core
SPEC.loader.exec_module(grid_core)


def candles_from_closes(closes, low_factor=0.999, high_factor=1.001):
    """[[open, close, low, high], ...] — same layout as the TS engine."""
    return [[c, c, c * low_factor, c * high_factor] for c in closes]


def oscillating(n=25, low=100.0, high=100.2):
    """Alternating closes so bounds settle at (low, high) with both percentiles."""
    return [low if i % 2 == 0 else high for i in range(n)]


class TestBounds(unittest.TestCase):
    def test_percentile_bounds_and_step(self):
        closes = oscillating(25)
        b = grid_core.compute_bounds(closes, grid_count=4, lookback=20)
        self.assertIsNotNone(b)
        self.assertAlmostEqual(b.lower, 100.0)
        self.assertAlmostEqual(b.upper, 100.2)
        self.assertAlmostEqual(b.step, 0.05)

    def test_flat_closes_have_no_bounds(self):
        self.assertIsNone(grid_core.compute_bounds([100.0] * 20, 4))


class TestTrendFilter(unittest.TestCase):
    def test_steady_rise_is_trending(self):
        closes = [100 + 2 * i for i in range(25)]
        self.assertTrue(grid_core.is_trending(closes, 20))

    def test_oscillation_is_not_trending(self):
        self.assertFalse(grid_core.is_trending(oscillating(25), 20))


class TestDetectEntry(unittest.TestCase):
    PARAMS = grid_core.GridParams(grid_count=4, lookback=20, stop_percent=2,
                                  min_step_percent=0)

    def _base_candles(self):
        # 前 24 根震荡确立 bounds(100~100.2, step 0.05)，格位
        # L1=100.05 L2=100.10 L3=100.15 L4=100.20
        candles = candles_from_closes(oscillating(24))
        # 末根：prevClose=100.2 > L3，低点 100.0 触及 L3（L4 需要 prevClose>100.20）
        candles.append([100.2, 100.2, 100.0, 100.2])
        return candles

    def test_low_touch_triggers_entry_at_highest_touched_level(self):
        hit = grid_core.detect_entry(self._base_candles(), self.PARAMS)
        self.assertIsNotNone(hit)
        self.assertEqual(hit['level'], 3)
        self.assertAlmostEqual(hit['level_price'], 100.15)
        self.assertAlmostEqual(hit['fill'], 100.15)  # min(open, level)
        self.assertAlmostEqual(hit['tp'], 100.20)    # level + step

    def test_open_below_level_fills_at_open(self):
        candles = self._base_candles()
        candles[-1][0] = 100.10  # open below L3 -> fill at open
        hit = grid_core.detect_entry(candles, self.PARAMS)
        self.assertAlmostEqual(hit['fill'], 100.10)

    def test_trending_market_blocks_entry(self):
        candles = candles_from_closes([100 + 2 * i for i in range(24)])
        candles.append([148.0, 148.0, 140.0, 148.0])
        self.assertIsNone(grid_core.detect_entry(candles, self.PARAMS))

    def test_min_step_guard_blocks_tiny_steps(self):
        candles = self._base_candles()
        params = grid_core.GridParams(grid_count=4, lookback=20, stop_percent=2,
                                      min_step_percent=0.3)
        # step 0.05 = 0.05% < 0.3% 下限 -> 挡掉
        self.assertIsNone(grid_core.detect_entry(candles, params))
        # 关掉下限后恢复（证明就是这道校验在挡）
        self.assertIsNotNone(grid_core.detect_entry(candles, self.PARAMS))

    def test_no_touch_no_entry(self):
        candles = self._base_candles()
        # low 100.16：高于 L3(100.15) 又够不到 L4 的穿越条件 -> 不触发
        candles[-1][2] = 100.16
        self.assertIsNone(grid_core.detect_entry(candles, self.PARAMS))


class TestDetectAdd(unittest.TestCase):
    PARAMS = grid_core.GridParams(grid_count=4, lookback=20, stop_percent=2,
                                  min_step_percent=0)

    def _plan_with_first_layer(self):
        closes = oscillating(24)
        bounds = grid_core.compute_bounds(closes, 4, 20)
        plan = grid_core.GridPlan(pair='T/USDT:USDT', params=self.PARAMS)
        plan.levels.append(grid_core.GridLevel(
            level=3, level_price=grid_core.level_price(bounds, 4, 3),
            fill=100.15, tp=grid_core.level_price(bounds, 4, 3) + bounds.step))
        return plan, bounds

    def test_add_at_next_unoccupied_level(self):
        plan, bounds = self._plan_with_first_layer()
        candles = candles_from_closes(oscillating(24))
        candles.append([100.15, 100.15, 100.02, 100.15])  # low touches L2=100.10
        hit = grid_core.detect_add(candles, plan)
        self.assertIsNotNone(hit)
        self.assertEqual(hit['level'], 2)
        self.assertAlmostEqual(hit['level_price'], 100.10)

    def test_occupied_level_skipped(self):
        plan, _ = self._plan_with_first_layer()
        candles = candles_from_closes(oscillating(24))
        candles.append([100.15, 100.15, 100.10, 100.15])  # touches L2 & L3
        hit = grid_core.detect_add(candles, plan)
        self.assertEqual(hit['level'], 2)  # L3 occupied -> next is L2

    def test_trending_blocks_add(self):
        plan, _ = self._plan_with_first_layer()
        candles = candles_from_closes([100 + 2 * i for i in range(24)])
        candles.append([148.0, 148.0, 140.0, 148.0])
        self.assertIsNone(grid_core.detect_add(candles, plan))


class TestPlan(unittest.TestCase):
    PARAMS = grid_core.GridParams(grid_count=4, lookback=20, stop_percent=2,
                                  min_step_percent=0)

    def _plan(self):
        plan = grid_core.GridPlan(pair='T/USDT:USDT', params=self.PARAMS)
        plan.levels = [
            grid_core.GridLevel(level=3, level_price=100.15, fill=100.15, tp=100.20),
            grid_core.GridLevel(level=2, level_price=100.10, fill=100.10, tp=100.15),
            grid_core.GridLevel(level=1, level_price=100.05, fill=100.05, tp=100.10),
        ]
        return plan

    def test_tp_hit_returns_lowest_tp_layer(self):
        plan = self._plan()
        self.assertIsNone(grid_core.layer_tp_hit(plan, 100.09))
        hit = grid_core.layer_tp_hit(plan, 100.12)
        self.assertEqual(hit.level, 1)  # tp 100.10 first

    def test_stop_uses_lowest_remaining_fill(self):
        plan = self._plan()
        self.assertAlmostEqual(plan.stop_price, 100.05 * 0.98)
        # 最深一层止盈离场后，止损上移
        plan.levels = [l for l in plan.levels if l.level != 1]
        self.assertAlmostEqual(plan.stop_price, 100.10 * 0.98)

    def test_state_roundtrip(self):
        plan = self._plan()
        plan.trade_id = 42
        plan.last_seen_ms = 123
        restored = grid_core.GridPlan.from_dict(plan.to_dict())
        self.assertEqual(restored.trade_id, 42)
        self.assertEqual(len(restored.levels), 3)
        self.assertAlmostEqual(restored.levels[1].fill, 100.10)
        self.assertAlmostEqual(restored.stop_price, plan.stop_price)


if __name__ == '__main__':
    unittest.main()
