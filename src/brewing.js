/* ==========================================================================
   BlockBook — brewing.js
   Brewing reference data and its renderers. docs/08-REFERENCE-DATA.md
   ========================================================================== */

import { esc } from "./util.js";
import { refTableHTML } from "./reftable.js";

/** "3:00" -> 180. Non-timed values (e.g. "instant") -> null. */
function parseDuration(s) {
  const m = /^(\d+):([0-5]\d)$/.exec(String(s ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatDuration(total) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Splash applies 3/4 of the duration; lingering clouds apply 1/4. */
function scaleDuration(s, factor) {
  const t = parseDuration(s);
  return t === null ? s : formatDuration(Math.floor(t * factor));
}

const SPLASH_FACTOR = 0.75;

const LINGERING_FACTOR = 0.25;

/**
 * The full brewing chain for one potion: the spine, then every variant.
 * docs/08-REFERENCE-DATA.md §3.1
 *
 * Redstone/Glowstone are applied BEFORE Gunpowder — same result either way, but
 * fewer wasted ingredients, so that is the order presented.
 */
function potionChain(p, data) {
  const steps = [];

  if (p.base === "awkward") {
    steps.push({ input: "Water Bottle",   add: "Nether Wart", out: "Awkward Potion" });
    steps.push({ input: "Awkward Potion", add: p.ingredient,  out: p.name, duration: p.baseDuration });
  } else {
    steps.push({ input: "Water Bottle",   add: p.ingredient,  out: p.name, duration: p.baseDuration });
  }

  const variants = [];
  if (p.extended) {
    variants.push({ add: p.extended.with, out: `${p.name} (extended)`, duration: p.extended.duration, kind: "extended" });
  }
  if (p.amplified) {
    variants.push({ add: p.amplified.with, out: `${p.effect} II`, duration: p.amplified.duration, kind: "amplified" });
  }
  if (p.splashable) {
    variants.push({
      add: "Gunpowder", out: `Splash ${p.name}`, kind: "splash",
      duration: scaleDuration(p.baseDuration, SPLASH_FACTOR),
      note: p.extended ? `${scaleDuration(p.extended.duration, SPLASH_FACTOR)} if extended first` : null,
    });
  }
  if (p.lingering) {
    variants.push({
      add: "Dragon's Breath", out: `Lingering ${p.name}`, kind: "lingering",
      duration: scaleDuration(p.baseDuration, LINGERING_FACTOR),
      note: "splash potion only",
    });
  }

  const corrupt = p.corruptsTo
    ? data.entries.find(e => e.id === p.corruptsTo) ?? null
    : null;

  return { steps, variants, corrupt };
}

/**
 * "I have X — what can I brew?" docs/08-REFERENCE-DATA.md §3.9
 *
 * `asSource` is why ingredientSource must always be populated: typing "gold"
 * must surface Night Vision and Healing, because both need gold nuggets even
 * though neither lists gold as its ingredient.
 */
function whatCanIBrew(query, data) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return { query: "", asIngredient: [], asModifier: [], asSource: [], asBase: [] };

  const hit = (s) => String(s ?? "").toLowerCase().includes(q);

  const asIngredient = data.entries.filter(e => hit(e.ingredient));
  const asIngredientIds = new Set(asIngredient.map(e => e.id));

  return {
    query: q,
    asIngredient,
    asModifier: data.modifiers.filter(m => hit(m.name)),
    asBase:     data.bases.filter(b => hit(b.ingredient) || hit(b.name)),
    // Don't repeat a potion that already matched on its ingredient.
    asSource:   data.entries.filter(e => !asIngredientIds.has(e.id) && hit(e.ingredientSource)),
  };
}

const BREWING = {
  schemaVersion: 1,
  dataset: "brewing",
  gameVersion: "1.21",
  verified: true,
  source: "minecraft.wiki, hand-entered 2026-08-14. Durations verified 2026-08-15.",

  bases: [
    { id: "water",   name: "Water Bottle",   from: "Glass bottle filled at any water source or cauldron", notes: "The root of every brew." },
    { id: "awkward", name: "Awkward Potion", base: "water", ingredient: "Nether Wart",
      ingredientSource: "Nether fortress soul sand gardens; farmable on soul sand anywhere",
      notes: "The base for nearly every useful potion. Always brew a stack first." },
    { id: "mundane", name: "Mundane Potion", base: "water", ingredient: "Redstone Dust, Sugar, Spider Eye, Magma Cream, Blaze Powder, Glistering Melon Slice, or Ghast Tear",
      ingredientSource: "Various", notes: "No effect. A dead end — you brewed an ingredient into water instead of into Awkward." },
    { id: "thick",   name: "Thick Potion",   base: "water", ingredient: "Glowstone Dust",
      ingredientSource: "Nether glowstone blobs", notes: "No effect. Dead end." },
  ],

  entries: [
    { id: "fire_resistance", name: "Potion of Fire Resistance", effect: "Fire Resistance", base: "awkward",
      ingredient: "Magma Cream", ingredientSource: "Blaze powder + slimeball, or magma cube drops in the nether",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" }, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["nether", "essential", "utility"],
      notes: "Essential for the nether. Brew before any bastion or fortress run. No level II exists." },

    { id: "swiftness", name: "Potion of Swiftness", effect: "Speed", base: "awkward",
      ingredient: "Sugar", ingredientSource: "Sugar cane",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" },
      amplified: { with: "Glowstone Dust", duration: "1:30" },
      splashable: true, lingering: true, corruptsTo: "slowness", corruptsFrom: null,
      tags: ["utility", "travel"], notes: "Cheapest useful potion — sugar cane is free and renewable." },

    { id: "slowness", name: "Potion of Slowness", effect: "Slowness", base: "awkward",
      ingredient: "Fermented Spider Eye (applied to Swiftness or Leaping)",
      ingredientSource: "Spider eye + brown mushroom + sugar",
      baseDuration: "1:30", extended: { with: "Redstone Dust", duration: "4:00" },
      amplified: { with: "Glowstone Dust", duration: "0:20" },
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: "swiftness",
      tags: ["negative", "combat"], notes: "Only useful as a splash potion thrown at mobs." },

    { id: "strength", name: "Potion of Strength", effect: "Strength", base: "awkward",
      ingredient: "Blaze Powder", ingredientSource: "Blaze rods from a nether fortress — you have one recorded",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" },
      amplified: { with: "Glowstone Dust", duration: "1:30" },
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["combat"], notes: "Adds flat melee damage. Stacks with Sharpness." },

    { id: "healing", name: "Potion of Healing", effect: "Instant Health", base: "awkward",
      ingredient: "Glistering Melon Slice", ingredientSource: "Melon slice + 8 gold nuggets",
      baseDuration: "instant", extended: null, amplified: { with: "Glowstone Dust", duration: "instant" },
      splashable: true, lingering: true, corruptsTo: "harming", corruptsFrom: null,
      tags: ["combat", "healing"], notes: "Instant — Redstone Dust does nothing. Splash heals allies; harms undead." },

    { id: "harming", name: "Potion of Harming", effect: "Instant Damage", base: "awkward",
      ingredient: "Fermented Spider Eye (applied to Healing or Poison)",
      ingredientSource: "Spider eye + brown mushroom + sugar",
      baseDuration: "instant", extended: null, amplified: { with: "Glowstone Dust", duration: "instant" },
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: "healing",
      tags: ["combat", "negative"], notes: "Instant. Heals undead mobs instead of damaging them." },

    { id: "leaping", name: "Potion of Leaping", effect: "Jump Boost", base: "awkward",
      ingredient: "Rabbit's Foot", ingredientSource: "Rabbits",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" },
      amplified: { with: "Glowstone Dust", duration: "1:30" },
      splashable: true, lingering: true, corruptsTo: "slowness", corruptsFrom: null,
      tags: ["utility", "travel"], notes: "Also reduces fall damage by the jump-boost level." },

    { id: "poison", name: "Potion of Poison", effect: "Poison", base: "awkward",
      ingredient: "Spider Eye", ingredientSource: "Spiders — you have a spider spawner recorded",
      baseDuration: "0:45", extended: { with: "Redstone Dust", duration: "1:30" },
      amplified: { with: "Glowstone Dust", duration: "0:21" },
      splashable: true, lingering: true, corruptsTo: "harming", corruptsFrom: null,
      tags: ["combat", "negative"], notes: "Never kills — drops the target to half a heart at most." },

    { id: "regeneration", name: "Potion of Regeneration", effect: "Regeneration", base: "awkward",
      ingredient: "Ghast Tear", ingredientSource: "Ghasts in the nether",
      baseDuration: "0:45", extended: { with: "Redstone Dust", duration: "1:30" },
      amplified: { with: "Glowstone Dust", duration: "0:22" },
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["healing"], notes: "Ghast tears are the bottleneck — kill ghasts over solid ground or the tear despawns in lava." },

    { id: "water_breathing", name: "Potion of Water Breathing", effect: "Water Breathing", base: "awkward",
      ingredient: "Pufferfish", ingredientSource: "Fishing, or ocean mobs",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" }, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["utility", "ocean"], notes: "Essential for the ocean monument near your 823 / -271 shipwreck. No level II." },

    { id: "night_vision", name: "Potion of Night Vision", effect: "Night Vision", base: "awkward",
      ingredient: "Golden Carrot", ingredientSource: "Carrot + 8 gold nuggets",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" }, amplified: null,
      splashable: true, lingering: true, corruptsTo: "invisibility", corruptsFrom: null,
      tags: ["utility", "caving"], notes: "Pairs with Water Breathing for monument runs. No level II." },

    { id: "invisibility", name: "Potion of Invisibility", effect: "Invisibility", base: "awkward",
      ingredient: "Fermented Spider Eye (applied to Night Vision)",
      ingredientSource: "Spider eye + brown mushroom + sugar",
      baseDuration: "3:00", extended: { with: "Redstone Dust", duration: "8:00" }, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: "night_vision",
      tags: ["utility", "stealth"], notes: "Worn armour and held items stay visible. Remove armour for true invisibility." },

    { id: "weakness", name: "Potion of Weakness", effect: "Weakness", base: "water",
      ingredient: "Fermented Spider Eye", ingredientSource: "Spider eye + brown mushroom + sugar",
      baseDuration: "1:30", extended: { with: "Redstone Dust", duration: "4:00" }, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["utility", "negative", "villager"],
      notes: "The only useful potion brewed directly from water. Splash Weakness + golden apple cures zombie villagers." },

    { id: "slow_falling", name: "Potion of Slow Falling", effect: "Slow Falling", base: "awkward",
      ingredient: "Phantom Membrane", ingredientSource: "Phantoms — spawn after 3 in-game days without sleeping",
      baseDuration: "1:30", extended: { with: "Redstone Dust", duration: "4:00" }, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["utility", "travel"], notes: "Negates all fall damage. Carry one on any nether ceiling trip." },

    { id: "turtle_master", name: "Potion of the Turtle Master", effect: "Slowness IV + Resistance III", base: "awkward",
      ingredient: "Turtle Shell", ingredientSource: "5 scutes from baby turtles growing up",
      baseDuration: "0:20", extended: { with: "Redstone Dust", duration: "0:40" },
      amplified: { with: "Glowstone Dust", duration: "0:20" },
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["combat", "defence"], notes: "Massive damage reduction at the cost of near-immobility. Emergency button, not a buff." },

    { id: "wind_charged", name: "Potion of Wind Charging", effect: "Wind Charged", base: "awkward",
      ingredient: "Breeze Rod", ingredientSource: "Breeze in a trial chamber — YOU HAVE ONE at 2217 / -5 / -4024",
      baseDuration: "3:00", extended: null, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["combat", "1.21"], notes: "1.21 addition. Emits a wind burst when the affected entity is damaged. VERIFY duration and variants for your version." },

    { id: "weaving", name: "Potion of Weaving", effect: "Weaving", base: "awkward",
      ingredient: "Cobweb", ingredientSource: "Spider spawner area — YOU HAVE ONE at 91 / -13 / 200",
      baseDuration: "3:00", extended: null, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["combat", "1.21"], notes: "1.21 addition. Spreads cobwebs when the affected entity dies. VERIFY variants." },

    { id: "oozing", name: "Potion of Oozing", effect: "Oozing", base: "awkward",
      ingredient: "Slime Block", ingredientSource: "9 slimeballs — slime chunks or swamp slimes",
      baseDuration: "3:00", extended: null, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["combat", "1.21"], notes: "1.21 addition. Spawns two slimes on the affected entity's death. VERIFY variants." },

    { id: "infested", name: "Potion of Infestation", effect: "Infested", base: "awkward",
      ingredient: "Stone", ingredientSource: "Any stone block",
      baseDuration: "3:00", extended: null, amplified: null,
      splashable: true, lingering: true, corruptsTo: null, corruptsFrom: null,
      tags: ["combat", "1.21"], notes: "1.21 addition. Chance to spawn silverfish when the affected entity takes damage. VERIFY variants." },
  ],

  modifiers: [
    { id: "redstone", name: "Redstone Dust", effect: "Extends duration",
      appliesTo: "Any non-instant potion",
      doesNotWorkOn: "Healing, Harming (instant), and the 1.21 effect potions",
      notes: "Apply BEFORE Gunpowder. Same result either way, fewer wasted ingredients." },
    { id: "glowstone", name: "Glowstone Dust", effect: "Increases to level II, usually shortening duration",
      appliesTo: "Potions that have a level II",
      doesNotWorkOn: "Fire Resistance, Night Vision, Invisibility, Water Breathing, Slow Falling, Weakness, and the 1.21 effect potions",
      notes: "Mutually exclusive with Redstone Dust — a potion is extended OR amplified, never both." },
    { id: "gunpowder", name: "Gunpowder", effect: "Converts to a Splash potion (throwable)",
      appliesTo: "Any potion", doesNotWorkOn: "—",
      notes: "Splash applies about 3/4 of the base duration to others. Apply last." },
    { id: "dragons_breath", name: "Dragon's Breath", effect: "Converts a Splash potion to Lingering",
      appliesTo: "Splash potions only", doesNotWorkOn: "Regular potions — must be splashed first",
      notes: "Lingering clouds apply about 1/4 of the base duration. Collected from the dragon's breath attack with an empty bottle." },
    { id: "fermented_spider_eye", name: "Fermented Spider Eye", effect: "Corrupts a potion into its counterpart",
      appliesTo: "See the corruption table", doesNotWorkOn: "Potions with no counterpart",
      notes: "Crafted from spider eye + brown mushroom + sugar." },
  ],

  corruptions: [
    { from: "night_vision", fromName: "Night Vision", to: "invisibility", toName: "Invisibility" },
    { from: "swiftness",    fromName: "Swiftness",    to: "slowness",     toName: "Slowness" },
    { from: "leaping",      fromName: "Leaping",      to: "slowness",     toName: "Slowness" },
    { from: "healing",      fromName: "Healing",      to: "harming",      toName: "Harming" },
    { from: "poison",       fromName: "Poison",       to: "harming",      toName: "Harming" },
    { from: "water",        fromName: "Water Bottle", to: "weakness",     toName: "Weakness" },
    { from: "awkward",      fromName: "Awkward",      to: "weakness",     toName: "Weakness" },
    { from: "thick",        fromName: "Thick",        to: "weakness",     toName: "Weakness" },
    { from: "mundane",      fromName: "Mundane",      to: "weakness",     toName: "Weakness" },
  ],
};


/* ==========================================================================
   PRESENTATION CONSTANTS — docs/04-UIUX-SPEC.md §4.2, §4.3
   Emoji, not an icon pack: zero bytes, zero build step, already themed. ADR-011
   ========================================================================== */

function chainHTML(p) {
  const { steps, variants, corrupt } = potionChain(p, BREWING);

  const spine = steps.map((s, i) => `
    <div class="chain-step">
      <div class="chain-from">${i === 0 ? esc(s.input) : ""}</div>
      <div class="chain-add">+ ${esc(s.add)}</div>
      <div class="chain-out">
        ${esc(s.out)}
        ${s.duration ? `<span class="chain-dur">${esc(s.duration)}</span>` : ""}
      </div>
    </div>`).join("");

  const vars = variants.map(v => `
    <div class="chain-variant ${esc(v.kind)}">
      <span class="chain-add">+ ${esc(v.add)}</span>
      <span class="chain-out">${esc(v.out)}</span>
      <span class="chain-dur">${esc(v.duration)}</span>
      ${v.note ? `<span class="muted">(${esc(v.note)})</span>` : ""}
    </div>`).join("");

  const gaps = [
    !p.extended  ? "Redstone Dust does nothing — this potion cannot be extended."  : null,
    !p.amplified ? "Glowstone Dust does nothing — this potion has no level II."    : null,
  ].filter(Boolean);

  return `
    <div class="chain">
      <div class="chain-spine">${spine}</div>
      ${vars ? `<div class="chain-variants">${vars}</div>` : ""}
      ${corrupt ? `<div class="chain-variant corrupt">
          <span class="chain-add">+ Fermented Spider Eye</span>
          <span class="chain-out">${esc(corrupt.name)}</span>
          <span class="muted">(corrupts)</span>
        </div>` : ""}
      ${gaps.length ? `<ul class="msg-list muted">${gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
      <dl class="chain-meta">
        <dt>Source</dt><dd>${esc(p.ingredientSource)}</dd>
        ${p.notes ? `<dt>Note</dt><dd>${esc(p.notes)}</dd>` : ""}
      </dl>
    </div>`;
}

/**
 * @param {string} q  the "I have…" query. Injected rather than read from state:
 *   brewing.js sits below store.js in the dependency graph and must not reach
 *   into application state. docs/02-TRD.md §4
 */
function reverseLookupHTML(q) {
  const r = whatCanIBrew(q, BREWING);
  const total = r.asIngredient.length + r.asModifier.length + r.asSource.length + r.asBase.length;

  const group = (title, items, render) => items.length
    ? `<div class="rl-group"><div class="rl-title">${esc(title)}</div>${items.map(render).join("")}</div>`
    : "";

  return `
    <section class="have">
      <div class="section-label">I have&hellip;</div>
      <input type="text" id="brew-have" value="${esc(q)}" autocomplete="off" spellcheck="false"
             placeholder="magma cream, gold, blaze&hellip;" aria-label="What ingredient do you have?">
      ${!q.trim() ? `<p class="hint">Type an ingredient to see what it brews.</p>`
        : total === 0 ? `<p class="hint">Nothing uses &ldquo;${esc(q.trim())}&rdquo;. Try a potion name in the table above instead.</p>`
        : `
        ${group("Brews directly into", r.asIngredient, e => `
          <button class="rl-hit" data-act="select-potion" data-id="${esc(e.id)}">
            ${esc(e.name)} <span class="muted">from ${esc(e.base)}</span></button>`)}
        ${group("Needed to make", r.asSource, e => `
          <button class="rl-hit" data-act="select-potion" data-id="${esc(e.id)}">
            ${esc(e.name)} <span class="muted">— ${esc(e.ingredientSource)}</span></button>`)}
        ${group("Modifier", r.asModifier, m => `
          <div class="rl-hit static"><strong>${esc(m.name)}</strong> — ${esc(m.effect)}</div>`)}
        ${group("Base", r.asBase, b => `
          <div class="rl-hit static"><strong>${esc(b.name)}</strong>${b.ingredient ? ` — water + ${esc(b.ingredient)}` : ""}</div>`)}
      `}
    </section>`;
}

/** Persistent footer: small, constantly needed, never hidden behind a click. */
function brewingFooterHTML() {
  return `
    <section class="brew-footer">
      <div>
        <div class="section-label">Modifiers</div>
        <ul class="kv">
          ${BREWING.modifiers.map(m => `
            <li><strong>${esc(m.name)}</strong> — ${esc(m.effect)}</li>`).join("")}
        </ul>
      </div>
      <div>
        <div class="section-label">Fermented Spider Eye corrupts</div>
        <ul class="kv">
          ${BREWING.corruptions.map(c => `
            <li>${esc(c.fromName)} &rarr; <strong>${esc(c.toName)}</strong></li>`).join("")}
        </ul>
      </div>
    </section>`;
}

/**
 * @param {Object} ui         the reftable slice for this table (state.ui.ref.brewing)
 * @param {string} haveQuery  the "I have…" query
 * Both injected, for the dependency-graph reason above.
 */
function brewingPanelHTML(ui, haveQuery) {
  const cfg = {
    id: "brewing",
    rows: BREWING.entries,
    placeholder: "Search potions, effects, ingredients…",
    emptyText: "No potion matches. Try an ingredient name in “I have…” below.",
    searchKeys: ["name", "effect", "ingredient", "ingredientSource", "notes", "tags"],
    filters: [{
      key: "tags", label: "All tags",
      values: [...new Set(BREWING.entries.flatMap(e => e.tags))].sort(),
    }],
    columns: [
      { key: "name",         label: "Potion", format: r => `<strong>${esc(r.name)}</strong>` },
      { key: "ingredient",   label: "Ingredient" },
      { key: "baseDuration", label: "Base", align: "right" },
      { key: "_variants",    label: "Variants", sortable: false, format: r => [
          r.extended  ? `<span class="pill">ext ${esc(r.extended.duration)}</span>` : "",
          r.amplified ? `<span class="pill">II</span>` : "",
          r.splashable ? `<span class="pill">splash</span>` : "",
        ].join(" ") },
    ],
    detail: chainHTML,
  };

  const unverified = BREWING.verified ? "" : `
    <div class="verdict warn" style="margin-bottom:var(--s-3)">
      &#9888; Durations in this table are <strong>unverified</strong> for game version
      ${esc(BREWING.gameVersion)}. The brewing graph (what makes what) is exact; the
      numbers shift between releases. Check them against minecraft.wiki for your
      installed version, then set <code>verified: true</code> in
      <code>data/brewing.json</code> and in the inline copy.
    </div>`;

  return `${unverified}${refTableHTML(cfg, ui)}${reverseLookupHTML(haveQuery)}${brewingFooterHTML()}`;
}

/* ---- settings & import modals — docs/03-APP-FLOW.md §§7,8,10 ---- */

export {
  parseDuration,
  formatDuration,
  scaleDuration,
  SPLASH_FACTOR,
  LINGERING_FACTOR,
  potionChain,
  whatCanIBrew,
  BREWING,
  chainHTML,
  reverseLookupHTML,
  brewingFooterHTML,
  brewingPanelHTML,
};
