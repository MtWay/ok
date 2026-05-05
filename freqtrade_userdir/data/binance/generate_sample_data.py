import pandas as pd
import numpy as np
import os
from datetime import datetime, timedelta

np.random.seed(42)

pairs = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT']
start_date = datetime(2024, 1, 1)
end_date = datetime(2025, 5, 1)

for pair in pairs:
    dates = pd.date_range(start=start_date, end=end_date, freq='1h')
    n = len(dates)

    base_prices = {
        'BTC_USDT': 42000,
        'ETH_USDT': 2200,
        'SOL_USDT': 100,
        'XRP_USDT': 0.6,
        'DOGE_USDT': 0.08
    }
    base = base_prices[pair]

    returns = np.random.normal(0.0002, 0.02, n)
    trend = np.sin(np.linspace(0, 8 * np.pi, n)) * 0.1
    prices = base * np.exp(np.cumsum(returns + trend * 0.001))

    df = pd.DataFrame({
        'date': dates.astype('int64') // 10**9,
        'open': prices * (1 + np.random.normal(0, 0.001, n)),
        'high': prices * (1 + np.abs(np.random.normal(0, 0.015, n))),
        'low': prices * (1 - np.abs(np.random.normal(0, 0.015, n))),
        'close': prices,
        'volume': np.random.uniform(100, 10000, n) * base
    })

    df['high'] = df[['open', 'high', 'low', 'close']].max(axis=1)
    df['low'] = df[['open', 'high', 'low', 'close']].min(axis=1)

    os.makedirs(f'f:/work1/k/freqtrade_userdir/data/binance', exist_ok=True)
    filepath = f'f:/work1/k/freqtrade_userdir/data/binance/{pair}-1h.feather'
    df.to_feather(filepath)
    print(f'Generated {filepath}: {len(df)} rows')
