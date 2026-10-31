"use strict";

// Tags screen: add, recolour, rename and delete tags. Renaming or deleting a tag also updates
// the expenses that use it, so the lists and the charts stay in step.

const SWATCHES = [...new Set([...BASE_TAGS.map(([, c]) => c), ...TAG_PALETTE])];
let openTag = null;   // the tag whose editor is open

// A row of colour dots to pick from.
function swatches(selected) {
  let value = selected;
  const node = el("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour" });
  const list = SWATCHES.includes(selected) ? SWATCHES : [selected, ...SWATCHES];
  const buttons = list.map((c) => {
    const b = el("button", { type: "button", class: "sw", role: "radio", "aria-label": `Colour ${c}` });
    b.style.background = c;
    b.addEventListener("click", () => { value = c; paint(); });
    return [c, b];
  });
  function paint() {
    for (const [c, b] of buttons) {
      const on = c === value;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
  }
  node.append(...buttons.map(([, b]) => b));
  paint();
  return { node, get value() { return value; } };
}

async function renderTags() {
  const usage = await api("GET", "/api/tags");
  const use = new Map(usage.map((u) => [u.tag, u]));
  const rows = TAGS.map(([name, color]) => ({ name, color, listed: true }));
  // Tags that expenses carry but that are not in the list (for example after a restore).
  for (const u of usage) if (!isKnownTag(u.tag)) rows.push({ name: u.tag, color: nextTagColor(), listed: false });

  const card = el("div", { class: "tg-card" });
  if (!rows.length) card.append(el("div", { class: "empty", text: "No tags yet. Add one above." }));
  for (const t of rows) card.append(tagRow(t, use.get(t.name)));

  $("view-tags").replaceChildren(
    el("p", { class: "hint", text: "Tags colour your expenses and the charts. Renaming or deleting a tag changes it on every expense that uses it." }),
    newTagForm(),
    el("h2", { text: `Your tags (${rows.length})` }),
    card);
}

function newTagForm() {
  const input = el("input", { class: "tg-input", placeholder: "New tag name", maxlength: "30", autocomplete: "off", enterkeyhint: "done", "aria-label": "New tag name" });
  const sw = swatches(nextTagColor());
  const btn = el("button", { type: "button", class: "tg-btn", text: "Add tag" });
  const add = async () => {
    const name = cleanTagName(input.value);
    if (!name) { toast("Tags use letters, numbers and spaces (up to 30)"); return; }
    if (isKnownTag(name)) { toast("That tag already exists"); return; }
    addCustomTag(name, sw.value);
    await renderTags();
  };
  btn.addEventListener("click", add);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  return el("div", { class: "tg-card tg-new" }, el("div", { class: "tg-newrow" }, input, btn), sw.node);
}

function tagRow(t, u) {
  const open = openTag === t.name;
  const dot = el("span", { class: "tg-dot" });
  dot.style.background = t.color;
  const used = u ? `${u.count} expense${u.count === 1 ? "" : "s"} · ${inr(u.amount_paise)}` : "Not used yet";
  const head = el("button", { type: "button", class: "tg-head", "aria-expanded": String(open) },
    dot,
    el("span", { class: "tg-text" },
      el("span", { class: "tg-name", text: t.name }),
      el("span", { class: "tg-meta", text: t.listed ? used : `${used} · not in your list` })),
    el("span", { class: "chev", text: "›" }));
  head.addEventListener("click", () => { openTag = open ? null : t.name; renderTags(); });
  const item = el("div", { class: "tg-item" + (open ? " open" : "") }, head);
  if (open) item.append(tagEditor(t, u));
  return item;
}

function tagEditor(t, u) {
  const input = el("input", { class: "tg-input", maxlength: "30", autocomplete: "off", "aria-label": "Tag name" });
  input.value = t.name;
  const sw = swatches(t.color);
  const save = el("button", { type: "button", class: "tg-btn", text: t.listed ? "Save" : "Add to my tags" });
  const count = u ? u.count : 0;
  const del = el("button", { type: "button", class: "tg-btn danger", text: count ? `Delete (removes it from ${count})` : "Delete" });

  save.addEventListener("click", async () => {
    const name = cleanTagName(input.value);
    if (!name) { toast("Tags use letters, numbers and spaces (up to 30)"); return; }
    if (name !== t.name && isKnownTag(name)) { toast("That tag already exists"); return; }
    try {
      if (name !== t.name && count) await api("POST", "/api/tags/rename", { from: t.name, to: name });
    } catch (err) { toast(err.message); return; }
    const entry = TAGS.find(([n]) => n === t.name);
    if (entry) { entry[0] = name; entry[1] = sw.value; } else TAGS.push([name, sw.value]);
    saveTags();
    openTag = null;
    await renderTags();
  });

  del.addEventListener("click", async () => {
    if (count && !confirm(`Remove "${t.name}" from ${count} expense${count === 1 ? "" : "s"} and delete the tag?`)) return;
    try {
      if (count) await api("POST", "/api/tags/remove", { from: t.name });
    } catch (err) { toast(err.message); return; }
    const i = TAGS.findIndex(([n]) => n === t.name);
    if (i >= 0) TAGS.splice(i, 1);
    saveTags();
    openTag = null;
    await renderTags();
  });

  return el("div", { class: "tg-editor" }, input, sw.node, el("div", { class: "tg-actions" }, del, save));
}
