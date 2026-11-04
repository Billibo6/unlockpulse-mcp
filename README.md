# Unlock Pulse MCP

Token unlock calendar for AI assistants. Ask Claude, ChatGPT or Cursor which crypto token unlocks are coming, how big they are against
the coins already trading, who receives the tokens, and what prices did before similar unlocks in the past.

Free, read-only, no key, no sign-up. Website: https://billibo6.github.io/unlockpulse/
Telegram alerts about 24h before each unlock of 2%+ of supply: https://t.me/+22nzXAYLCGsyMzJi

## Connect

Remote server (recommended): `https://unlockpulse-mcp.unlockpulse.workers.dev/mcp` (Streamable HTTP).

- **Claude Code:** `claude mcp add --transport http unlockpulse https://unlockpulse-mcp.unlockpulse.workers.dev/mcp`
- **Claude (web, desktop, mobile):** Settings → Connectors → Add custom connector → paste the address.
- **ChatGPT:** Settings → Apps & Connectors → Advanced → Developer mode → Create → paste the address.
- **Cursor, VS Code, Windsurf** (`mcp.json`):
  ```json
  {"mcpServers": {"unlockpulse": {"url": "https://unlockpulse-mcp.unlockpulse.workers.dev/mcp"}}}
  ```

Run it locally instead (one file, Node 18+, no dependencies):

```json
{"mcpServers": {"unlockpulse": {"command": "node", "args": ["/path/to/unlockpulse-mcp.mjs"]}}}
```

Also listed in the official MCP Registry as `io.github.Billibo6/unlockpulse`.

## Tools

| Tool | What it returns |
|---|---|
| `get_upcoming_unlocks` | Unlocks in the next 1–60 days, rated strong / medium / small, filters by size and futures availability |
| `get_token_unlocks` | Every scheduled unlock of one token: date, size, USD value, recipients, futures, and for some coins how often recipients of past unlocks sold (reference only, not a signal) |
| `get_onchain_check` | What the wallets holding locked team, investor and treasury tokens do on-chain: balances, outflows, findings |
| `get_method_and_track_record` | How the rating works and how prices moved before past unlocks of each strength |
| `get_dataset_info` | Data freshness, coverage, sources, formula, limitations and how to cite |

Strength: **B = tokens unlocked / circulating supply**. Strong: B ≥ 10.4%, medium: B ≥ 5%.

## Skill

`skills/unlock-pulse/SKILL.md` tells Claude which tool to call for which question and how to present the answer.

```
npx skills add Billibo6/unlockpulse-mcp
```

## Data

Monthly unlock lists as CSV (snapshots; live versions update hourly) are in [`data/`](data/). Open data: CC BY 4.0.

Research dataset (unlock ratings, 7-day event study against Bitcoin around 304 past unlocks, date checks, schedule changes, on-chain checks): [doi.org/10.5281/zenodo.23949644](https://doi.org/10.5281/zenodo.23949644) on Zenodo, CC BY 4.0.

## Example questions

- "Which strong token unlocks are coming in the next two weeks?"
- "Biggest unlocks with perpetual futures on Binance this month."
- "When is the next ARB unlock, and who gets the tokens?"
- "Have the team and investor wallets of this token moved anything? Did the unlock really happen?"

## Data and license

Code: MIT. Data served by the tools (our ratings, track record, on-chain measurements, texts): CC BY 4.0, keep the link to Unlock Pulse.
Unlock schedules are compiled from CoinMarketCap and DefiLlama and remain subject to their terms. Market data, not investment advice.

## Test

```
node test.mjs
```

The tests call the live data file, so they need internet access.
