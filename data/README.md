# Data

Snapshots of the Unlock Pulse monthly unlock lists. The live versions are regenerated every hour on the website:

| File here | Live version | Snapshot taken |
|---|---|---|
| `token-unlocks-2026-11.csv` | https://billibo6.github.io/unlockpulse/report/2026-11.csv | 2026-11-02 |
| `recipient-habits-2026-11-03.json` | https://billibo6.github.io/unlockpulse/recipient_habits.json | 2026-11-03 |

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

## Recipient selling habit (JSON)

Per coin: how often the recipients of past unlocks sent at least 10% of the tokens to exchanges, market makers or DEXes within 7 days.
Sample: 139 unlocks of 27 coins, November 2025 to October 2026, Ethereum only. A label (`usually sells`, `usually holds`, `mixed`) is given only
with 3 or more past unlocks. Reference only, not a trading signal: on this sample the habit did not predict price. No wallet addresses.
Method: https://billibo6.github.io/unlockpulse/method.html#recipient-habit

## License

Our ratings and derived columns: CC BY 4.0, credit "Unlock Pulse" with a link. Unlock schedules are compiled from
CoinMarketCap and DefiLlama and remain subject to their terms. Dates and sizes can change; check the token page.
