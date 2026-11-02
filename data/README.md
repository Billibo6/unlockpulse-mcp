# Data

Snapshots of the Unlock Pulse monthly unlock lists. The live versions are regenerated every hour on the website:

| File here | Live version | Snapshot taken |
|---|---|---|
| `token-unlocks-2026-11.csv` | https://billibo6.github.io/unlockpulse/report/2026-11.csv | 2026-11-02 |

Full upcoming calendar (next 60 days, JSON): https://billibo6.github.io/unlockpulse/data.json
On-chain check of locked-allocation wallets (JSON): https://billibo6.github.io/unlockpulse/onchain.json

## Columns (CSV)

| Column | Meaning |
|---|---|
| `date_utc` | Unlock date and time, UTC |
| `symbol`, `name` | Token |
| `strength` | strong (B ≥ 10.4%), medium (B ≥ 5%), small |
| `share_of_circulating_pct` | B: tokens unlocked as % of circulating supply |
| `share_of_total_supply_pct` | Tokens unlocked as % of total supply |
| `value_usd` | Value at the time of the snapshot |
| `type` | cliff (one-off) or linear (part of a stream) |
| `recipients` | Who receives the tokens, per the schedule |
| `futures` | USDT perpetuals available on KuCoin / Binance |
| `page` | Token page with history and sources |

## License

Our ratings and derived columns: CC BY 4.0, credit "Unlock Pulse" with a link. Unlock schedules are compiled from
CoinMarketCap and DefiLlama and remain subject to their terms. Dates and sizes can change; check the token page.
