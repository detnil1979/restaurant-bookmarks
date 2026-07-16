# 路人推薦 integration — design (v1.2.0)

**Date:** 2026-07-16 · **Repo:** detnil1979/restaurant-bookmarks · **Status:** approved by Ted (chat, 2026-07-16)

## Context

The app is a single-file vanilla-JS HTML page (`index.html`, ~376 lines) with 530 restaurant
records baked into one `const DATA = [...]` literal. Two tabs: 依需求推薦 (keyword matcher) and
瀏覽全部書籤 (filter by 種類/地區/星等/店名). Cards link out to Google Maps. It ships three ways,
all from the same file:

- GitHub Pages: <https://detnil1979.github.io/restaurant-bookmarks/> (auto-deploys from `main`)
- Offline copy: `我的餐廳書籤資料庫-vX.Y.Z.html` (byte-identical to `index.html`)
- Android APK: WebView wrapper whose `assets/index.html` is the same file (2.6 KB dex loader)

## Goal

Add the 84 restaurants from Google Sheet 「台北餐廳清單_補齊地址」
(`1XqOiho7B5SauaFsfh-afi2faNkNXFJ9HV4tFkqrGkPY`, gid `1065289423`) as a **separate group named
路人推薦**, visually and logically distinct from Ted's own 530 bookmarks, with self-serve updates
from the sheet.

## Non-goals

- No changes to the 530 existing records or their lists/categories.
- No backend, no build system, no external JS dependencies — stays one self-contained file.
- No fabricated ratings for 路人推薦 entries.

## Data mapping (sheet row → record)

| Sheet | Record field | Rule |
|---|---|---|
| 店名 | `name` | as-is; skip row if empty |
| 類別 | `category` | as-is (e.g. 燒肉); `未提供` → `null` |
| 地址 | `address` | as-is; `未提供`/`查無資料`/`連鎖店(...)` → `null` (row still included) |
| 地址 | `region` | regex `(?:台北|臺北|新北)市(.{1,3}?)區` → district (e.g. 大安); else city (台北/新北); else `未標示地區` |
| 備註 (cols 4-6) | `note` | non-empty cells joined with 「;」 |
| — | `url` | `https://www.google.com/maps/search/?api=1&query=<encode(店名 + ' ' + 地址)>` (店名 only when no address) |
| — | `id` | `pr-<n>` (stable index-based; no collision with Google place ids) |
| — | `lists` | `["路人推薦"]` |
| — | `rating`, `review_count`, `rating_source` | `null` → renders 「尚無評分資料」 |
| — | `source` | `"passerby"` (own bookmarks have no `source` key) |

## UI

- `groupsOf()` gains 路人推薦; 種類 filter and stats row include it.
- 路人推薦 cards carry a distinct colored badge 「路人推薦」 in both tabs.
- 依需求推薦 matches 路人推薦 entries too (approved: included, always badge-labeled).
- Methodology `<details>` gains one line: data source shown as 即時（Google Sheet）or
  內建快照（更新於 YYYY-MM-DD）depending on which loaded.

## Update flow

1. `const PASSERBY_SNAPSHOT = [...]` — the 84 **raw** sheet rows (店名/類別/地址/備註), baked in
   with a snapshot date. Raw, not pre-transformed: both snapshot and live data run through the one
   runtime transform, so the two paths can never diverge.
2. On load, `fetch` the sheet CSV:
   `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&gid=<gid>`.
3. Parse with a small quoted-CSV parser (no deps). Validate: header row recognizable, ≥1 data
   row, every kept row has non-empty 店名. Transform with the same mapping (shared function).
4. Valid → use fetched set, re-render stats/filters/active tab. Any failure (401 while sheet is
   private, offline, malformed) → keep snapshot, no error UI beyond the source line.
5. **Activation:** the sheet is currently private (anon fetch = 401). Live updates start when Ted
   sets sharing to 「知道連結的使用者皆可檢視」. Ted flips this himself — assistant must not
   change sharing settings. App works as snapshot until then.
6. Occasional snapshot refreshes (for offline/APK users): re-run the sync in a future session via
   the Drive connector and push.

## Versioning & artifacts

- Bump header/footer/README to **v1.2.0**; README documents 路人推薦, the update flow, and how to
  enable live updates.
- Replace `我的餐廳書籤資料庫-v1.1.0.html` with `-v1.2.0.html` (git history keeps the old one).
- **APK v1.2.0:** unzip → swap `assets/index.html` → re-sign. Repo has no keystore, so generate a
  new local self-signed key; **do not commit the keystore**; README notes users must uninstall
  v1.1.0 once (signature change). If Java/apksigner is unavailable on this machine, ship
  HTML/Pages/README and log the APK as follow-up.
- Work happens on a feature branch; push to `main` deploys Pages.

## Error handling

- Fetch wrapped in try/catch with a timeout; validation failures fall back to snapshot (fail
  closed, never blank the section).
- Transform is pure (input rows → new array; no mutation of `DATA`).
- 路人推薦 render path must tolerate `null` address/category/rating (existing card code already
  handles `null` rating).

## Testing

1. Transform check on all 84 snapshot rows: count, unique ids, region derivation spot-checks
   (incl. 未提供/查無資料 rows and 三重/蘆洲 → 新北 districts).
2. CSV parser unit check: quoted fields with commas/newlines.
3. Browser (preview pane, local server): stats chip; 種類=路人推薦 filter; badge on cards; a
   recommend query (e.g. 想吃燒肉) surfacing a labeled 路人推薦 result; fallback path (live fetch
   currently 401s → snapshot line shown).
4. After push: verify Pages serves v1.2.0.
