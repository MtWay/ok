# 排查：手动/自动平仓全部返回 502 invalid argument

## 现象

- WebUI 手动平仓（对手价、市价均失败）：`forceexit failed (502): {"error":"Error querying /api/v1/forceexit: invalid argument"}`
- freqtrade 日志：`freqtrade.rpc.rpc - WARNING - force_exit: Invalid argument received` + `freqtrade.rpc.api_server.webserver - ERROR - API Error calling: invalid argument`
- 首次失败 2026-09-30 11:15:35，紧邻事件是 11:10:47 的交易所重新初始化（`Applying additional ccxt config` / `Done initializing 478 markets`）
- 每次 ~30ms 内返回；手动与自动（`syncPlanPositions`）路径同时失效

## 已排除

- **不是 API 接错**：`/api/v1/forceexit` + `{tradeid, ordertype}` 契约正确。字段名/类型不对会被 pydantic 挡在 422，根本进不了业务逻辑；实际是 502。
- **不是 ordertype/price 问题**：市价回退请求体与改动前逐字节相同，同样失败。
- **不是新功能引入的**：自动平仓路径也在失败。
- **不是 `config_okx_futures_dryrun.json` 的白名单改动**。

## freqtrade 源码依据

```python
# freqtrade/rpc/rpc.py  _rpc_force_exit
trade = Trade.get_trades(
    trade_filter=[Trade.id == trade_id, Trade.is_open.is_(True)]
).first()
if not trade:
    logger.warning("force_exit: Invalid argument received")
    raise RPCException("invalid argument")
```

含义只有一个：**freqtrade 库里没有这个 id 的未平仓交易**。30ms 本地返回也印证了是纯数据库查询，没碰交易所。

## 待执行诊断（只读，不下单）

在服务器上执行，输出贴回来：

```bash
cd /work/ok/freqtrade-webui/notify-service && set -a && . ./.env && set +a && echo "=== freqtrade 实际持仓 ===" && curl -s -u "$FREQTRADE_API_USER:$FREQTRADE_API_PASSWORD" "$FREQTRADE_API_URL/api/v1/status" | python3 -c "import sys,json;d=json.load(sys.stdin);[print(' ',p['trade_id'],p['pair'],'short=',p['is_short'],'amount=',p['amount'],'open=',p['is_open']) for p in d.get('open_positions',[])]"; echo "=== notify-service 记录的 open plan ==="; python3 -c "import json;d=json.load(open('data/trade-plans.json'));[print(' ',p['id'],p.get('tradeId'),p['pair'],p['status']) for p in d if p.get('tradeId') and p['status']=='open']"
```

## 结果判读

| 现象 | 结论 |
| --- | --- |
| 两段 tradeId 对得上，但 freqtrade 报 invalid | freqtrade 侧该 trade 的 `is_open` 不为 true，需查库/重启后的状态恢复 |
| freqtrade 那段为空，只有 notify-service 有 id | 重启时换了 `database.sqlite`（`--userdir`/`--datadir` 变了）或库被重置，需先对齐两边 |
| 两段都有但 id 不同 | notify-service 记的是旧库的 id |

## 紧急程度

11:15 起该 bot 无法平掉任何仓位（手动与自动皆然）。若确认是库错位，重启 freqtrade 让它重新接管实际仓位；若重启后立刻复现，说明是配置或仓位数据本身损坏，再继续往下查。
