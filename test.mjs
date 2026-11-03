import fs from "node:fs";
// Tests for unlockpulse-mcp.mjs: protocol, tools on live data, HTTP (Worker) mode, stdio mode, a fake-data edge case.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleMessage, handleHttp, TOOLS } from "./unlockpulse-mcp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const ok = (name) => { pass++; console.log("ok -", name); };
const call = (name, args = {}, id = 9) => handleMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const VERSION_EXPECTED = JSON.parse((await import("node:fs")).readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// protocol
let r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
assert.equal(r.result.protocolVersion, "2025-03-26"); assert.ok(r.result.capabilities.tools); assert.ok(r.result.instructions.includes("Unlock Pulse"));
ok("initialize echoes a supported protocol version");
r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
assert.equal(r.result.protocolVersion, "2025-06-18"); ok("initialize falls back to latest for unknown version");
assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null); ok("notification gets no answer");
r = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
assert.deepEqual(r.result.tools.map((t) => t.name), ["get_upcoming_unlocks", "get_token_unlocks", "get_onchain_check", "get_method_and_track_record", "get_dataset_info"]); ok("tools/list");
r = await handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" }); assert.equal(r.error.code, -32601); ok("unknown method -> -32601");
r = await call("nope"); assert.equal(r.error.code, -32602); ok("unknown tool -> -32602");
r = await handleMessage({ id: 4, method: "x" }); assert.equal(r.error.code, -32600); ok("missing jsonrpc -> -32600");
r = await handleMessage({ jsonrpc: "2.0", id: 5, method: "ping" }); assert.deepEqual(r.result, {}); ok("ping");

// tools on live data
r = await call("get_upcoming_unlocks", { days: 14 });
let s = r.result.structuredContent;
assert.equal(r.result.isError, false); assert.ok(s.matched > 0, "some unlocks in 14 days");
assert.ok(s.unlocks.every((u, i, a) => u.hours_left >= 0 && u.days_left <= 14.01 && (i === 0 || a[i - 1].days_left <= u.days_left)));
assert.ok(s.unlocks.every((u) => u.page.startsWith("https://billibo6.github.io/unlockpulse/unlock/")));
assert.equal(JSON.parse(r.result.content[0].text).matched, s.matched);
ok(`upcoming 14d: ${s.matched} (strong ${s.by_strength.strong}), sorted, future only, links`);
r = await call("get_upcoming_unlocks", { days: 60, min_strength: "strong", futures: "with_futures", sort: "size", limit: 5 });
s = r.result.structuredContent;
assert.ok(s.unlocks.length <= 5 && s.unlocks.every((u) => u.strength === "strong" && u.perpetual_futures_on.length > 0));
assert.ok(s.unlocks.every((u, i, a) => i === 0 || a[i - 1].share_of_circulating_pct >= u.share_of_circulating_pct));
ok("strong + futures + size sort + limit: " + s.unlocks.map((u) => u.symbol + " " + u.share_of_circulating_pct + "%").join(", "));
r = await call("get_upcoming_unlocks", { days: 999, limit: -3, lang: "ru" });
s = r.result.structuredContent; assert.equal(s.window_days, 60); assert.equal(s.shown, Math.min(1, s.matched)); assert.ok(s.unlocks[0].page.includes("/ru/unlock/"));
assert.equal(s.telegram_channel, undefined); assert.equal(s.alerts, undefined);
ok("bad numbers are clamped, ru links, ru telegram");
const sym = s.unlocks[0].symbol;
r = await call("get_token_unlocks", { token: "$" + sym.toLowerCase() });
s = r.result.structuredContent; assert.ok(s.found >= 1 && s.unlocks[0].symbol === sym && Array.isArray(s.unlocks[0].recipients_detail) && s.unlocks[0].add_to_calendar.endsWith(".ics"));
ok("token lookup by $ticker: " + sym);
r = await call("get_token_unlocks", { token: "zzzz-not-a-coin" }); assert.equal(r.result.structuredContent.found, 0); ok("unknown token -> found 0 with message");
r = await call("get_token_unlocks", { token: "a" }); assert.ok(r.result.structuredContent.found <= 20); ok("one-letter query does not fuzzy-match everything");
r = await call("get_token_unlocks", {}); assert.equal(r.result.isError, true); ok("missing token -> isError");
r = await call("get_method_and_track_record");
s = r.result.structuredContent; assert.equal(s.thresholds.strong, "B >= 10.4%"); assert.ok(s.track_record.strong.unlocks > 50);
assert.equal(s.alerts.telegram, "https://t.me/+JITtUsgJ2zE5ZjEy");
ok(`track record: strong ${s.track_record.strong.fell_share_pct}% fell, avg ${s.track_record.strong.average_move_vs_btc_pct}%`);

r = await call("get_upcoming_unlocks", { days: 60, min_strength: "strong", limit: 100 });
s = r.result.structuredContent;
assert.ok(/strong unlocks/.test(s.track_record_strong)); assert.ok(s.unlocks.every((u) => u.volume_24h_usd === null || typeof u.volume_24h_usd === "number"));
assert.ok(s.unlocks.filter((u) => u.share_of_circulating_range_pct).every((u) => u.share_of_circulating_range_pct[0] <= u.share_of_circulating_range_pct[1] && u.range_note));
assert.ok(s.unlocks.filter((u) => u.liquidity_note).every((u) => u.volume_24h_usd < 250000));
assert.equal(s.telegram_channel, undefined);
ok("v1.1: telegram, track record, ranges (" + s.unlocks.filter((u) => u.share_of_circulating_range_pct).length + "), liquidity notes (" + s.unlocks.filter((u) => u.liquidity_note).length + ")");

// HTTP (Worker) mode
const post = (body) => handleHttp(new Request("https://x.dev/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
let h = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
assert.equal(h.status, 200); assert.equal(h.headers.get("content-type"), "application/json"); assert.equal(h.headers.get("access-control-allow-origin"), "*");
assert.equal((await h.json()).result.tools.length, TOOLS.length); ok("HTTP POST /mcp tools/list");
h = await post({ jsonrpc: "2.0", method: "notifications/initialized" }); assert.equal(h.status, 202); ok("HTTP notification -> 202");
h = await post("{bad"); assert.equal(h.status, 400); assert.equal((await h.json()).error.code, -32700); ok("HTTP parse error -> 400");
h = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }, { jsonrpc: "2.0", id: 2, method: "ping" }]);
assert.equal((await h.json()).length, 2); ok("HTTP batch");
h = await handleHttp(new Request("https://x.dev/mcp")); assert.equal(h.status, 405); ok("HTTP GET /mcp -> 405");
h = await handleHttp(new Request("https://x.dev/mcp", { method: "OPTIONS" })); assert.equal(h.status, 204); ok("CORS preflight");
h = await handleHttp(new Request("https://x.dev/")); assert.equal((await h.json()).mcp_endpoint, "https://x.dev/mcp"); ok("info page at /");
h = await handleHttp(new Request("https://x.dev/zzz")); assert.equal(h.status, 404); ok("404");

// stdio mode
const lines = await new Promise((res, rej) => {
  const p = spawn(process.execPath, [path.join(here, "unlockpulse-mcp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.on("error", rej);
  p.on("close", () => res(out.trim().split("\n").map((l) => JSON.parse(l))));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  p.stdin.write("not json\n");
  p.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_upcoming_unlocks", arguments: { days: 7, limit: 3 } } }) + "\n");
});
assert.equal(lines.length, 3); assert.equal(lines[0].id, 1); assert.equal(lines[1].error.code, -32700); assert.equal(lines[2].id, 2);
assert.ok(lines[2].result.structuredContent.shown <= 3); ok("stdio: initialize, parse error, tool call in order");

console.log(`\n${pass} passed`);

// 1.8.0: get_onchain_check. ONCHAIN_FILE=path serves a local onchain.json instead of the site (before it is published).
{
  const local = process.env.ONCHAIN_FILE;
  const f = local ? async (url, o) => (String(url).endsWith("/onchain.json")
      ? { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(local, "utf8")) } : globalThis.fetch(url, o)) : globalThis.fetch;
  const oc = (args, id = 31) => handleMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "get_onchain_check", arguments: args } }, f);
  let q = await oc({ token: "brev" }); let o = q.result.structuredContent;
  assert.equal(q.result.isError, false); assert.equal(o.found, true); assert.equal(o.symbol, "BREV");
  assert.ok(o.finding.includes("never been withdrawn")); assert.ok(o.tracked_wallets.length >= 1 && o.tracked_wallets[0].explorer.startsWith("https://etherscan.io/address/"));
  assert.ok(o.license.includes("CC BY")); assert.ok(typeof o.reading === "string" && o.reading.length > 20);
  ok("onchain BREV: " + o.reading.slice(0, 90));
  q = await oc({ token: "$mbg" }); o = q.result.structuredContent; assert.equal(o.symbol, "MBG"); assert.ok(o.finding.includes("quarterly"));
  assert.ok(!o.next_unlock_per_project_documents || o.next_unlock_per_project_documents.date >= "2026-10-28"); ok("onchain MBG by $ticker, next unlock " + (o.next_unlock_per_project_documents || {}).date);
  q = await oc({ token: "zzzz-none" }); o = q.result.structuredContent; assert.equal(o.found, false); assert.ok(o.covered_tokens.length > 50); ok("onchain unknown token -> covered list");
  q = await oc({}); o = q.result.structuredContent; assert.ok(Array.isArray(o.movements) && o.covered_tokens.length > 50 && o.tokens_with_findings.includes("NEWT"));
  ok("onchain list mode: " + o.movements_found + " movements, findings " + o.tokens_with_findings.length);
  q = await oc({ days: 999 }); assert.equal(q.result.structuredContent.window_days, 30); ok("onchain days clamped");
  const all = local ? fs.readFileSync(local, "utf8") : await (await globalThis.fetch("https://billibo6.github.io/unlockpulse/onchain.json")).text();
  assert.ok(!/[а-яА-ЯёЁ]/.test(all), "no Cyrillic in published onchain.json"); ok("onchain.json has no Cyrillic (no internal notes leak)");
  assert.ok(!/ДЛЯ ШОРТА|для шорта|short/i.test(JSON.stringify(Object.values(JSON.parse(all).tokens).map((t) => t.finding))), "no trading talk in findings");
  ok("findings carry no trading talk");
}
// 1.9.5: recipient_selling_habit. DATA_FILE=path serves a local data.json instead of the site (before it is published).
{
  const local = process.env.DATA_FILE;
  const f = local ? async (url, o) => (String(url).endsWith("/data.json")
      ? { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(local, "utf8")) } : globalThis.fetch(url, o)) : globalThis.fetch;
  const raw = local ? fs.readFileSync(local, "utf8") : await (await globalThis.fetch("https://billibo6.github.io/unlockpulse/data.json")).text();
  const withH = JSON.parse(raw).events.filter((e) => e.recipient_habit && Date.parse(e.date) > Date.now());
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(JSON.stringify(withH.map((e) => e.recipient_habit))), "no addresses in recipient_habit");
  if (withH.length) {
    const hm = local ? (await import("./unlockpulse-mcp.mjs?habit")).handleMessage : handleMessage; // fresh module: no cached live data.json
    const q = await hm({ jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "get_token_unlocks", arguments: { token: withH[0].sym } } }, f);
    const u = q.result.structuredContent.unlocks.find((x) => x.recipient_selling_habit);
    assert.ok(u, "habit passed through"); assert.ok(["usually sells", "usually holds", "mixed"].includes(u.recipient_selling_habit.label));
    assert.ok(u.recipient_selling_habit.past_unlocks_traced >= 3 && u.recipient_selling_habit.note.includes("not a trading signal"));
    ok("recipient_selling_habit " + withH[0].sym + ": " + u.recipient_selling_habit.label);
  } else ok("recipient_selling_habit: not in live data.json yet (skipped)");
}
r = await call("get_dataset_info"); s = r.result.structuredContent; assert.equal(r.result.isError, false); assert.equal(s.server_version, VERSION_EXPECTED); assert.ok(s.calendar.upcoming_unlocks >= 0 && s.calendar.window_days === 60); assert.ok(s.thresholds.strong.startsWith("B >= ")); assert.ok(s.cite_as.includes("CC BY 4.0")); ok("get_dataset_info: coverage, thresholds, citation");
console.log("all passed:", pass);
