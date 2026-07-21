import importlib.util
import pathlib
import unittest


MODULE = pathlib.Path(__file__).parents[1] / 'strategies' / 'futures_risk.py'
SPEC = importlib.util.spec_from_file_location('futures_risk', MODULE)
futures_risk = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(futures_risk)


class FuturesRiskTests(unittest.TestCase):
    def test_sizes_from_risk_budget_not_leverage(self):
        plan = futures_risk.calculate_position_plan(10_000, 0.005, 100, 98, 2, 5_000, 2_000)
        self.assertEqual(plan.notional, 2_500)
        self.assertEqual(plan.margin, 1_250)
        self.assertEqual(plan.max_loss, 50)

    def test_limits_notional_by_available_margin(self):
        plan = futures_risk.calculate_position_plan(10_000, 0.005, 100, 99, 2, 5_000, 1_000)
        self.assertEqual(plan.notional, 2_000)
        self.assertEqual(plan.margin, 1_000)

    def test_stop_must_be_clear_of_liquidation(self):
        self.assertTrue(futures_risk.stop_is_clear_of_liquidation('long', 102, 100))
        self.assertFalse(futures_risk.stop_is_clear_of_liquidation('long', 100.5, 100))
        self.assertTrue(futures_risk.stop_is_clear_of_liquidation('short', 98, 100))


if __name__ == '__main__':
    unittest.main()
