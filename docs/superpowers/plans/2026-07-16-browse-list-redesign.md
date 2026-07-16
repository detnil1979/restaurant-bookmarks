# 瀏覽頁列表化 Implementation Plan (v1.3.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browse tab's card grid with a region-grouped compact list (sticky headers, index rail, tap-to-expand), per the approved spec.

**Architecture:** All in `index.html`. Two new pure functions (`shortStar`, `groupByRegion`) go inside the `[passerby:pure:start]` marker block (auto-covered by the extraction test harness). `renderGrid()` becomes `renderList()`; `populateFilters()` renders 種類 chips instead of a select; module state `currentCat` / `expandedId`. CSS: list/group/rail/chip rules replace `.grid`/`.card` usage on the browse tab (`.card` CSS stays — the recommend tab's `.rec-card` and existing classes remain untouched).

**Tech Stack:** Vanilla JS, Node test harness (`tests/test-passerby.mjs`), existing keystore for APK, browser-harness web-commit flow for shipping.

**Spec:** `docs/superpowers/specs/2026-07-16-browse-list-redesign-design.md`

---

### Task 1: Pure helpers + tests (TDD)

**Files:** Modify `index.html` (marker block), `tests/test-passerby.mjs`

- [ ] **Step 1: Add failing tests** — extend the destructuring in the test harness with `shortStar, groupByRegion`, and append:

```js
t('shortStar: rated and unrated', () => {
  assert.equal(shortStar({ rating: 4.85 }), '★ 4.9');
  assert.equal(shortStar({ rating: 5 }), '★ 5.0');
  assert.equal(shortStar({ rating: null }), null);
  assert.equal(shortStar({}), null);
});

t('groupByRegion: count-desc order, inner sort, immutability', () => {
  const rs = [
    { name: 'b', region: '大安', rating: 4 },
    { name: 'a', region: '大安', rating: null },
    { name: 'c', region: '中山', rating: 5 },
    { name: 'd', region: '大安', rating: 4.5 },
  ];
  const snapshot = JSON.stringify(rs);
  const g = groupByRegion(rs, 'rating');
  assert.deepEqual(g.map(x => x.region), ['大安', '中山']);
  assert.deepEqual(g[0].items.map(x => x.name), ['d', 'b', 'a']);
  const byName = groupByRegion(rs, 'name');
  assert.deepEqual(byName[0].items.map(x => x.name), ['a', 'b', 'd']);
  assert.equal(JSON.stringify(rs), snapshot);
  const tie = groupByRegion([{ name: 'x', region: '信義' }, { name: 'y', region: '中山' }], 'name');
  assert.deepEqual(tie.map(x => x.region), ['中山', '信義']);
});
```

- [ ] **Step 2: Run — expect FAIL** (`shortStar` undefined): `node tests/test-passerby.mjs`
- [ ] **Step 3: Implement in the marker block** (before `// ==== [passerby:pure:end]`):

```js
function shortStar(d) {
  if (d.rating === null || d.rating === undefined) return null;
  return '★ ' + Number(d.rating).toFixed(1);
}

function groupByRegion(records, sortMode) {
  const map = new Map();
  records.forEach(r => {
    const k = r.region || '未標示地區';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  const sortItems = rows => sortMode === 'name'
    ? rows.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    : rows.slice().sort((a, b) => (b.rating || -1) - (a.rating || -1) || a.name.localeCompare(b.name, 'zh-Hant'));
  return [...map.entries()]
    .map(([region, items]) => ({ region, items: sortItems(items) }))
    .sort((a, b) => b.items.length - a.items.length || a.region.localeCompare(b.region, 'zh-Hant'));
}
```

- [ ] **Step 4: Run — expect 13 passed**, commit `feat: 分組/星等純函式 + 測試`

### Task 2: Browse UI rewrite

**Files:** Modify `index.html` (HTML filters block, CSS, JS render functions)

- [ ] **Step 1: HTML** — in the filters div, replace the `fCategory` select with `<div class="fchips" id="catChips"></div>`; wrap grid in a flex layout with rail: replace `<div class="grid" id="grid"></div>` with `<div class="browse-layout"><div class="list-col" id="grid"></div><div id="regionRail"></div></div>`.
- [ ] **Step 2: CSS** — append after existing `.empty-state` rule: `.fchips`/`.fchip`/`.fchip.active`/`.fchip.violet.active`, `.browse-layout{display:flex;gap:10px;max-width:880px;margin:0 auto}`, `.list-col{flex:1;min-width:0}`, `.lgroup-head` (sticky top 0, bg var(--bg), muted 12px, padding 8px 4px, border-bottom), `.lrow` (border-left 3px accent, border-bottom hairline, hover bg card), `.lrow.passerby{border-left-color:#b197fc}`, `.lrow-main` (flex, gap 10px, padding 10px 12px, cursor pointer), `.lrow-name` 14px/600, `.lrow-meta` 12px muted, `.lrow-star` (margin-left auto, yellow, 12.5px, nowrap; `.dim` variant muted for「—」), `.lrow.open{background:var(--card)}`, `.lrow-detail{padding:0 12px 12px}`, `.lrow-addr` 12px muted margin 6px 0, `.maps-btn` (inline-block, 12px, padding 5px 12px, radius 8px, border accent2, color accent2), `#regionRail` (width 44px, position sticky, top 12px, align-self flex-start, display flex, column, gap 8px, font 11px, color accent2, text-align center, cursor pointer, padding-top 30px).
- [ ] **Step 3: JS state + renderers** — after `function allData() {...}` add `let currentCat = '';` and `let expandedId = null;`. Replace the whole `populateFilters` with the chips version (chips: `['','吃到飽','老饕','這裡很無聊','路人推薦']`, active class, violet class on 路人推薦; region select rebuild preserved as today). Add `setCat(c)`, `toggleRow(id)`, `jumpRegion(r)`. Replace `cardHtml`+`renderGrid` with `listRowHtml`, `lrowDetailHtml`, `renderList`, `renderRail` per the spec (grid element keeps id `grid`; group container ids `g-<region>`). Keep `cardHtml` DELETED (no other caller — verify with grep before removing). Update the listener wiring line to `['fRegion','fSort'].forEach(...renderList)` and search input to `renderList`; update `loadPassersby()` and the init sequence to call `renderList()` instead of `renderGrid()`.
- [ ] **Step 4:** `node tests/test-passerby.mjs` (13 passed) + script parse check + `grep -c "renderGrid\|cardHtml" index.html` → 0. Commit `feat: 瀏覽頁列表化(分組+索引欄+展開)`.

### Task 3: Browser verification (preview server, fix-and-repeat)

- [ ] chips: click 路人推薦 → count 84, violet rows only; 全部 active by default.
- [ ] groups: headers 「大安 · N 間」 count-desc; sticky on scroll; sort=名稱 reorders within group.
- [ ] rail: lists visible regions; click 中山 scrolls to group; filtering to one region hides rail.
- [ ] expand: tap 鮨天本 → badges + full stars + address + maps link; tap another row → previous collapses; tap again → collapses.
- [ ] search 燒 → matching rows only, empty groups gone; recommend tab unchanged; console clean. Screenshot proof.

### Task 4: v1.3.0 artifacts

- [ ] Bump header sub + footer to v1.3.0; `cp index.html 我的餐廳書籤資料庫-v1.3.0.html`; `git rm 我的餐廳書籤資料庫-v1.2.0.html`; README: file table + APK link → v1.3.0, add 版本 row 「v1.3.0 瀏覽頁改版:地區分組列表、快速跳轉、點列展開;同簽章可直接覆蓋安裝」, replace the v1.2.0 uninstall warning with 「v1.2.0 → v1.3.0 直接安裝覆蓋即可(同簽章)」 keeping the v1.1.0 note for stragglers. Run tests; commit `chore: v1.3.0 版本標示、離線檔與 README`.

### Task 5: APK v1.3.0 (existing keystore — same signature, direct upgrade)

- [ ] Same zip-swap + jarsigner flow as v1.2.0 (PATH: `/opt/homebrew/opt/openjdk/bin`), keystore `/Users/tedlin/CClaude/restaurant-bookmarks-signing/restaurant.keystore`, verify `jar verified.`, `unzip -l` sanity, `git rm` old APK, commit `feat: APK v1.3.0(同簽章,直接覆蓋安裝)`.

### Task 6: Ship + release + diary

- [ ] Merge branch to local main (tests green), then: if `gh api ... .permissions.push` is `true` → `git push` + `gh release create v1.3.0` with ASCII asset `restaurant-bookmarks-v1.3.0.apk`. Else browser-harness web flow: upload index.html/offline html/APK/README (one commit), delete the two v1.2.0 files (two commits), upload changed docs/tests files, verify Pages serves v1.3.0, create release v1.3.0 via web with ASCII-named asset (use `#releases-upload` CDP setFileInputFiles; remember names live in input values). Realign local main to origin. Append WORKING-DIARY entry.
