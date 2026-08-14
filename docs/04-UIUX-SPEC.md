# 04 — UI/UX Specification

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14

Behaviour lives in [03-APP-FLOW](03-APP-FLOW.md). This is layout, tokens, components,
and states.

---

## 1. Design principles

| # | Principle | What it rules out |
|---|---|---|
| D1 | **Dark by default** | The app opens next to a dark game, often at night. A light flash is a real physical annoyance. Light theme exists but is not the default. |
| D2 | **Information density over whitespace** | This is a reference tool, not a landing page. Fit ~12 locations on screen without scrolling at the default window size. |
| D3 | **Keyboard first** | Every journey completable without a mouse. If a control has no keyboard path, it is unfinished. |
| D4 | **Never hide the coordinate** | The number is the product. It is never behind a hover, a tooltip, an expander, or a click. |
| D5 | **Emoji over icon packs** | Zero bytes, zero build step, instantly recognisable, already themed. A downloaded icon set is a dependency for no gain. |
| D6 | **One render function** | No partial DOM patching. Rebuild the tab from state. Simplicity is worth more than the microseconds. |

---

## 2. Design tokens

Declare once at `:root`. Never hard-code a colour anywhere else.

```css
:root {
  /* ---- Surfaces (dark, default) ---- */
  --bg-0:        #0e1116;   /* window background            */
  --bg-1:        #161b22;   /* cards, panels                */
  --bg-2:        #21262d;   /* inputs, hover                */
  --bg-3:        #30363d;   /* borders, dividers            */

  /* ---- Text ---- */
  --fg-0:        #e6edf3;   /* primary                      */
  --fg-1:        #9198a1;   /* secondary, labels            */
  --fg-2:        #6e7681;   /* tertiary, placeholders       */

  /* ---- Dimension identity ---- */
  --ow:          #3fb950;   /* overworld — green            */
  --ow-bg:       #12261a;
  --nether:      #f85149;   /* nether — red                 */
  --nether-bg:   #2d1416;
  --end:         #bc8cff;   /* end — purple                 */
  --end-bg:      #21182f;

  /* ---- Status ---- */
  --ok:          #3fb950;   /* tight link, valid            */
  --warn:        #d29922;   /* loose link, conflict         */
  --bad:         #f85149;   /* broken link, error           */
  --info:        #58a6ff;   /* links, focus, selection      */

  /* ---- Type ---- */
  --font-ui:     "Segoe UI", system-ui, sans-serif;
  --font-mono:   "Cascadia Mono", Consolas, ui-monospace, monospace;
  --fs-xs:       11px;
  --fs-sm:       12px;
  --fs-md:       14px;   /* body default                    */
  --fs-lg:       16px;
  --fs-xl:       20px;

  /* ---- Space (4px scale) ---- */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px;
  --s-4: 16px; --s-5: 24px; --s-6: 32px;

  /* ---- Shape ---- */
  --r-sm: 4px; --r-md: 6px; --r-lg: 10px;
  --border: 1px solid var(--bg-3);
  --shadow: 0 8px 24px rgba(0,0,0,.4);
}

:root[data-theme="light"] {
  --bg-0: #ffffff;  --bg-1: #f6f8fa;  --bg-2: #eaeef2;  --bg-3: #d0d7de;
  --fg-0: #1f2328;  --fg-1: #59636e;  --fg-2: #818b98;
  --ow: #1a7f37;  --ow-bg: #dafbe1;
  --nether: #cf222e; --nether-bg: #ffebe9;
  --end: #8250df;  --end-bg: #fbefff;
  --ok: #1a7f37;  --warn: #9a6700;  --bad: #cf222e;  --info: #0969da;
  --shadow: 0 8px 24px rgba(0,0,0,.12);
}
```

**Coordinates are always `--font-mono`.** Digits must align vertically down a list —
proportional numerals make scanning a column of coordinates measurably harder.

**Contrast:** `--fg-0` on `--bg-0` is ~13:1; `--fg-1` on `--bg-1` is ~5.2:1. Both clear
4.5:1. `--fg-2` is for placeholders and decorative text only — never for data.

---

## 3. Window & layout

| Property | Value |
|---|---|
| Default size | 900 × 640 |
| Minimum size | 560 × 400 |
| Compact mode (v1.0 optional) | 420 × 520 — search + results only |
| Resizable | Yes; position and size persisted |
| Always-on-top | Default on, toggleable |

```
╔═════════════════════════════════════════════════════════════════════╗
║ ⛏ BlockBook   Coordinates │ Portals │ Brewing │ Reference      ⚙   ║  48px
╠═════════════════════════════════════════════════════════════════════╣
║ 🔍 Search locations…                                    [+ Add]     ║  44px
║ [All][🟩 OW][🟥 Nether][🟪 End]   [All types ▾]   Sort: [Updated ▾] ║  36px
╠═════════════════════════════════════════════════════════════════════╣
║                                                                     ║
║  ⭐ FAVOURITES                                                      ║
║  ┌───────────────────────────────────────────────────────────────┐  ║
║  │ 🏠  Home                            221 / 65 / 374   🟩 OW   ⋯│  ║
║  └───────────────────────────────────────────────────────────────┘  ║
║                                                                     ║  flex
║  ALL LOCATIONS · 14                                                 ║
║  ┌───────────────────────────────────────────────────────────────┐  ║
║  │ 🌀  Home Portal (Nether side)        16 / 46 / 38   🟥 NE   ⋯│  ║
║  │     ↔ overworld 128 / 304          ✅ Tight → Home            │  ║
║  ├───────────────────────────────────────────────────────────────┤  ║
║  │ 💀  Zombie Spawner A                 97 / -19 / 468 🟩 OW   ⋯│  ║
║  │     zombie                                                    │  ║
║  └───────────────────────────────────────────────────────────────┘  ║
╠═════════════════════════════════════════════════════════════════════╣
║ 15 locations · 6 portals · ⚠ 1 link conflict          v0.3 · saved  ║  26px
╚═════════════════════════════════════════════════════════════════════╝
```

---

## 4. Components

### 4.1 Location card

```
┌─────────────────────────────────────────────────────────────────┐
│ 🌀  Home Portal (Nether side)         16 / 46 / 38    🟥 NE  ⋯ │
│     ↔ overworld 128 / 304           ✅ Tight → Home            │
│     main · storage                                              │
└─────────────────────────────────────────────────────────────────┘
  │   │                                  │            │        │
  │   └ name, --fs-md, --fg-0            │            │        └ overflow menu
  └ type icon, 20px                      │            └ dimension badge
                                         └ coordinate, --font-mono, --fs-md
```

| Row | Contents | Shown when |
|---|---|---|
| 1 | icon · name · coordinate · dimension badge · ⋯ | Always |
| 2 | counterpart coordinate · link health badge | `type == "portal"` |
| 3 | tags as small chips | Any tags exist |
| 4 | note preview, one line, ellipsised | A note exists and search matched it |

**States:** default `--bg-1` · hover `--bg-2` · keyboard-focused 2px `--info` outline ·
favourite gets a left border in `--warn`.

**Overflow menu (⋯):** Edit · Copy `/tp` · Copy coordinate · Toggle favourite ·
Set portal link · Delete.

### 4.2 Dimension badge

| Dimension | Label | Colour | Background |
|---|---|---|---|
| Overworld | `OW` | `--ow` | `--ow-bg` |
| Nether | `NE` | `--nether` | `--nether-bg` |
| End | `EN` | `--end` | `--end-bg` |

Uppercase, `--fs-xs`, letter-spacing 0.5px, `--r-sm`, padding `2px 6px`.
The colour, not the text, is what the eye reads. Keep the three maximally distinct.

### 4.3 Type icons

Emoji. No downloads, no build step, no licensing.

| Type | Icon | Type | Icon |
|---|---|---|---|
| `base` | 🏠 | `village` | 🏘 |
| `portal` | 🌀 | `stronghold` | 🏰 |
| `spawner` | 💀 | `fortress` | 🔥 |
| `structure` | 🏛 | `bastion` | 🐷 |
| `biome` | 🌳 | `monument` | 🔱 |
| `mine` | ⛏ | `shipwreck` | 🚢 |
| `farm` | 🌾 | `trial_chamber` | ⚔ |
| | | `misc` | 📍 |

### 4.4 Link health badge

| State | Badge | Distance | Colour | Tooltip |
|---|---|---|---|---|
| Tight | `✅ Tight` | ≤ 16 | `--ok` | "Reliably paired." |
| Loose | `🟡 Loose` | 17–128 | `--warn` | "Works, but another portal could steal this link." |
| Broken | `❌ Broken` | > 128 | `--bad` | "These two do NOT link to each other." |
| Unpaired | `— Unlinked` | — | `--fg-2` | "No partner recorded." |

Broken pairs are additionally counted in the status bar and in the Portals tab header.
A broken link the player does not know about is exactly the failure this app exists
to prevent.

### 4.5 Search bar

- Full width minus the Add button. Placeholder: `Search locations…`
- Focused on launch and on every window summon.
- Filters live per keystroke, no debounce needed at this data size.
- Matches, case-insensitively, against: name → tags → notes, in that priority order.
- A clear `✕` appears when non-empty. `Esc` clears before it hides the window.
- Empty result: see §6.

### 4.6 Filter chips

```
[ All ] [ 🟩 Overworld ] [ 🟥 Nether ] [ 🟪 End ]     [ All types ▾ ]
```
Single-select for dimension. Type is a dropdown because there are 15 of them.
Active chip: filled with the dimension's `-bg` token, 1px border in its main colour.

### 4.7 Add / Edit modal

```
╔══════════════════════════════════════════════════════════╗
║  Add location                                        ✕   ║
╠══════════════════════════════════════════════════════════╣
║  Name        [ Ancient Debris Vein                    ]  ║
║                                                          ║
║  Dimension   ( ) Overworld  ( ) Nether  ( ) End    *req  ║
║                                                          ║
║  X [ -212 ]   Y [ 14 ]   Z [ 88 ]                        ║
║              └─ Nether: 0–127 ✓                          ║
║                                                          ║
║  Type        [ mine ▾ ]                                  ║
║  Tags        [ debris, netherite                      ]  ║
║  Notes       [                                        ]  ║
║              [                                        ]  ║
║  ☐ Favourite                                             ║
║                                                          ║
║  ┌─ shown only when type = portal ────────────────────┐  ║
║  │ ↔ Counterpart: overworld -1696 / 704               │  ║
║  │ ⚠ Will likely link to Home Portal (63 blocks).     │  ║
║  │   [Link them]  [Ignore]                            │  ║
║  │ Links to: [ none ▾ ]                               │  ║
║  └────────────────────────────────────────────────────┘  ║
║                                    [ Cancel ] [ Save ]   ║
╚══════════════════════════════════════════════════════════╝
```

**Rules:**
- Name field autofocused. `Ctrl+Enter` saves from anywhere in the form.
- **Dimension has no preselected value.** Save is disabled until one is chosen.
- The Y hint updates the moment a dimension is picked and validates on blur.
- The portal panel expands and collapses without shifting the buttons — reserve its
  height, or animate it, but never let Save jump under the cursor.
- Hard blockers: missing name, missing dimension. Everything else is a warning.

### 4.8 Nether converter (Portals tab)

```
┌──────────────────────────────┬──────────────────────────────┐
│  🟩 OVERWORLD                │  🟥 NETHER                   │
│  X  [    2217   ]            │  X  [     277   ]            │
│  Z  [   -4024   ]            │  Z  [    -503   ]            │
└──────────────────────────────┴──────────────────────────────┘
              ↕ live, both directions, every keystroke

  Y is not converted. Nether Y and Overworld Y are unrelated.

  ── Portals near 277 / -503 ────────────────────────────────
  🌀 Fortress Portal (Nether)      276 / 45 / -507   4 blocks  ✅
```

Large monospace inputs (`--fs-xl`). This is a calculator; the numbers are the UI.
The Y note is permanent text, not a tooltip — it prevents the app's most likely
user misconception.

### 4.9 Import review table

```
╔═══════════════════════════════════════════════════════════════════╗
║  Review import — 12 locations                                 ✕   ║
║  Dimensions are guessed. Verify every row before importing.       ║
╠═══════════════════════════════════════════════════════════════════╣
║  ☑ │ Name             │ Dimension │   X  │  Y  │   Z  │ Type      ║
║  ☑ │ [Home          ] │ [OW    ▾] │  221 │  65 │  374 │ [base  ▾] ║
║  ☑ │ [Portal 631    ] │ [OW    ▾]ᵍ│  631 │  67 │  245 │ [portal▾] ║
║  ☐ │ [(unnamed)     ] │ [ ?    ▾] │ 2411 │  22 │ -326 │ [misc  ▾] ║
║                                                                   ║
║  ᵍ = guessed by heuristic          ⚠ 1 row needs a dimension      ║
║                                        [ Cancel ] [ Import 11 ]   ║
╚═══════════════════════════════════════════════════════════════════╝
```

Guessed dimensions carry a superscript marker and `--warn` text until touched.
`[Import]` is disabled while any checked row has dimension `?`.

### 4.10 Brewing tree

```
🧪  Potion of Fire Resistance                       [☆ favourite]

    Water Bottle
        │  + Nether Wart
        ▼
    Awkward Potion
        │  + Magma Cream
        ▼
    Fire Resistance ······················· 3:00
        │
        ├── + Redstone Dust ··············· 8:00     (extended)
        ├── + Gunpowder ··················· 6:00     (splash)
        └── + Dragon's Breath ············· lingering (splash only)

    Level II   not available for this potion
    Source     blaze powder + slimeball, or magma cubes in the nether
    Note       essential for the nether — brew before any bastion run
```

Rendered with CSS borders, not box-drawing characters — the characters break at
non-monospace sizes and copy badly.

### 4.11 Toast

Bottom-right, 2.5 s, `--bg-2`, `--shadow`, `--r-md`. Used for: copied to clipboard,
exported, imported N locations, saved. Never used for errors — errors are persistent
banners.

### 4.12 Banner

Full-width, below the tab bar, dismissible only when the condition is resolved.
Used for: corrupt data recovered, write failure, newer schema version.
`--bad` background tint with a matching left border.

---

## 5. Motion

| Element | Duration | Easing |
|---|---|---|
| Modal open/close | 120 ms | `ease-out` |
| Toast in/out | 150 ms | `ease-out` |
| Card hover | 80 ms | `linear` |
| Portal panel expand | 140 ms | `ease-in-out` |
| Everything else | 0 | — |

Nothing over 150 ms. This app is used under time pressure with a game paused behind
it. Honour `prefers-reduced-motion: reduce` by dropping all of it to 0.

---

## 6. Empty & edge states

| Situation | Display |
|---|---|
| No locations at all | 📍 "No locations yet." · `[+ Add your first]` · `[Import from Notepad]` |
| Search matches nothing | 🔍 "No match for **spawnr**." · `[Clear search]` — and echo the query back; it is usually a typo |
| Filter excludes everything | "No Nether locations of type *farm*." · `[Clear filters]` |
| Brewing search empty | "No potion matches. Try an ingredient name instead." |
| Reference tab not built yet | "Coming in v1.2." — with the planned list. Honest beats fake. |
| Long name | Ellipsis at one line; full text in `title` |
| Y is `null` | Render as `221 / — / 374`, `--fg-2` for the dash. Never `0`, never blank. |
| Very long note | Clamp to one line in the card; full text in the detail view |
| 500+ locations | Same full render. Revisit only if measured over 100 ms. |

---

## 7. Accessibility

- **Keyboard:** every journey in [03-APP-FLOW §11](03-APP-FLOW.md) is mouse-free.
  Modals trap focus and restore it to the trigger on close.
- **Focus:** 2px `--info` outline with a 2px offset. Never `outline: none` without a
  replacement.
- **Colour is never the only signal.** Dimension badges carry text (`OW`/`NE`/`EN`);
  link health carries an emoji plus a word (`✅ Tight`), not just a colour.
- **Contrast:** all data text ≥ 4.5:1. `--fg-2` is decorative only.
- **Semantics:** real `<button>` elements, `<label>` bound to every input, `aria-live="polite"`
  on the result count and toasts, `role="dialog"` + `aria-modal` on modals.
- **Reduced motion:** honoured, per §5.

---

## 8. Copy guidelines

| Do | Don't |
|---|---|
| "Will likely link to **Home Portal** (63 blocks away)." | "Portal conflict detected." |
| "Y must be 0–127 in the Nether." | "Invalid input." |
| "Deletes **Zombie Spawner A**. This cannot be undone." | "Are you sure?" |
| "Exported 15 locations." | "Success!" |
| "Coming in v1.2." | A fake-populated placeholder tab |

Name the thing. Give the number. State the consequence. Every message in this app is
read by someone who wants to get back to a game.
