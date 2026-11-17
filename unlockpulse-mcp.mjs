// Unlock Pulse MCP server: token unlock calendar for AI assistants (Claude, ChatGPT, Cursor, ...).
// One file, two modes:
//   * remote: Cloudflare Worker (export default { fetch }) — MCP Streamable HTTP at /mcp, stateless JSON responses;
//   * local:  `node unlockpulse-mcp.mjs` — MCP over stdio.
// Data: the public open-data file of https://billibo6.github.io/unlockpulse/ (data.json, refreshed hourly; our ratings and texts CC BY 4.0, unlock schedules subject to their sources' terms).
// Read-only, no keys, no user data stored.

const SITE = "https://billibo6.github.io/unlockpulse";
const DATA_URL = SITE + "/data.json";
// 1.10.0 (04.11): ссылки на Telegram из ответов убраны — каталоги (Claude Directory, OpenAI) отклоняют промо в ответах сервера.
// 1.11.0 (17.11): exact token matching (substring only as did_you_mean), coverage (known vs unknown token), disputed flag on
// unlocks where the project's documents differ, get_disputed_unlocks, check_portfolio, strict argument validation, detail=brief.
const VERSION = "1.11.0";
const ONCHAIN_URL = SITE + "/onchain.json";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const TTL_MS = 10 * 60 * 1000;

const INSTRUCTIONS =
  "Unlock Pulse tracks scheduled token unlocks (vesting releases) for the next 60 days and rates each by size: " +
  "B = tokens unlocked / circulating supply; strong >= 10.4%, medium >= 5%, small below. " +
  "Use get_upcoming_unlocks for a calendar, get_token_unlocks for one coin, check_portfolio for a list of coins, " +
  "get_disputed_unlocks for unlocks where the calendar and the project's own documents disagree, get_method_and_track_record for how the rating works " +
  "and what happened to prices before past unlocks, get_onchain_check for what the wallets holding locked team / investor / treasury tokens " +
  "actually do on-chain (balances, outflows, findings such as unlocked-but-not-withdrawn or tranches sent to exchanges), " +
  "get_dataset_info for coverage, freshness, sources and citation. " +
  "Unlock schedules are compiled from CoinMarketCap and DefiLlama, for some tokens checked against the project's own documents. " +
  "Each unlock has a page URL with details; the license field gives the attribution terms (CC BY 4.0). " +
  "share_of_circulating_range_pct means sources disagree on circulating supply; liquidity_note marks thinly traded tokens; " +
  "disputed=true means the project's documents give a different amount or date than the calendar: report both versions, not only the calendar one. " +
  "Token lookups match exactly (ticker, slug or name); coverage=unknown_token means the token is not in our data, which is not evidence that it has no unlocks. " +
  "results for strong unlocks carry the historical track record. lang=ru returns Russian page links. " +
  "The server only answers when asked. This is market data, not investment advice.";

let cache = { at: 0, data: null };
let ocache = { at: 0, data: null };
async function loadOnchain(fetchImpl) {
  if (ocache.data && Date.now() - ocache.at < TTL_MS) return ocache.data;
  let r;
  try {
    r = await fetchImpl(ONCHAIN_URL, { headers: { "User-Agent": "unlockpulse-mcp/" + VERSION, Accept: "application/json" } });
  } catch (e) {
    if (ocache.data) return ocache.data;
    throw new Error("Unlock Pulse on-chain data is unavailable right now. Try again in a few minutes.");
  }
  if (!r.ok) {
    if (ocache.data) return ocache.data;
    throw new Error("Unlock Pulse on-chain data is unavailable right now (HTTP " + r.status + "). Try again in a few minutes.");
  }
  ocache = { at: Date.now(), data: await r.json() };
  return ocache.data;
}
function findOnchain(oc, q, data) {
  const T = oc.tokens || {};
  const up = q.toUpperCase();
  if (T[up]) return T[up];
  const byName = Object.values(T).find((t) => (t.name || "").toLowerCase() === q);
  if (byName) return byName;
  const ev = (data.events || []).find((e) => (e.slug || "").toLowerCase() === q || (e.name || "").toLowerCase() === q);
  return ev && T[ev.sym] ? T[ev.sym] : null;
}
async function loadData(fetchImpl) {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  let r;
  try {
    r = await fetchImpl(DATA_URL, { headers: { "User-Agent": "unlockpulse-mcp/" + VERSION, Accept: "application/json" } });
  } catch (e) {
    if (cache.data) return cache.data;
    throw new Error("Unlock Pulse data is unavailable right now. Try again in a few minutes.");
  }
  if (!r.ok) {
    if (cache.data) return cache.data; // stale is better than nothing
    throw new Error("Unlock Pulse data is unavailable right now (HTTP " + r.status + "). Try again in a few minutes.");
  }
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}

const round = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
const pageOf = (e, lang) => `${SITE}/${lang === "ru" ? "ru/" : ""}unlock/${e.slug}.html`;
const LABEL = { strong: "strong (>= 10.4% of circulating supply)", medium: "medium (5 to 10.4%)", small: "small (< 5%)" };
const ORDER = { strong: 3, medium: 2, small: 1 };

function futuresOf(e) {
  const f = [];
  if (e.kucoin) f.push("KuCoin");
  if (e.binance) f.push("Binance");
  return f;
}

// 1.11.0: strength by the same thresholds as the site (data.method), for the documents' version of a disputed unlock.
function strengthOf(B, data) {
  const m = (data && data.method) || {};
  if (B == null || !isFinite(B)) return null;
  return B >= (m.strong || 0.104) ? "strong" : B >= (m.medium || 0.05) ? "medium" : "small";
}
// 1.11.0: an unlock is disputed when our reading of the project's documents gives another amount or another date.
function disputeOf(e, data) {
  const d = e.verify && e.verify.docs;
  if (!d || (d.match !== "amount_differs" && d.match !== "date_differs")) return null;
  const x = { reason: d.match, document_date: d.doc_date || null, document_share_of_total_supply_pct: d.doc_pct_total == null ? null : round(d.doc_pct_total, 3) };
  // the documents' share of circulating supply: same circulating supply, the documents' amount
  if (d.doc_pct_total != null && e.pct_total > 0 && e.B != null) {
    const B2 = (e.B * d.doc_pct_total) / e.pct_total;
    x.document_share_of_circulating_pct = round(B2 * 100, 2);
    x.strength_by_documents = strengthOf(B2, data);
  }
  const cal = round(e.pct_total, 3), day = String(e.date).slice(0, 10);
  x.summary = d.match === "amount_differs"
    ? `Sources disagree on the amount: the calendar source gives ${cal}% of total supply on ${day}, the project's documents give ${x.document_share_of_total_supply_pct}%${d.doc_date && d.doc_date !== day ? " (on " + d.doc_date + ")" : ""}.`
    : `Sources disagree on the date: the calendar source gives ${day}, the project's documents give ${d.doc_date || "another date"}${x.document_share_of_total_supply_pct != null ? " (" + x.document_share_of_total_supply_pct + "% of total supply there, " + cal + "% in the calendar)" : ""}.`;
  return x;
}

function shape(e, now, lang, detail, data) {
  const o = {
    symbol: e.sym,
    name: e.name,
    date_utc: e.date,
    days_left: round((Date.parse(e.date) - now) / 86400000, 1),
    hours_left: round((Date.parse(e.date) - now) / 3600000, 1),
    strength: e.strength,
    share_of_circulating_pct: round(e.B * 100, 2),
    share_of_total_supply_pct: round(e.pct_total, 3),
    value_usd: e.usd == null ? null : Math.round(e.usd),
    kind: e.type, // cliff = one-off release, linear = part of a continuous schedule
    recipients: (e.alloc || []).slice(0, 4),
    perpetual_futures_on: futuresOf(e),
    market_cap_usd: e.mcap == null ? null : Math.round(e.mcap),
    price_change_7d_pct: round(e.chg7d, 1),
    volume_24h_usd: e.vol24 == null ? null : Math.round(e.vol24),
    page: pageOf(e, lang),
  };
  if (e.source === "project") {
    o.numbers_from = "project documents";
    if (e.agg_pct_total != null) o.aggregator_share_of_total_supply_pct = round(e.agg_pct_total, 3);
  }
  if (Array.isArray(e.b_range) && e.b_range.length === 2 && e.b_range[0] != null && e.b_range[1] != null) {
    o.share_of_circulating_range_pct = [round(e.b_range[0] * 100, 1), round(e.b_range[1] * 100, 1)];
    o.range_note = "CoinMarketCap and the project report different circulating supply, so the real share is somewhere in this range.";
  }
  if (e.vol24 != null && e.vol24 < 250000) o.liquidity_note = "Low liquidity: under $250K traded in 24 hours.";
  if (e.data_check) o.warning = "Numbers look inconsistent (unlock value vs market cap); treat with caution.";
  if (e.unpriced) o.warning = "No reliable price for this token; USD value and market cap may be missing.";
  if (e.date_unconfirmed) {
    o.date_confirmed = false;
    o.warning = (o.warning ? o.warning + " " : "") + "Exact date not confirmed: CoinMarketCap files unlocks with an unknown day on the 1st of the month at 00:00 UTC, and no other source confirms this date. Treat it as 'some time this month'.";
  } else if (e.date_moved && e.agg_date) {
    o.date_confirmed = true;
    const mid = e.date_src && e.date_src.kind === "midnight";
    o.date_note = `CoinMarketCap shows ${e.agg_date.slice(0, 16).replace("T", " ")} UTC${mid ? " (a date with no published time of day; the project's schedule puts the unlock a day later)" : " (a placeholder for an unknown day)"}; the date above comes from ${(e.date_src && e.date_src.source || "").includes("card") ? "the project's own documents" : "Tokenomist"}.${e.time_unknown ? " Exact time not published." : ""}`;
  } else if (e.date_src && e.date_src.status === "confirmed") {
    o.date_confirmed = true;
    if (e.date_src.url) o.date_source_url = e.date_src.url;
  }
  const h = e.recipient_habit; // 1.9.5: per-coin recipient selling habit (Ethereum, past unlocks); reference only, not a trading signal
  if (h && h.label) {
    o.recipient_selling_habit = {
      label: h.label, // usually sells | usually holds | mixed
      past_unlocks_traced: h.past_events,
      past_unlocks_sold: h.events_sold, // at least 10% sent to exchanges, market makers or DEXes within 7 days
      median_sent_pct: h.median_sent_pct,
      main_venue_type: h.main_venue_type,
      main_venues: h.main_venues || [],
      last_traced_unlock: h.last_event,
      chain: h.chain || "ethereum",
      note: "Reference only, not a trading signal: on our sample (139 unlocks, 27 coins) this habit did not predict price.",
      method: h.method || SITE + "/method.html#recipient-habit",
    };
  }
  const v = e.verify;
  if (v && (v.docs || v.chain)) {
    const d = v.docs, c = v.chain;
    const pc = {};
    if (d) {
      pc.project_documents = d.match || "no_matching_event";
      if (d.doc_date) pc.document_date = d.doc_date;
      if (d.doc_pct_total != null) pc.document_share_of_total_supply_pct = round(d.doc_pct_total, 3);
      if (d.match === "date_differs") o.warning = `The project's own documents point to a different date (${d.doc_date}); treat the date above with caution.`;
      if (d.note) { pc.project_note = d.note; o.warning = (o.warning ? o.warning + " " : "") + d.note; }
    }
    if (c) {
      pc.watched_allocation_wallets = c.buckets;
      pc.last_confirmed_onchain_outflow = c.last_outflow ? c.last_outflow.day : null;
    }
    if (detail) {
      if (d) pc.document_sources = d.sources;
      if (v.contract) pc.token_contract = v.contract;
      pc.legend = "match: same date and amount in the project's documents; partial: same date, documents cover part of the supply; amount_differs: same date, different amount; date_differs: documents give another date; not_in_documented_part: documents schedule only part of the supply and that part has no unlock on this date (document_date is the next one there); continuous: documents describe daily vesting, so the date is a convention. Our own reading of primary sources.";
    }
    o.primary_source_check = pc;
  }
  const dq = disputeOf(e, data);
  if (dq) {
    o.disputed = true;
    o.dispute_reason = dq.reason;
    o.dispute_summary = dq.summary;
    if (dq.document_share_of_circulating_pct != null) o.share_of_circulating_pct_by_documents = dq.document_share_of_circulating_pct;
    if (dq.strength_by_documents) o.strength_by_documents = dq.strength_by_documents;
  }
  if (detail) {
    o.recipients_detail = (e.alloc_detail || []).map((a) => ({ name: a.name, value_usd: Math.round(a.usd || 0), kind: a.type }));
    o.fdv_usd = e.fdv == null ? null : Math.round(e.fdv);
    o.already_unlocked_pct = round(e.unlocked_pct, 1);
    o.data_source = e.source === "project" ? "The project's own documents (our tokenomics card); see primary_source_check" : e.source === "cmc" ? "CoinMarketCap unlock calendar" : e.source === "manual" ? "Checked by hand against the project's schedule (see date_source_url)" : e.source ? "DefiLlama emissions" : null;
    o.add_to_calendar = `${SITE}/unlock/${e.slug}.ics`;
  }
  return o;
}

// 1.11.0: compact row for long lists (detail=brief) and for check_portfolio.
function brief(e, now, lang, data) {
  const f = shape(e, now, lang, false, data);
  const o = { symbol: f.symbol, name: f.name, date_utc: f.date_utc, days_left: f.days_left, strength: f.strength,
    share_of_circulating_pct: f.share_of_circulating_pct, value_usd: f.value_usd, perpetual_futures_on: f.perpetual_futures_on, page: f.page };
  for (const k of ["share_of_circulating_range_pct", "disputed", "dispute_reason", "dispute_summary", "share_of_circulating_pct_by_documents", "strength_by_documents", "date_confirmed", "liquidity_note", "warning"])
    if (f[k] !== undefined) o[k] = f[k];
  return o;
}

// 1.11.0: exact token resolution. Known tokens = everything in data.json (calendar) + everything in onchain.json (tracked wallets).
// A substring never selects a token: it only produces did_you_mean.
const normQ = (v) => String(v ?? "").trim().replace(/^\$/, "").toLowerCase();
function nameAliases(name) {
  const n = String(name || "").toLowerCase().trim();
  const a = new Set();
  if (!n) return a;
  a.add(n);
  const m = n.match(/^(.*?)\s*\((.+)\)\s*$/); // "BOB (Build on Bitcoin)" -> "bob", "build on bitcoin"
  if (m) { if (m[1]) a.add(m[1].trim()); if (m[2]) a.add(m[2].trim()); }
  return a;
}
function knownTokens(data, oc) {
  const K = new Map();
  for (const e of (data && data.events) || []) {
    if (!e || !e.sym) continue;
    const k = K.get(e.sym) || { symbol: e.sym, name: e.name || null, slugs: new Set(), names: new Set(), in_calendar: false, onchain: false };
    k.in_calendar = true;
    if (e.slug) k.slugs.add(String(e.slug).toLowerCase());
    for (const n of nameAliases(e.name)) k.names.add(n);
    K.set(e.sym, k);
  }
  for (const [sym, t] of Object.entries((oc && oc.tokens) || {})) {
    const k = K.get(sym) || { symbol: sym, name: (t && t.name) || null, slugs: new Set(), names: new Set(), in_calendar: false, onchain: false };
    k.onchain = true;
    for (const n of nameAliases(t && t.name)) k.names.add(n);
    K.set(sym, k);
  }
  return [...K.values()];
}
function resolveToken(q, known) {
  if (!q) return { token: null, matched_by: null, did_you_mean: [] };
  let t = known.find((k) => k.symbol.toLowerCase() === q);
  if (t) return { token: t, matched_by: "symbol", did_you_mean: [] };
  t = known.find((k) => k.slugs.has(q));
  if (t) return { token: t, matched_by: "slug", did_you_mean: [] };
  const byName = known.filter((k) => k.names.has(q));
  if (byName.length === 1) return { token: byName[0], matched_by: "name", did_you_mean: [] };
  let near = byName;
  if (!near.length && q.length >= 3)
    near = known.filter((k) => k.symbol.toLowerCase().includes(q) || [...k.slugs].some((s) => s.includes(q)) || [...k.names].some((n) => n.includes(q)));
  return { token: null, matched_by: null, did_you_mean: near.slice(0, 6).map((k) => ({ symbol: k.symbol, name: k.name })) };
}

// 1.11.0: strict arguments. Unknown parameters and wrong enum values are errors (before, they were silently ignored and the
// caller believed its filter had worked). Out-of-range numbers are still clamped, and the result says so.
function validateArgs(tool, args) {
  if (args == null) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const allowed = Object.keys(props);
  for (const [k, v] of Object.entries(args)) {
    if (!Object.prototype.hasOwnProperty.call(props, k))
      throw new Error(`Unknown parameter '${k}' for ${tool.name}. Allowed parameters: ${allowed.length ? allowed.join(", ") : "none"}.`);
    if (v === undefined || v === null || v === "") continue;
    const sc = props[k];
    if (sc.enum && !sc.enum.includes(v)) throw new Error(`Parameter '${k}' must be one of: ${sc.enum.join(", ")}. Got: ${JSON.stringify(v).slice(0, 60)}.`);
    if (sc.type === "number" && (typeof v === "boolean" || typeof v === "object" || !isFinite(Number(v)))) throw new Error(`Parameter '${k}' must be a number. Got: ${JSON.stringify(v).slice(0, 60)}.`);
    if (sc.type === "string" && typeof v === "object") throw new Error(`Parameter '${k}' must be a string.`);
    if (sc.type === "array" && !Array.isArray(v) && typeof v !== "string") throw new Error(`Parameter '${k}' must be an array of strings.`);
  }
  return args;
}
// Says so when a number was outside the allowed range and had to be clamped.
function clampNote(name, v, lo, hi, used, why) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return isFinite(n) && (n < lo || n > hi) ? `${name}=${n} is outside ${lo}-${hi}; ${used} was used.${why ? " " + why : ""}` : null;
}

function trackLine(data) {
  const h = ((data.method || {}).history || {}).strong;
  if (!h) return null;
  return `In the past, ${h.down} of ${h.n} strong unlocks (${round(h.down_share * 100, 0)}%) fell against Bitcoin in the week before the date; average move ${h.avg_move}%. Medium and small unlocks behaved like a coin flip. Past results do not guarantee future ones.`;
}

function upcoming(data, now) {
  return (data.events || []).filter((e) => Date.parse(e.date) > now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

// 1.10.0: outputSchema — what structuredContent holds. Loose on purpose: extra fields allowed, nullable where data can be missing.
const N = { type: ["number", "null"] }, STR = { type: ["string", "null"] }, ARR = { type: "array" }, OBJ = { type: "object" };
const BASE_OUT = { source: { type: "string" }, data_updated_utc: STR, license: STR };
const UNLOCK = {
  type: "object",
  required: ["symbol", "date_utc", "strength", "page"],
  properties: {
    symbol: { type: "string" }, name: STR, date_utc: { type: "string" }, days_left: N, hours_left: N,
    strength: { type: "string", enum: ["strong", "medium", "small"] },
    share_of_circulating_pct: N, share_of_total_supply_pct: N, value_usd: N, kind: STR,
    recipients: ARR, perpetual_futures_on: { type: "array", items: { type: "string" } },
    market_cap_usd: N, price_change_7d_pct: N, volume_24h_usd: N, page: { type: "string" },
    share_of_circulating_range_pct: { type: "array", items: { type: "number" } }, liquidity_note: { type: "string" },
    warning: { type: "string" }, date_confirmed: { type: "boolean" }, date_note: { type: "string" },
    recipient_selling_habit: OBJ, primary_source_check: OBJ, recipients_detail: ARR, fdv_usd: N, already_unlocked_pct: N,
    data_source: STR, add_to_calendar: { type: "string" },
    range_note: { type: "string" }, numbers_from: { type: "string" }, aggregator_share_of_total_supply_pct: N, date_source_url: { type: "string" },
    disputed: { type: "boolean" }, dispute_reason: { type: "string", enum: ["amount_differs", "date_differs"] }, dispute_summary: { type: "string" },
    share_of_circulating_pct_by_documents: N, strength_by_documents: { type: "string", enum: ["strong", "medium", "small"] },
  },
};
const out = (props, required = []) => ({ type: "object", required: ["source", ...required], properties: { ...BASE_OUT, ...props } });
const OUT = {
  get_upcoming_unlocks: out({ window_days: { type: "number" }, matched: { type: "number" }, by_strength: OBJ, shown: { type: "number" },
    unlocks: { type: "array", items: UNLOCK }, calendar_page: { type: "string" }, track_record_strong: STR, note: { type: "string" },
    detail: { type: "string", enum: ["brief", "full"] }, disputed_in_result: { type: "number" }, limits_note: { type: "string" } },
    ["window_days", "matched", "shown", "unlocks"]),
  get_token_unlocks: out({ token: { type: "string" }, found: { type: "number" }, unlocks: { type: "array", items: UNLOCK },
    message: { type: "string" }, calendar_page: { type: "string" }, onchain_check: { type: "string" },
    coverage: { type: "string", enum: ["in_calendar", "known_no_unlock", "unknown_token"] }, symbol: STR, name: STR,
    matched_by: { type: ["string", "null"], enum: ["symbol", "slug", "name", null] }, did_you_mean: { type: "array", items: OBJ } }, ["found", "coverage"]),
  get_disputed_unlocks: out({ window_days: { type: "number" }, checked_against_documents: { type: "number" }, matched: { type: "number" }, shown: { type: "number" },
    by_reason: OBJ, disputed: { type: "array", items: { type: "object", required: ["symbol", "date_utc", "reason", "summary", "page"], properties: {
      symbol: { type: "string" }, name: STR, date_utc: { type: "string" }, days_left: N, reason: { type: "string", enum: ["amount_differs", "date_differs"] },
      summary: { type: "string" }, calendar: OBJ, project_documents: OBJ, page: { type: "string" } } } },
    token: { type: "string" }, coverage: { type: "string" }, did_you_mean: { type: "array", items: OBJ },
    disputed_page: { type: "string" }, note: { type: "string" }, limits_note: { type: "string" } }, ["window_days", "matched", "shown", "disputed"]),
  check_portfolio: out({ window_days: { type: "number" }, requested: { type: "number" }, summary: OBJ,
    with_unlocks: { type: "array", items: { type: "object", required: ["input", "symbol", "next_unlock"], properties: { input: { type: "string" }, symbol: { type: "string" }, name: STR,
      matched_by: { type: "string" }, unlocks_in_window: { type: "number" }, next_unlock: UNLOCK, other_dates_in_window: { type: "array", items: { type: "string" } } } } },
    without_unlocks: { type: "array", items: { type: "object", required: ["input", "symbol"], properties: { input: { type: "string" }, symbol: { type: "string" }, name: STR,
      matched_by: { type: "string" }, next_unlock_after_window_utc: { type: "string" }, note: { type: "string" } } } },
    unknown: { type: "array", items: { type: "object", required: ["input"], properties: { input: { type: "string" }, did_you_mean: { type: "array", items: OBJ } } } },
    portfolio_page: { type: "string" }, track_record_strong: STR, note: { type: "string" }, limits_note: { type: "string" } },
    ["window_days", "requested", "summary", "with_unlocks", "without_unlocks", "unknown"]),
  get_onchain_check: out({ method: STR, token: { type: "string" }, found: { type: "boolean" }, message: { type: "string" },
    window_days: { type: "number" }, movements: ARR, movements_found: { type: "number" }, note: { type: "string" },
    tokens_with_findings: { type: "array", items: { type: "string" } }, covered_tokens: { type: "array", items: { type: "string" } },
    symbol: { type: "string" }, name: STR, finding: {}, reading: { type: "string" }, upcoming_unlocks_in_calendar: ARR,
    tracked_wallets: ARR, events: ARR, attribution_note: { type: "string" }, next_unlock_per_project_documents: {}, tracked_wallets_share_pct: N,
    total_supply: N, supply_basis: STR, contracts: {}, limits_note: { type: "string" } }),
  get_method_and_track_record: out({ measure: { type: "string" }, thresholds: OBJ, track_record_window: { type: "string" }, track_record: OBJ,
    reading: { type: "string" }, method_page: { type: "string" }, live_journal_page: { type: "string" } }, ["thresholds", "track_record"]),
  get_dataset_info: out({ server_version: { type: "string" }, calendar: OBJ, track_record: OBJ, strength_formula: { type: "string" },
    thresholds: OBJ, sources: OBJ, on_chain_check: OBJ, limitations: { type: "array", items: { type: "string" } },
    cite_as: { type: "string" }, open_dataset: OBJ, method_page: { type: "string" } }, ["server_version", "sources"]),
};

export const TOOLS = [
  {
    name: "get_upcoming_unlocks",
    title: "Upcoming token unlocks",
    description:
      "Calendar of scheduled crypto token unlocks in the next N days (up to 60), each rated strong / medium / small by size relative to circulating supply. " +
      "Use for questions like 'which token unlocks are coming this week', 'biggest unlocks in November', 'strong unlocks with perpetual futures'. " +
      "Data refreshes hourly (data_updated_utc in the result). Results are cut to 'limit' (default 30): 'matched' says how many fit the filters. " +
      "detail=brief returns one compact row per unlock (use it for wide windows or large limits); detail=full (default) adds recipients, market data and source checks. " +
      "An unlock with disputed=true has a different amount or date in the project's own documents (dispute_summary gives both versions): report both, never only the calendar number; an unlock without the flag is not necessarily confirmed, most are simply unchecked. " +
      "The calendar holds 60 days: a larger days value is cut to 60 and limits_note says so. Unknown parameters and wrong enum values return an error. " +
      "Schedules are compiled from CoinMarketCap and DefiLlama. The futures filter covers KuCoin and Binance USDT perpetuals only. For one coin use get_token_unlocks; for several coins use check_portfolio; for the list of disputed unlocks use get_disputed_unlocks; for what the rating means and past results use get_method_and_track_record; " +
      "for coverage and sources use get_dataset_info. lang=ru returns Russian page links.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", minimum: 1, maximum: 60, default: 14, description: "Look-ahead window in days." },
        min_strength: { type: "string", enum: ["strong", "medium", "small"], default: "small", description: "Lowest strength to include." },
        futures: { type: "string", enum: ["any", "with_futures", "kucoin", "binance"], default: "any", description: "Filter by perpetual futures availability." },
        sort: { type: "string", enum: ["date", "size"], default: "date", description: "date = soonest first; size = largest share of circulating supply first." },
        limit: { type: "number", minimum: 1, maximum: 100, default: 30 },
        detail: { type: "string", enum: ["brief", "full"], default: "full", description: "brief = compact rows (symbol, date, strength, share, value, futures, dispute flag, page); full = all fields." },
        lang: { type: "string", enum: ["en", "ru"], default: "en", description: "Language of the page links." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "Upcoming token unlocks" },
    outputSchema: OUT.get_upcoming_unlocks,
  },
  {
    name: "get_token_unlocks",
    title: "Unlocks for one token",
    description:
      "All scheduled unlocks in the next 60 days for one token, with recipients (team, investors, treasury ...), USD value, share of circulating supply, " +
      "futures availability and a link to the token page. Accepts a ticker (ARB), a name (Arbitrum) or a slug (arbitrum). " +
      "Matching is exact: matched_by says whether the ticker, the slug or the name matched. A partial match never selects a token; close names come back in did_you_mean. " +
      "coverage tells three cases apart: in_calendar (unlocks listed); known_no_unlock (we track this token and it has no unlock in the next 60 days, found=0, not an error); " +
      "unknown_token (the token is not in our data: this is NOT evidence that it has no unlocks, say that we do not cover it). " +
      "disputed=true on an unlock means the project's own documents give a different amount or date; dispute_summary has both versions and both must be reported. If the result mentions onchain_check, " +
      "call get_onchain_check to see what the locked wallets are doing. recipient_selling_habit (when present) says how often recipients of this coin's past unlocks sold " +
      "within 7 days; it is reference only and did not predict price. lang=ru returns Russian page links.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", minLength: 1, maxLength: 60, description: "Ticker, name or slug." },
        lang: { type: "string", enum: ["en", "ru"], default: "en" },
      },
      required: ["token"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "Unlocks for one token" },
    outputSchema: OUT.get_token_unlocks,
  },
  {
    name: "get_onchain_check",
    title: "Locked-token wallets on-chain",
    description:
      "What is actually happening on-chain with a token's locked allocations: the vesting contracts and wallets holding team, investor and treasury tokens, " +
      "how much they hold now, outflows (tokens leaving locked wallets), mints, burns and contract upgrades, the next unlock by the project's own documents, " +
      "and our short finding (for example: unlocked but never withdrawn, tranches sent to an exchange, vesting contract has not paid out). " +
      "Use for 'are team tokens moving', 'did the unlock really happen', 'who is selling'. Without a token: recent movements across all covered tokens. " +
      "token accepts a ticker (preferred), a name or a slug, matched exactly; covered_tokens in the result lists what we track (about a hundred tokens, not the whole calendar). " +
      "Movements look back at most 30 days; wallet roles marked 'our attribution' are our analysis, not the project's statement. For the unlock calendar use get_token_unlocks.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", maxLength: 60, description: "Ticker, name or slug. Leave empty for recent movements across all covered tokens." },
        days: { type: "number", minimum: 1, maximum: 30, default: 30, description: "Look-back window for the list of recent movements (no token)." },
        lang: { type: "string", enum: ["en", "ru"], default: "en", description: "Language of the page links." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "Locked-token wallets on-chain" },
    outputSchema: OUT.get_onchain_check,
  },
  {
    name: "get_disputed_unlocks",
    title: "Unlocks where sources disagree",
    description:
      "Upcoming unlocks where the calendar source and the project's own documents disagree: a different amount on the same date (amount_differs) or a different date (date_differs). " +
      "Each row puts the two versions side by side (calendar vs documents: date, share of total supply, share of circulating supply, strength by each version) with links to the documents. " +
      "Use for 'which unlocks are disputed', 'is this unlock size real', 'why do sites show different numbers for X', and before quoting a very large percentage from the calendar. " +
      "Only unlocks we have checked against documents can appear (checked_against_documents says how many were checked); an unlock missing here is unchecked or matching, not confirmed. " +
      "The document figures are our own reading of primary sources and can be wrong. token narrows the list to one coin (exact ticker, slug or name). " +
      "For all upcoming unlocks use get_upcoming_unlocks; for on-chain movements of locked wallets use get_onchain_check.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", minimum: 1, maximum: 60, default: 60, description: "Look-ahead window in days." },
        reason: { type: "string", enum: ["any", "amount_differs", "date_differs"], default: "any", description: "Kind of disagreement." },
        token: { type: "string", maxLength: 60, description: "Optional: one token (ticker, slug or name, exact)." },
        limit: { type: "number", minimum: 1, maximum: 100, default: 30 },
        lang: { type: "string", enum: ["en", "ru"], default: "en", description: "Language of the page links." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "Unlocks where sources disagree" },
    outputSchema: OUT.get_disputed_unlocks,
  },
  {
    name: "check_portfolio",
    title: "Check a list of coins for upcoming unlocks",
    description:
      "Checks up to 50 tokens in one call and sorts them into three groups: with_unlocks (an unlock is scheduled within the window, nearest first), " +
      "without_unlocks (we track the token and nothing is scheduled within the window) and unknown (the token is not in our data: this is NOT evidence that it has no unlocks). " +
      "Use when the user gives a portfolio, a watchlist or several tickers ('I hold ARB, OP and SUI, any unlocks coming?'). " +
      "Matching is exact on ticker, slug or name; an input that only partly matches goes to unknown with did_you_mean instead of a guess. " +
      "Send tickers only: amounts and wallet addresses are not needed and not accepted. portfolio_page opens the same list on the website. " +
      "For full details of one coin call get_token_unlocks; disputed=true on an unlock means the project's documents differ, report both versions.",
    inputSchema: {
      type: "object",
      properties: {
        tokens: { type: "array", items: { type: "string", minLength: 1, maxLength: 60 }, minItems: 1, maxItems: 50, description: 'Tickers (preferred), names or slugs, for example ["ARB","OP","sui"].' },
        days: { type: "number", minimum: 1, maximum: 60, default: 30, description: "Look-ahead window in days." },
        min_strength: { type: "string", enum: ["strong", "medium", "small"], default: "small", description: "Lowest strength that counts as an unlock to report." },
        lang: { type: "string", enum: ["en", "ru"], default: "en", description: "Language of the page links." },
      },
      required: ["tokens"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "Check a list of coins" },
    outputSchema: OUT.check_portfolio,
  },
  {
    name: "get_method_and_track_record",
    title: "How unlocks are rated, and what happened before past ones",
    description:
      "Explains the strong / medium / small rating and gives the historical record: for past unlocks of each strength, " +
      "how often the token fell against Bitcoin in the week before the unlock and the average move. Use when the user asks what 'strong' means, " +
      "whether unlocks move prices, or how reliable the rating is. Not a forecast for any single token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "Method and track record" },
    outputSchema: OUT.get_method_and_track_record,
  },
  {
    name: "get_dataset_info",
    title: "What the data covers",
    description:
      "Describes the Unlock Pulse dataset itself: server version, when it was last refreshed, how many upcoming unlocks it holds and how far ahead, " +
      "how many past unlocks the track record is built on, which blockchains the on-chain check covers, sources, the strength formula and thresholds, " +
      "known limitations and how to cite. Use when the user asks where the numbers come from, how fresh or complete they are, or how to cite them.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true, title: "What the data covers" },
    outputSchema: OUT.get_dataset_info,
  },
];

function argNum(v, d, lo, hi) {
  if (v === undefined || v === null || v === "") return d;
  const n = Number(v);
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

async function callTool(name, args, fetchImpl) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error("Unknown tool: " + name);
  args = validateArgs(tool, args);
  const data = await loadData(fetchImpl);
  const now = Date.now();
  const lang = args.lang === "ru" ? "ru" : "en";
  const home = lang === "ru" ? SITE + "/ru/" : SITE + "/";
  const base = { source: "Unlock Pulse, " + home, data_updated_utc: data.generated };
  base.license = "Our ratings, track record, on-chain measurements and texts: CC BY 4.0, keep the link to Unlock Pulse. Unlock schedules: compiled from CoinMarketCap and DefiLlama, subject to their terms.";

  if (name === "get_upcoming_unlocks") {
    const days = argNum(args.days, 14, 1, 60);
    const limit = Math.round(argNum(args.limit, 30, 1, 100));
    const minS = ORDER[args.min_strength] || 1;
    const fut = args.futures || "any";
    let ev = upcoming(data, now).filter((e) => Date.parse(e.date) - now <= days * 86400000 && (ORDER[e.strength] || 0) >= minS);
    if (fut === "with_futures") ev = ev.filter((e) => e.kucoin || e.binance);
    else if (fut === "kucoin") ev = ev.filter((e) => e.kucoin);
    else if (fut === "binance") ev = ev.filter((e) => e.binance);
    if (args.sort === "size") ev = ev.slice().sort((a, b) => (b.B || 0) - (a.B || 0));
    const counts = { strong: 0, medium: 0, small: 0 };
    ev.forEach((e) => counts[e.strength]++);
    const isBrief = args.detail === "brief";
    const shown = ev.slice(0, limit);
    const res = {
      ...base,
      window_days: days,
      matched: ev.length,
      by_strength: counts,
      shown: shown.length,
      detail: isBrief ? "brief" : "full",
      unlocks: shown.map((e) => (isBrief ? brief(e, now, lang, data) : shape(e, now, lang, false, data))),
      disputed_in_result: shown.filter((e) => disputeOf(e, data)).length,
      calendar_page: home,
      track_record_strong: trackLine(data),
      note: "strength: " + Object.values(LABEL).join("; ") + ". disputed=true: the project's documents give a different amount or date, see dispute_summary. Not investment advice.",
    };
    const ln = [clampNote("days", args.days, 1, 60, days, "The calendar holds only the next 60 days."), clampNote("limit", args.limit, 1, 100, limit)].filter(Boolean);
    if (ln.length) res.limits_note = ln.join(" ");
    return res;
  }

  if (name === "get_token_unlocks") {
    const q = normQ(args.token);
    if (!q) throw new Error("Parameter 'token' is required.");
    let oc = null;
    try { oc = await loadOnchain(fetchImpl); } catch (e) { /* on-chain data is optional here */ }
    const r = resolveToken(q, knownTokens(data, oc));
    if (!r.token) {
      const o = { ...base, token: String(args.token), found: 0, coverage: "unknown_token", matched_by: null,
        message: "This token is not in the Unlock Pulse data (no exact match by ticker, slug or name). That is not evidence that it has no unlocks: we simply do not cover it" +
          (r.did_you_mean.length ? ", or it is listed under another name (see did_you_mean)." : "."),
        calendar_page: home };
      if (r.did_you_mean.length) o.did_you_mean = r.did_you_mean;
      return o;
    }
    const sym = r.token.symbol;
    const ev = upcoming(data, now).filter((e) => e.sym === sym);
    const tracked = !!(oc && (oc.tokens || {})[sym]);
    const hint = "We track this token's locked-allocation wallets on-chain: call get_onchain_check with token=" + sym + ".";
    if (!ev.length) {
      const o = { ...base, token: String(args.token), found: 0, coverage: "known_no_unlock", symbol: sym, name: r.token.name, matched_by: r.matched_by,
        message: "No scheduled unlocks for this token in the next 60 days in the Unlock Pulse calendar. We know this token" + (tracked ? " (its locked wallets are tracked on-chain)" : "") + "; later unlocks may exist beyond the 60-day window.",
        calendar_page: home };
      if (tracked) o.onchain_check = hint;
      return o;
    }
    const out = { ...base, token: String(args.token), found: ev.length, coverage: "in_calendar", symbol: sym, name: r.token.name, matched_by: r.matched_by,
      unlocks: ev.slice(0, 20).map((e) => shape(e, now, lang, true, data)) };
    if (tracked) out.onchain_check = hint;
    return out;
  }

  if (name === "get_disputed_unlocks") {
    const days = argNum(args.days, 60, 1, 60);
    const limit = Math.round(argNum(args.limit, 30, 1, 100));
    const reason = args.reason || "any";
    const disputedPage = SITE + "/" + (lang === "ru" ? "ru/" : "") + "disputed.html";
    let ev = upcoming(data, now).filter((e) => Date.parse(e.date) - now <= days * 86400000);
    const res = { ...base, window_days: days };
    const q = normQ(args.token);
    if (q) {
      let oc = null;
      try { oc = await loadOnchain(fetchImpl); } catch (e) { /* optional */ }
      const r = resolveToken(q, knownTokens(data, oc));
      res.token = String(args.token);
      if (!r.token) {
        return { ...res, coverage: "unknown_token", checked_against_documents: 0, matched: 0, shown: 0, disputed: [], ...(r.did_you_mean.length ? { did_you_mean: r.did_you_mean } : {}),
          disputed_page: disputedPage, note: "This token is not in the Unlock Pulse data (no exact match by ticker, slug or name), so nothing can be said about it." };
      }
      res.coverage = ev.some((e) => e.sym === r.token.symbol) ? "in_calendar" : "known_no_unlock";
      ev = ev.filter((e) => e.sym === r.token.symbol);
    }
    const checked = ev.filter((e) => e.verify && e.verify.docs && e.verify.docs.match);
    let rows = checked.map((e) => ({ e, x: disputeOf(e, data) })).filter((p) => p.x);
    const byReason = { amount_differs: 0, date_differs: 0 };
    rows.forEach((p) => byReason[p.x.reason]++);
    if (reason !== "any") rows = rows.filter((p) => p.x.reason === reason);
    const list = rows.slice(0, limit).map(({ e, x }) => {
      const d = e.verify.docs;
      const docs = { date: x.document_date, share_of_total_supply_pct: x.document_share_of_total_supply_pct };
      if (x.document_share_of_circulating_pct != null) { docs.share_of_circulating_pct = x.document_share_of_circulating_pct; docs.strength = x.strength_by_documents; }
      if (d.confidence) docs.schedule_confidence = d.confidence;
      if (d.note) docs.note = d.note;
      docs.sources = d.sources || [];
      return { symbol: e.sym, name: e.name, date_utc: e.date, days_left: round((Date.parse(e.date) - now) / 86400000, 1), reason: x.reason, summary: x.summary,
        calendar: { date_utc: e.date, share_of_total_supply_pct: round(e.pct_total, 3), share_of_circulating_pct: round(e.B * 100, 2), strength: e.strength,
          value_usd: e.usd == null ? null : Math.round(e.usd), source: e.source === "cmc" ? "CoinMarketCap unlock calendar" : e.source === "project" ? "project documents" : e.source === "manual" ? "checked by hand" : "DefiLlama emissions" },
        project_documents: docs, page: pageOf(e, lang) };
    });
    Object.assign(res, { checked_against_documents: checked.length, matched: rows.length, by_reason: byReason, shown: list.length, disputed: list, disputed_page: disputedPage,
      note: "Rows are unlocks where our reading of the project's documents gives another amount or date than the calendar source. share_of_circulating_pct under project_documents is an estimate: the documents' amount over the same circulating supply. " +
        "An unlock that is not listed is either unchecked or matches the documents; it is not thereby confirmed. Not investment advice." });
    const ln = [clampNote("days", args.days, 1, 60, days, "The calendar holds only the next 60 days."), clampNote("limit", args.limit, 1, 100, limit)].filter(Boolean);
    if (ln.length) res.limits_note = ln.join(" ");
    return res;
  }

  if (name === "check_portfolio") {
    let raw = args.tokens;
    if (typeof raw === "string") raw = raw.split(/[,;\s]+/); // tolerate "ARB, OP, SUI"
    if (!Array.isArray(raw)) throw new Error("Parameter 'tokens' is required: an array of tickers, for example [\"ARB\",\"OP\"].");
    const seen = new Set(), inputs = [];
    for (const v of raw) {
      if (v !== null && typeof v === "object") throw new Error("Parameter 'tokens' must contain strings only (tickers, names or slugs).");
      const s = String(v ?? "").trim().slice(0, 60), k = normQ(s);
      if (!k || seen.has(k)) continue;
      seen.add(k); inputs.push(s);
    }
    if (!inputs.length) throw new Error("Parameter 'tokens' is required: an array of tickers, for example [\"ARB\",\"OP\"].");
    if (inputs.length > 50) throw new Error("Too many tokens: " + inputs.length + ". At most 50 per call; split the list.");
    const days = argNum(args.days, 30, 1, 60);
    const minS = ORDER[args.min_strength] || 1;
    let oc = null;
    try { oc = await loadOnchain(fetchImpl); } catch (e) { /* optional */ }
    const known = knownTokens(data, oc);
    const all = upcoming(data, now);
    const withU = [], without = [], unknown = [], symsSeen = new Set();
    for (const input of inputs) {
      const r = resolveToken(normQ(input), known);
      if (!r.token) { const u = { input }; if (r.did_you_mean.length) u.did_you_mean = r.did_you_mean; unknown.push(u); continue; }
      const sym = r.token.symbol;
      if (symsSeen.has(sym)) continue; // the same coin given twice (ticker and name)
      symsSeen.add(sym);
      const mine = all.filter((e) => e.sym === sym && (ORDER[e.strength] || 0) >= minS);
      const inWin = mine.filter((e) => Date.parse(e.date) - now <= days * 86400000);
      if (inWin.length) {
        const row = { input, symbol: sym, name: r.token.name, matched_by: r.matched_by, unlocks_in_window: inWin.length, next_unlock: brief(inWin[0], now, lang, data) };
        if (inWin.length > 1) row.other_dates_in_window = inWin.slice(1, 6).map((e) => e.date);
        withU.push(row);
      } else {
        const row = { input, symbol: sym, name: r.token.name, matched_by: r.matched_by };
        if (mine.length) { row.next_unlock_after_window_utc = mine[0].date; row.note = "Nothing within " + days + " days; the next unlock in our 60-day calendar is later."; }
        without.push(row);
      }
    }
    withU.sort((a, b) => Date.parse(a.next_unlock.date_utc) - Date.parse(b.next_unlock.date_utc));
    const coins = [...withU, ...without].map((x) => x.symbol).concat(unknown.map((u) => clean(u.input))).filter(Boolean);
    const res = { ...base, window_days: days, requested: inputs.length,
      summary: { with_unlocks: withU.length, without_unlocks: without.length, unknown: unknown.length },
      with_unlocks: withU, without_unlocks: without, unknown,
      portfolio_page: SITE + "/" + (lang === "ru" ? "ru/" : "") + "tools/my-coins.html?coins=" + encodeURIComponent(coins.join(",")).replace(/%2C/g, ","),
      track_record_strong: withU.some((x) => x.next_unlock.strength === "strong") ? trackLine(data) : null,
      note: "without_unlocks: we track the token and nothing is scheduled within the window" + (minS > 1 ? " at the chosen strength" : "") + " (the calendar itself reaches 60 days). " +
        "unknown: not in our data, which is not evidence that the token has no unlocks. Not investment advice." };
    const ln = clampNote("days", args.days, 1, 60, days, "The calendar holds only the next 60 days.");
    if (ln) res.limits_note = ln;
    return res;
  }

  if (name === "get_onchain_check") {
    const oc = await loadOnchain(fetchImpl);
    const ob = { ...base, data_updated_utc: oc.generated, license: oc.license, method: oc.method };
    const q = String(args.token || "").trim().replace(/^\$/, "").toLowerCase();
    const covered = Object.keys(oc.tokens || {}).sort();
    if (!q) {
      const days = argNum(args.days, 30, 1, 30);
      const cut = new Date(now - days * 86400000).toISOString().slice(0, 10);
      const ev = (oc.recent_events_30d || []).filter((e) => e.date >= cut).slice(0, 50);
      const lnO = clampNote("days", args.days, 1, 30, days, "Movements are kept for 30 days.");
      return { ...ob, window_days: days, ...(lnO ? { limits_note: lnO } : {}), movements: ev, movements_found: ev.length,
        note: ev.length ? "Moves of 0.1% of supply or more out of / into tracked locked-allocation wallets, plus mints, burns and contract upgrades." :
          "No moves of 0.1% of supply or more in tracked wallets in this window.",
        tokens_with_findings: covered.filter((k) => oc.tokens[k].finding), covered_tokens: covered };
    }
    const t = findOnchain(oc, q, data);
    if (!t) return { ...ob, token: args.token, found: false, message: "We do not track this token's wallets on-chain yet.", covered_tokens: covered };
    const w = (t.tracked_wallets || []).slice().sort((a, b) => (b.share_of_supply_pct || 0) - (a.share_of_supply_pct || 0));
    const ev30 = (t.events || []).filter((e) => e.kind === "outflow" && Date.parse(e.date) > now - 30 * 86400000);
    const since = w.map((x) => x.tracked_since).filter(Boolean).sort()[0];
    const reading = [];
    if (w.length) reading.push(`${w.length} tracked wallet(s) hold ${t.tracked_wallets_share_pct}% of supply (${t.supply_basis}).`);
    reading.push(ev30.length ? `Outflows in the last 30 days: ${ev30.map((e) => e.date + " " + e.share_of_supply_pct + "% from " + e.wallet).join("; ")}.`
      : since ? `No outflow of 0.1% of supply or more seen since tracking started on ${since}.` : "No wallet history yet.");
    const cal = upcoming(data, now).filter((e) => e.sym === t.symbol).slice(0, 5)
      .map((e) => { const x = disputeOf(e, data); return { date_utc: e.date, strength: e.strength, share_of_circulating_pct: round(e.B * 100, 2), ...(x ? { disputed: true, dispute_summary: x.summary } : {}), page: pageOf(e, lang) }; });
    return { ...ob, token: args.token, found: true, symbol: t.symbol, name: t.name, finding: t.finding || null, reading: reading.join(" "),
      next_unlock_per_project_documents: t.next_unlock_per_project_documents, upcoming_unlocks_in_calendar: cal,
      tracked_wallets_share_pct: t.tracked_wallets_share_pct, total_supply: t.total_supply, supply_basis: t.supply_basis,
      tracked_wallets: w.slice(0, 12), events: (t.events || []).slice(0, 15), contracts: t.contracts,
      attribution_note: "Wallet roles marked 'our attribution' come from our analysis of holders and transfers, not from the project, and may be wrong." };
  }

  if (name === "get_method_and_track_record") {
    const m = data.method || {};
    const h = m.history || {};
    const rec = {};
    for (const k of ["strong", "medium", "small"])
      if (h[k]) rec[k] = { unlocks: h[k].n, fell_vs_btc_in_week_before: h[k].down, fell_share_pct: round(h[k].down_share * 100, 0), average_move_vs_btc_pct: h[k].avg_move };
    return {
      ...base,
      measure: "B = tokens unlocked / circulating supply at the time of the unlock",
      thresholds: { strong: "B >= " + round((m.strong || 0.104) * 100, 1) + "%", medium: "B >= " + round((m.medium || 0.05) * 100, 1) + "%", small: "below medium" },
      track_record_window: "from 7 days before the unlock to the unlock date, price change relative to Bitcoin",
      track_record: rec,
      reading:
        "Only strong unlocks show a consistent pattern: most of them fell against Bitcoin in the week before the date. " +
        "Medium and small unlocks behaved like a coin flip. Past results do not guarantee future ones.",
      method_page: SITE + "/method.html",
      live_journal_page: SITE + "/journal.html",
    };
  }
  if (name === "get_dataset_info") {
    const m = data.method || {};
    const h = m.history || {};
    const ev = upcoming(data, now);
    const counts = { strong: 0, medium: 0, small: 0 };
    ev.forEach((e) => { if (counts[e.strength] !== undefined) counts[e.strength]++; });
    const last = ev.length ? ev.map((e) => e.date).sort().pop() : null;
    let onchain;
    try {
      const oc = await loadOnchain(fetchImpl);
      onchain = { data_updated_utc: oc.generated, tracked_tokens: Object.keys(oc.tokens || {}).length,
        chains: "Ethereum, BNB Chain, Base, Arbitrum, Avalanche and Solana, for tokens issued there (BNB Chain transfer history reaches back only about 2.5 days)",
        refresh: "wallet balances daily; transfers out of tracked wallets every 3 hours" };
    } catch (e) { onchain = { error: "on-chain data unavailable right now" }; }
    return {
      ...base,
      server_version: VERSION,
      calendar: { upcoming_unlocks: ev.length, by_strength: counts, window_days: 60, last_date_in_window_utc: last, refresh: "hourly" },
      track_record: { past_unlocks: ["strong", "medium", "small"].reduce((a, k) => a + ((h[k] && h[k].n) || 0), 0), period: "2023 to today",
        window: "price change relative to Bitcoin from 7 days before the unlock to the unlock date" },
      strength_formula: "B = tokens unlocked / circulating supply at the time of the unlock",
      thresholds: { strong: "B >= " + round((m.strong || 0.104) * 100, 1) + "%", medium: "B >= " + round((m.medium || 0.05) * 100, 1) + "%", small: "below medium" },
      sources: { schedules: "CoinMarketCap unlock calendar and DefiLlama emissions; for some tokens the project's own documents",
        prices_and_supply: "CoinMarketCap", futures_lists: "KuCoin and Binance USDT perpetuals", on_chain: "public blockchain data (explorers and public nodes)" },
      on_chain_check: onchain,
      limitations: [
        "Sources sometimes disagree on circulating supply; such tokens carry share_of_circulating_range_pct.",
        "For tokens checked against the project's own documents the amount or date can differ from the calendar source; such unlocks carry disputed=true and are listed by get_disputed_unlocks. Most tokens are not checked.",
        "The calendar holds only the next 60 days and only the tokens our sources list; a token we do not know is reported as coverage=unknown_token, not as 'no unlocks'.",
        "Unlock dates and sizes come from schedules and can change or slip; check the token page before relying on them.",
        "The track record describes averages over many past unlocks, not a forecast for one token.",
      ],
      cite_as: "Unlock Pulse (" + SITE + "/), CC BY 4.0",
      open_dataset: { title: "Unlock Pulse open dataset v1", version: "1.0.0", doi: "10.5281/zenodo.23949644",
        url: "https://doi.org/10.5281/zenodo.23949644", all_versions_doi: "10.5281/zenodo.23949643", license: "CC BY 4.0",
        contents: "CSV files: unlock ratings, 7-day event study vs Bitcoin around 304 past unlocks, date checks, schedule changes, recipient habits, on-chain checks" },
      method_page: SITE + "/method.html",
    };
  }
  throw new Error("Unknown tool: " + name);
}

// ---- JSON-RPC / MCP ----
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function handleMessage(msg, fetchImpl = globalThis.fetch) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcErr(msg && msg.id, -32600, "Invalid Request");
  if (msg.id === undefined || msg.id === null) return null; // notification: nothing to answer
  const id = msg.id;
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "unlockpulse", title: "Unlock Pulse: token unlock calendar", version: VERSION, websiteUrl: SITE + "/" },
          instructions: INSTRUCTIONS,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      if (!TOOLS.find((t) => t.name === p.name)) return rpcErr(id, -32602, "Unknown tool: " + p.name);
      try {
        const out = await callTool(p.name, p.arguments || {}, fetchImpl);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false } };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e && e.message ? e.message : e) }], isError: true } };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      return rpcErr(id, -32601, "Method not found: " + msg.method);
  }
}

// ---- anonymous usage counter (1.2.0): what is asked, never who ----
// Per UTC day in KV (binding STATS): calls per tool, token asked, client app name, country (Cloudflare request.cf), filters.
// No IP, no headers, no free text beyond a sanitised ticker. Public aggregate: GET /stats.
const clean = (v, n = 20) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, n);
export function usageEvents(msgs) {
  const ev = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const p = m.params || {};
    if (m.method === "initialize") ev.push({ k: "init", client: String((p.clientInfo && p.clientInfo.name) || "unknown").replace(/[^\w .@/-]/g, "").slice(0, 40) });
    if (m.method === "tools/call" && TOOLS.find((t) => t.name === p.name)) {
      const a = p.arguments || {};
      ev.push({ k: "call", tool: p.name, token: a.token && typeof a.token === "string" ? clean(a.token) : null, lang: a.lang === "ru" ? "ru" : "en",
        filt: p.name === "get_upcoming_unlocks" ? [a.days ?? "-", a.min_strength ?? "-", a.futures ?? "-", a.sort ?? "-"].join("|") : null });
    }
  }
  return ev;
}
const bump = (o, k, n = 1, cap = 300) => { if (k == null || k === "") return; if (o[k] === undefined && Object.keys(o).length >= cap) k = "_other"; o[k] = (o[k] || 0) + n; };
// 1.8.1: free KV tier allows 1000 writes a day; catalog robots connect hundreds of times. Events are buffered per Worker
// instance and written at most once every 2 minutes (or at 50 events). An evicted instance may lose its last few events.
// 1.9.4 (02.11): Cloudflare warned at 50 % of the daily write cap (~500 writes/day from robot connects) → connects are
// flushed every 15 minutes or at 200 events; tool calls are still written at once. Losing a few robot connects is fine.
const FLUSH_MS = 900000, FLUSH_N = 200;
// 1.10.2 (05.11): still ~500 writes/day (robots hit many short-lived instances, each flushing its own buffer) → Cloudflare
// warned at 50 % again. Robot connects are now sampled: 1 in INIT_SAMPLE is kept with weight INIT_SAMPLE, so daily
// connect counts stay right on average and writes drop ~10×. Tool calls are never sampled.
export const INIT_SAMPLE = 10;
// 1.8.2: a fresh instance starts its 2-minute window at load (before, its first event was written at once, and robots
// waking cold instances all over the world spent one KV write each). Tool calls are still written at once.
// 1.10.3 (14.11): the owner's own sessions inflated the counts. Requests to /mcp?src=internal (owner's connector, our tests)
// are counted in a separate daily key "i:<day>" and never in the public "d:<day>" numbers. Connects there are not sampled.
let buf = [], lastFlush = Date.now();
async function record(env, ev, country, internal = false) {
  if (!env || !env.STATS || !ev.length) return;
  if (!internal) ev = ev.filter((e) => e.k !== "init" || Math.random() < 1 / INIT_SAMPLE);
  if (!ev.length) return;
  for (const e of ev) buf.push({ ...e, w: e.k === "init" && !internal ? INIT_SAMPLE : 1, country, internal, day: new Date().toISOString().slice(0, 10) });
  if (!ev.some((e) => e.k === "call") && Date.now() - lastFlush < FLUSH_MS && buf.length < FLUSH_N) return;
  const batch = buf; buf = []; lastFlush = Date.now();
  const byDay = {};
  for (const e of batch) { const dk = (e.internal ? "i:" : "d:") + e.day; (byDay[dk] = byDay[dk] || []).push(e); }
  for (const [key, list] of Object.entries(byDay)) {
    const d = (await env.STATS.get(key, "json")) || { init: 0, calls: 0, tools: {}, tokens: {}, clients: {}, countries: {}, langs: {}, filters: {} };
    for (const e of list) {
      if (e.k === "init") { d.init += e.w; bump(d.clients, e.client, e.w); bump(d.countries, e.country, e.w); }
      else { d.calls++; bump(d.tools, e.tool); bump(d.tokens, e.token); bump(d.langs, e.lang); bump(d.filters, e.filt); }
    }
    await env.STATS.put(key, JSON.stringify(d), { expirationTtl: 400 * 86400 });
  }
}
async function stats(env) {
  if (!env || !env.STATS) return { error: "no storage bound" };
  const days = {}, internal_days = {};
  for (let i = 0; i < 30; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const v = await env.STATS.get("d:" + day, "json");
    if (v) days[day] = v;
    const w = await env.STATS.get("i:" + day, "json");
    if (w) internal_days[day] = w;
  }
  return { about: "Unlock Pulse MCP: anonymous daily usage (UTC), last 30 days. No IPs stored. Since 2026-11-05 connects (init, clients, countries) are sampled 1 in " + INIT_SAMPLE + " and scaled, so they are estimates; tool calls are exact. Since 2026-11-14 our own test traffic is counted separately in internal_days and is not part of days.", days, internal_days };
}

// ---- remote mode: Cloudflare Worker ----
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};
const jsonResp = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

export async function handleHttp(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
    if (request.method === "GET") return new Response("This MCP endpoint does not open an SSE stream; send JSON-RPC with POST.", { status: 405, headers: { Allow: "POST", ...CORS } });
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });
    const text = await request.text();
    if (text.length > 100000) return jsonResp(rpcErr(null, -32600, "Request too large"), 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonResp(rpcErr(null, -32700, "Parse error"), 400);
    }
    try {
      const ev = usageEvents(Array.isArray(body) ? body.slice(0, 20) : [body]);
      if (ev.length) {
        for (const e of ev) console.log(JSON.stringify({ usage: e }));
        const internal = url.searchParams.get("src") === "internal";
        const job = record(env, ev, clean(request.cf && request.cf.country, 2) || "??", internal).catch((e) => console.log("stats error", String(e)));
        if (ctx && ctx.waitUntil) ctx.waitUntil(job);
      }
    } catch (e) {
      console.log("usage parse error", String(e));
    }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.slice(0, 20).map((m) => handleMessage(m)))).filter(Boolean);
      return out.length ? jsonResp(out) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handleMessage(body);
    return out ? jsonResp(out) : new Response(null, { status: 202, headers: CORS });
  }
  if (url.pathname === "/stats" && request.method === "GET") return jsonResp(await stats(env));
  if (url.pathname === "/" || url.pathname === "")
    return jsonResp({
      name: "Unlock Pulse MCP server",
      about: "Token unlock calendar for AI assistants. Free, read-only, no key.",
      mcp_endpoint: url.origin + "/mcp",
      transport: "Streamable HTTP",
      tools: TOOLS.map((t) => t.name),
      website: SITE + "/",
      data: DATA_URL + " (our ratings and texts CC BY 4.0; schedules via CoinMarketCap and DefiLlama, subject to their terms)",
    });
  return new Response("Not found", { status: 404, headers: CORS });
}

export default { fetch: handleHttp };

// ---- local mode: stdio (node unlockpulse-mcp.mjs) ----
const isNodeMain =
  typeof process !== "undefined" && process.release && process.release.name === "node" && /unlockpulse-mcp(\.mjs)?$/.test((process.argv && process.argv[1]) || "");
if (isNodeMain) {
  let buf = "";
  let chain = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      chain = chain.then(async () => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          process.stdout.write(JSON.stringify(rpcErr(null, -32700, "Parse error")) + "\n");
          return;
        }
        const msgs = Array.isArray(msg) ? msg : [msg];
        for (const m of msgs) {
          const out = await handleMessage(m);
          if (out) process.stdout.write(JSON.stringify(out) + "\n");
        }
      });
    }
  });
  process.stdin.on("end", () => chain.then(() => { process.exitCode = 0; }));
  process.stderr.write("unlockpulse-mcp " + VERSION + " ready (stdio)\n");
}
