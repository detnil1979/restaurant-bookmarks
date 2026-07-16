# 瀏覽頁列表化改版 — design (v1.3.0)

**Date:** 2026-07-16 · **Status:** approved by Ted (chat, "go") · **Scope:** 瀏覽全部書籤 tab only; 依需求推薦 tab untouched.

## Problem

The browse tab shows 614 entries as dense cards (3-4 badges + stars + review + note each), ~3
per screen. Too much parallel information; hard to scan.

## Approved direction (A+B hybrid)

Compact list rows + region grouping with quick-jump, progressive disclosure on tap.

### List structure

- One row per restaurant: 3px left color bar (own = `--accent` orange, 路人推薦 = #b197fc
  violet) + name + one muted meta line 「分類 · 地區」 + right-aligned short rating 「★ 4.9」
  (no rating → muted 「—」).
- Single column, max-width ~820px centered (with the index rail beside it).
- Tap a row → expand in place (one at a time; tap again to collapse). Expanded detail order:
  badge row (groups/region/google_category/price) → full star line (`starStr`) → **address**
  (own records have `address` — previously unused) → review_text / note (備註 for passerby,
  筆記 for own) → 「在 Google 地圖開啟」 link button.
- Everything currently on cards that is not name/category/region/short-rating moves into the
  expanded state.

### Region grouping + jump

- Rows grouped by `region`; sticky group headers 「大安 · 96 間」.
- Group order: by count desc, then region name; items within a group follow the existing 排序
  select (rating-first default / name).
- Right-side slim index rail listing the regions present in the current result; tap → smooth
  scroll to that group. Rail hidden when ≤1 group.

### Filter bar

- 種類 `<select>` replaced by one row of chips: 全部 / 吃到飽 / 老饕 / 這裡很無聊 / 路人推薦
  (路人推薦 chip in violet). Active chip highlighted.
- 地區 select, 店名 search, 排序 select, stats row: unchanged.
- All filters compose as before (chip ∧ region ∧ search).

## Engineering constraints

- Single-file vanilla JS; zero new dependencies; offline HTML + APK unaffected mechanisms.
- New pure logic in the `[passerby:pure:start]` marker block (testable via existing harness):
  - `shortStar(d)` → `"★ 4.9"` | `null`.
  - `groupByRegion(records, sortMode)` → `[{region, items}]`, count-desc order, immutable.
- `renderGrid()` replaced by `renderList()` (grouped rows + expansion); `populateFilters()`
  renders chips + region options; `let currentCat`, `let expandedId` module state;
  `toggleRow(id)` re-renders. Live-fetch re-render path calls the same functions.
- Version v1.3.0: header/footer/README, offline copy `我的餐廳書籤資料庫-v1.3.0.html`
  (v1.2.0 file removed), APK v1.3.0 re-signed with the existing keystore in
  `restaurant-bookmarks-signing/` (same signature as v1.2.0 → direct upgrade install, no
  uninstall needed — README notes this).
- Ship: `git push` if collaborator access materialized, else the proven browser-harness web
  flow (upload index.html/offline/APK/README + delete v1.2.0 files + release v1.3.0 with
  ASCII-named APK asset).

## Testing

1. Unit: `shortStar` (rated/unrated), `groupByRegion` (order by count desc; tie → name;
   sort inside groups by rating/name; immutability of input).
2. Browser: chips switch + active state; grouped headers with counts; sticky behavior; rail
   jump; expand/collapse single-row invariant; expanded content (address, note, maps link);
   search/region/sort interplay (rail hides at ≤1 group); 路人推薦 rows violet; recommend tab
   unchanged; console clean.
3. Pages serves v1.3.0 after ship.
