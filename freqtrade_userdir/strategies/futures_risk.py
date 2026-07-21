"""Pure risk calculations shared by the futures strategy and control services."""

from dataclasses import dataclass


@dataclass(frozen=True)
class PositionPlan:
    notional: float
    margin: float
    max_loss: float
    stop_distance: float


def calculate_position_plan(
    equity: float,
    risk_fraction: float,
    entry_price: float,
    stop_price: float,
    leverage: float,
    max_notional: float,
    available_margin: float,
) -> PositionPlan:
    """Size a futures position from the amount that may be lost at the stop.

    The resulting notional is constrained both by the configured cap and by
    available isolated margin.  Leverage changes required margin, not risk.
    """
    if equity <= 0 or not 0 < risk_fraction <= 1:
        raise ValueError('equity and risk_fraction must be positive')
    if entry_price <= 0 or stop_price <= 0 or entry_price == stop_price:
        raise ValueError('entry_price and stop_price must be different positive values')
    if leverage <= 0 or max_notional <= 0 or available_margin <= 0:
        raise ValueError('leverage, max_notional, and available_margin must be positive')

    stop_distance = abs(entry_price - stop_price) / entry_price
    risk_budget = equity * risk_fraction
    risk_limited_notional = risk_budget / stop_distance
    margin_limited_notional = available_margin * leverage
    notional = min(risk_limited_notional, max_notional, margin_limited_notional)
    margin = notional / leverage

    return PositionPlan(
        notional=notional,
        margin=margin,
        max_loss=notional * stop_distance,
        stop_distance=stop_distance,
    )


def stop_is_clear_of_liquidation(
    side: str,
    stop_price: float,
    liquidation_price: float,
    minimum_buffer: float = 0.01,
) -> bool:
    """Require a 1% buffer between the protective stop and liquidation."""
    if side not in {'long', 'short'}:
        raise ValueError('side must be long or short')
    if stop_price <= 0 or liquidation_price <= 0 or minimum_buffer < 0:
        raise ValueError('prices must be positive and minimum_buffer non-negative')
    if side == 'long':
        return stop_price > liquidation_price * (1 + minimum_buffer)
    return stop_price < liquidation_price * (1 - minimum_buffer)
