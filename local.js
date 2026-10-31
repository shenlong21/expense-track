"use strict";

// All data lives on this phone, in the browser's IndexedDB. Nothing is sent anywhere.
// localApi() answers the same "requests" the screens used to send to a server, so the
// screens did not have to change. Money is whole paise (integers), like before.

const DB_NAME = "expenses";
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("expenses", { keyPath: "id", autoIncrement: true }).createIndex("date", "date");
        db.createObjectStore("recurring", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("runs", { keyPath: ["rid", "ym"] });   // months already generated per recurring item
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return dbPromise;
}

const wrap = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
// t.done settles when the transaction has fully committed (or failed).
async function transaction(stores, mode) {
  const t = (await openDb()).transaction(stores, mode || "readonly");
  t.done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Could not save"));
  });
  t.done.catch(() => {});
  return t;
}

// ---------- validation ----------
const TAG_RE = /^[a-z0-9][a-z0-9 _&/+-]{0,29}$/;

function normalizeTags(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const t = String(raw).trim().toLowerCase().split(/\s+/).join(" ");
    if (!t) continue;
    if (!TAG_RE.test(t)) throw new Error(`Invalid tag: ${t.slice(0, 30)}`);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 10) throw new Error("At most 10 tags");
  return out;
}

function parseMoney(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new Error("Enter a valid amount");
  const paise = Math.round(parseFloat(s) * 100);
  if (paise <= 0) throw new Error("Amount must be more than zero");
  return paise;
}

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const date = new Date(y, mo - 1, d);
  return y >= 2000 && y <= 2100 && date.getMonth() === mo - 1 && date.getDate() === d;
}

function cleanName(v) {
  const name = String(v ?? "").trim();
  if (!name || name.length > 100) throw new Error("Name must be 1 to 100 characters");
  return name;
}
function cleanNote(v) {
  const note = String(v ?? "").trim();
  if (note.length > 500) throw new Error("Note is too long");
  return note;
}

function cleanExpense(b) {
  if (!validDate(b.date)) throw new Error("Enter a valid date");
  return { name: cleanName(b.name), paise: parseMoney(b.amount), date: b.date, note: cleanNote(b.note), tags: normalizeTags(b.tags) };
}

function cleanRecurring(b) {
  const day = Number(b.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Day must be between 1 and 31");
  return { name: cleanName(b.name), paise: parseMoney(b.amount), day, note: cleanNote(b.note), tags: normalizeTags(b.tags), active: b.active !== false };
}

// ---------- shapes ----------
const expenseOut = (e) => ({
  id: e.id, name: e.name, amount_paise: e.paise, date: e.date, note: e.note, tags: e.tags, recurring: e.rid != null,
});
const recurringOut = (r) => ({
  id: r.id, name: r.name, amount_paise: r.paise, day: r.day, note: r.note, active: r.active, tags: r.tags,
});

const pad2 = (n) => String(n).padStart(2, "0");
const ymOfDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const daysIn = (y, m) => new Date(y, m, 0).getDate();           // m is 1-12

function shiftYm(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

async function expensesBetween(startDate, endDate) {
  const t = await transaction(["expenses"]);
  return wrap(t.objectStore("expenses").index("date").getAll(IDBKeyRange.bound(startDate, endDate)));
}
const monthRange = (ym) => [`${ym}-01`, `${ym}-31`];

// ---------- recurring ----------
// Creates every due entry for every active recurring item, catching up on months missed while the
// app was closed. Each (item, month) is generated at most once, so deleting one does not bring it back.
// A day past the end of a short month (31 in April) lands on that month's last day.
async function generateRecurring(now) {
  const today = now || new Date();
  const todayYm = ymOfDate(today);
  const todayStr = `${todayYm}-${pad2(today.getDate())}`;
  const t = await transaction(["recurring", "expenses", "runs"], "readwrite");
  const items = await wrap(t.objectStore("recurring").getAll());
  let created = 0;
  for (const r of items) {
    if (!r.active) continue;
    for (let ym = r.startYm; ym <= todayYm; ym = shiftYm(ym, 1)) {
      const [y, m] = ym.split("-").map(Number);
      const due = `${ym}-${pad2(Math.min(r.day, daysIn(y, m)))}`;
      if (due > todayStr) continue;
      if (await wrap(t.objectStore("runs").get([r.id, ym]))) continue;
      t.objectStore("runs").put({ rid: r.id, ym });
      t.objectStore("expenses").add({ name: r.name, paise: r.paise, date: due, note: r.note, tags: r.tags, rid: r.id });
      created += 1;
    }
  }
  await t.done;
  return created;
}

// ---------- the "server" ----------
async function localApi(method, path, body) {
  const url = new URL(path, "http://local");
  const parts = url.pathname.split("/").filter(Boolean);        // ["api", "expenses", "12"]
  const [, resource, rawId] = parts;
  const id = rawId === undefined ? null : Number(rawId);
  const q = url.searchParams;

  if (resource === "months" && method === "GET") {
    const t = await transaction(["expenses"]);
    const all = await wrap(t.objectStore("expenses").getAll());
    const byMonth = new Map();
    for (const e of all) {
      const m = byMonth.get(e.date.slice(0, 7)) || { month: e.date.slice(0, 7), total_paise: 0, count: 0 };
      m.total_paise += e.paise; m.count += 1;
      byMonth.set(m.month, m);
    }
    return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  }

  if (resource === "expenses") {
    if (method === "GET") {
      const [start, end] = monthRange(q.get("month"));
      const items = await expensesBetween(start, end);
      items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
      return items.map(expenseOut);
    }
    if (method === "POST") {
      const c = cleanExpense(body);
      const t = await transaction(["expenses"], "readwrite");
      const newId = await wrap(t.objectStore("expenses").add({ name: c.name, paise: c.paise, date: c.date, note: c.note, tags: c.tags, rid: null }));
      await t.done;
      return expenseOut({ id: newId, name: c.name, paise: c.paise, date: c.date, note: c.note, tags: c.tags, rid: null });
    }
    if (method === "PUT") {
      const c = cleanExpense(body);
      const t = await transaction(["expenses"], "readwrite");
      const old = await wrap(t.objectStore("expenses").get(id));
      if (!old) throw new Error("Not found");
      const next = { ...old, name: c.name, paise: c.paise, date: c.date, note: c.note, tags: c.tags };
      await wrap(t.objectStore("expenses").put(next));
      await t.done;
      return expenseOut(next);
    }
    if (method === "DELETE") {
      const t = await transaction(["expenses"], "readwrite");
      if (!(await wrap(t.objectStore("expenses").get(id)))) throw new Error("Not found");
      await wrap(t.objectStore("expenses").delete(id));
      await t.done;
      return null;
    }
  }

  if (resource === "summary" && method === "GET") {
    const month = q.get("month");
    const items = await expensesBetween(...monthRange(month));
    const byTag = new Map();
    let total = 0, untagged = 0;
    for (const e of items) {
      total += e.paise;
      if (!e.tags.length) untagged += e.paise;
      // An expense with several tags counts fully toward each of them.
      for (const tag of e.tags) byTag.set(tag, (byTag.get(tag) || 0) + e.paise);
    }
    const by_tag = [...byTag].map(([tag, amount_paise]) => ({ tag, amount_paise })).sort((a, b) => b.amount_paise - a.amount_paise);
    if (untagged) by_tag.push({ tag: "untagged", amount_paise: untagged });
    return { month, total_paise: total, count: items.length, by_tag };
  }

  if (resource === "trend" && method === "GET") {
    const end = q.get("month");
    const n = Math.min(24, Math.max(1, Number(q.get("months") || 6)));
    const first = shiftYm(end, -(n - 1));
    const items = await expensesBetween(`${first}-01`, `${end}-31`);
    const totals = new Map();
    for (const e of items) totals.set(e.date.slice(0, 7), (totals.get(e.date.slice(0, 7)) || 0) + e.paise);
    return Array.from({ length: n }, (_, i) => { const m = shiftYm(first, i); return { month: m, total_paise: totals.get(m) || 0 }; });
  }

  if (resource === "recurring") {
    if (method === "GET") {
      const t = await transaction(["recurring"]);
      const items = await wrap(t.objectStore("recurring").getAll());
      return items.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name)).map(recurringOut);
    }
    if (method === "POST") {
      const c = cleanRecurring(body);
      const t = await transaction(["recurring"], "readwrite");
      const rec = { name: c.name, paise: c.paise, day: c.day, note: c.note, tags: c.tags, active: c.active, startYm: ymOfDate(new Date()) };
      rec.id = await wrap(t.objectStore("recurring").add(rec));
      await t.done;
      await generateRecurring();
      return recurringOut(rec);
    }
    if (method === "PUT") {
      const c = cleanRecurring(body);
      const t = await transaction(["recurring"], "readwrite");
      const old = await wrap(t.objectStore("recurring").get(id));
      if (!old) throw new Error("Not found");
      const next = { ...old, name: c.name, paise: c.paise, day: c.day, note: c.note, tags: c.tags, active: c.active };
      await wrap(t.objectStore("recurring").put(next));
      await t.done;
      await generateRecurring();
      return recurringOut(next);
    }
    if (method === "DELETE") {
      // Entries already generated stay; they just stop being linked to the item.
      const t = await transaction(["recurring", "expenses", "runs"], "readwrite");
      if (!(await wrap(t.objectStore("recurring").get(id)))) throw new Error("Not found");
      await wrap(t.objectStore("recurring").delete(id));
      const linked = (await wrap(t.objectStore("expenses").getAll())).filter((e) => e.rid === id);
      for (const e of linked) await wrap(t.objectStore("expenses").put({ ...e, rid: null }));
      for (const key of await wrap(t.objectStore("runs").getAllKeys())) if (key[0] === id) await wrap(t.objectStore("runs").delete(key));
      await t.done;
      return null;
    }
  }
  throw new Error("Unsupported request");
}

// ---------- backup: CSV export / import ----------
const csvSafe = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);          // neutralise spreadsheet formulas
const csvUnsafe = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
const csvCell = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function exportCsv() {
  const t = await transaction(["expenses"]);
  const all = await wrap(t.objectStore("expenses").getAll());
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const lines = [["date", "name", "amount_inr", "tags", "note"].join(",")];
  for (const e of all) {
    lines.push([e.date, csvSafe(e.name), (e.paise / 100).toFixed(2), csvSafe(e.tags.join("; ")), csvSafe(e.note)].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

// Restores a file made by exportCsv(). Rows already on the phone are skipped, so importing the
// same backup twice does not duplicate anything.
async function importCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length || rows[0].map((c) => c.trim().toLowerCase()).join(",") !== "date,name,amount_inr,tags,note") {
    throw new Error("This is not an expense backup file");
  }
  const t = await transaction(["expenses"], "readwrite");
  const existing = new Map();
  const sig = (date, name, paise, tags, note) => [date, name, paise, tags.join("; "), note].join("\u0001");
  for (const e of await wrap(t.objectStore("expenses").getAll())) {
    const k = sig(e.date, e.name, e.paise, e.tags, e.note);
    existing.set(k, (existing.get(k) || 0) + 1);
  }
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    let c;
    try {
      c = cleanExpense({
        date: (r[0] || "").trim(), name: csvUnsafe(r[1] || ""), amount: r[2],
        tags: csvUnsafe(r[3] || "").split(";"), note: csvUnsafe(r[4] || ""),
      });
    } catch { skipped += 1; continue; }
    const k = sig(c.date, c.name, c.paise, c.tags, c.note);
    if (existing.get(k) > 0) { existing.set(k, existing.get(k) - 1); skipped += 1; continue; }
    await wrap(t.objectStore("expenses").add({ name: c.name, paise: c.paise, date: c.date, note: c.note, tags: c.tags, rid: null }));
    added += 1;
  }
  await t.done;
  return { added, skipped };
}

// ---------- start-up ----------
async function localReady() {
  await openDb();
  // Ask the browser not to evict our data when the phone is low on space.
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  await generateRecurring();
}
