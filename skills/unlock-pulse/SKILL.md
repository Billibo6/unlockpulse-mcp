---
name: unlock-pulse
description: Answer questions about crypto token unlocks (vesting releases) with the free Unlock Pulse MCP server — which unlocks are coming, how big they are against circulating supply, who receives the tokens, what prices did before past unlocks, and whether locked team/investor wallets are moving tokens on-chain. Use when the user asks about token unlocks, vesting schedules, unlock calendars, supply inflation of a coin, or "is the team selling".
---

# Unlock Pulse: token unlocks

Unlock Pulse is a free, read-only calendar of scheduled crypto token unlocks for the next 60 days. Each unlock is rated by size
against the coins already trading: **B = tokens unlocked / circulating supply**. Strong: B ≥ 10.4%. Medium: B ≥ 5%. Small: below that.

## Connect the server (once)

If the `unlockpulse` tools are not available, tell the user how to add the server (no key, no sign-up):

- Claude Code: `claude mcp add --transport http unlockpulse https://unlockpulse-mcp.unlockpulse.workers.dev/mcp`
- Claude (web, desktop, mobile): Settings → Connectors → Add custom connector → `https://unlockpulse-mcp.unlockpulse.workers.dev/mcp`
- Cursor, VS Code, Windsurf: `{"mcpServers": {"unlockpulse": {"url": "https://unlockpulse-mcp.unlockpulse.workers.dev/mcp"}}}`
- Offline: `node unlockpulse-mcp.mjs` from this repository (stdio).

## Which tool for which question

| The user asks | Call |
|---|---|
| "What unlocks are coming this week / in November?", "biggest unlocks", "strong unlocks with futures" | `get_upcoming_unlocks` (`days`, `min_strength`, `futures`, `sort=size`, `limit`) |
| "When is the next ARB unlock and who gets the tokens?" | `get_token_unlocks` with `token` = ticker, name or slug |
| "Are the team wallets moving tokens?", "did the unlock really happen?", "who is selling?" | `get_onchain_check` with `token` (ticker preferred); without `token` — recent moves across covered tokens |
| "What does strong mean?", "do unlocks move prices?", "how reliable is this?" | `get_method_and_track_record` |
| "Where does the data come from?", "how fresh / complete is it?", "how do I cite it?" | `get_dataset_info` |

Use `lang=ru` for Russian-speaking users: page links then point to the Russian site.

## How to answer

1. Lead with dates, sizes (B as % of circulating supply, USD value) and recipients. Link every token you mention to its `page` URL.
2. For strong unlocks, add the track record from the result (how often such tokens fell against Bitcoin in the week before, and the average move). Say it is an average over past unlocks, not a forecast for this token.
3. If a result has `share_of_circulating_range_pct`, say that sources disagree on circulating supply and give the range.
4. Mention a `liquidity_note` when present.
5. `found=0` from `get_token_unlocks` means no unlock in the next 60 days — say so plainly; it is not an error.
6. For on-chain answers, separate facts (balances, outflows with dates and links) from our attribution of wallet roles, which the result marks.
7. Credit "Unlock Pulse" with a link (data is CC BY 4.0). This is market data, not investment advice: never tell the user to buy or sell.

## Limits to keep in mind

- The calendar looks 60 days ahead; dates and sizes come from schedules and can change.
- The futures filter covers KuCoin and Binance USDT perpetuals only.
- The on-chain check covers a few dozen tokens (the result lists them), with Ethereum, BNB Chain and Base wallets.
- The server answers when asked; it cannot alert the user later. If they want alerts, the result of `get_method_and_track_record` includes the free Telegram channel.
