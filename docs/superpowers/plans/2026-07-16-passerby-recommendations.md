# 路人推薦 Integration Implementation Plan (v1.2.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 84 restaurants from Google Sheet 「台北餐廳清單_補齊地址」 as a separate 路人推薦 group in 我的餐廳書籤資料庫, with live-fetch updates and baked snapshot fallback, shipped as v1.2.0 (Pages + offline HTML + APK).

**Architecture:** Everything stays in the single self-contained `index.html` (no deps, no build). New pure logic (CSV parse, transform, region derivation) lives between `// ==== [passerby:pure:start]` / `:end]` comment markers so a Node test harness can extract and unit-test it via `node:vm`. A `let PASSERBY` array (initialized from a baked raw-row snapshot) is concatenated with the existing `const DATA` through an `allData()` accessor; on load, an async fetch of the sheet's gviz CSV replaces `PASSERBY` when it succeeds (sheet is currently private → fetch 401s → snapshot is used; this is expected and correct).

**Tech Stack:** Vanilla JS in one HTML file; Node ≥18 (built-in `node:test`-free plain asserts + `node:vm`) for tests; `zip` + JDK `keytool`/`jarsigner` for the APK; `gh` CLI for push/release.

**Spec:** `docs/superpowers/specs/2026-07-16-passerby-recommendations-design.md`

**Repo:** `/Users/tedlin/CClaude/restaurant-bookmarks` (github: `detnil1979/restaurant-bookmarks`, branch `main`). ⚠️ Push access for the local `gh` account (Detnil) is being granted via collaborator invite — Task 7 checks for it and stops if absent. All earlier tasks commit locally only.

**Line anchors** below refer to the current `index.html` (376 lines, one giant `const DATA` literal on line 187). Anchor on the quoted code strings, not line numbers, when editing.

---

### Task 1: Pure logic + snapshot + unit tests

**Files:**
- Modify: `index.html` (insert marker block after the `const DATA = [...]` line, i.e. immediately before `function starStr(d) {`)
- Create: `tests/test-passerby.mjs`

- [ ] **Step 1: Verify node is available**

Run: `which node && node --version`
Expected: a path and `v18+`. If node is missing, STOP and report (do not improvise another runtime).

- [ ] **Step 2: Write the failing test**

Create `tests/test-passerby.mjs` with exactly:

```js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ ==== \[passerby:pure:start\][\s\S]*?\/\/ ==== \[passerby:pure:end\]/);
assert.ok(m, 'marker block not found in index.html');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[0], ctx);
const { parseCsv, deriveRegion, buildMapsUrl, transformPassersby, categoryMatches, PASSERBY_SNAPSHOT, PASSERBY_SHEET } = ctx;

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('parseCsv: plain rows', () => {
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
});

t('parseCsv: quoted commas, escaped quotes, embedded newline, CRLF', () => {
  assert.deepEqual(
    parseCsv('"x,y","he said ""hi""","l1\nl2"\r\np,q,r'),
    [['x,y', 'he said "hi"', 'l1\nl2'], ['p', 'q', 'r']]
  );
});

t('parseCsv: strips BOM', () => {
  assert.deepEqual(parseCsv('\uFEFF店名,類別\nA,B'), [['店名', '類別'], ['A', 'B']]);
});

t('deriveRegion: districts and fallbacks', () => {
  assert.equal(deriveRegion('台北市士林區劍潭路80號1樓'), '士林');
  assert.equal(deriveRegion('新北市三重區仁愛街16號1樓'), '三重');
  assert.equal(deriveRegion('臺北市大安區x'), '大安');
  assert.equal(deriveRegion('台北市某某路1號'), '台北');
  assert.equal(deriveRegion(null), '未標示地區');
});

t('buildMapsUrl: with and without address', () => {
  assert.equal(
    buildMapsUrl('Hi MATE', '台北市士林區劍潭路80號1樓'),
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Hi MATE 台北市士林區劍潭路80號1樓')
  );
  assert.equal(
    buildMapsUrl('國秀', null),
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('國秀')
  );
});

t('transformPassersby: full snapshot', () => {
  const recs = transformPassersby(PASSERBY_SNAPSHOT.rows);
  assert.equal(recs.length, 84);
  assert.equal(new Set(recs.map(r => r.id)).size, 84);
  for (const r of recs) {
    assert.equal(r.source, 'passerby');
    assert.deepEqual(r.lists, ['路人推薦']);
    assert.equal(r.rating, null);
    assert.ok(r.name.length > 0);
    assert.ok(r.url.startsWith('https://www.google.com/maps/search/?api=1&query='));
  }
  const byName = Object.fromEntries(recs.map(r => [r.name, r]));
  assert.equal(byName['Hi MATE'].region, '士林');
  assert.equal(byName['煙幕府'].region, '三重');
  assert.equal(byName['國秀'].address, null);
  assert.equal(byName['國秀'].region, '未標示地區');
  assert.equal(byName['Toasteria Cafe'].address, null);
  assert.equal(byName['麗芳老樓'].category, null);
  assert.equal(byName['八條老宅'].note, '查得同名店家實際為麻辣鍋/鴨血臭豆腐；與「臭豆腐」分類略有出入；建議確認');
  assert.ok(byName['M&CO']);
});

t('transformPassersby: skips header row and blank names', () => {
  const recs = transformPassersby([['店名', '類別', '地址', '備註'], ['', 'x', 'y'], ['真店', '麵食', '台北市大安區a路1號']]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].name, '真店');
});

t('categoryMatches: own exact + passerby keyword + no cats', () => {
  const KW = { '燒烤/鐵板燒': ['燒烤', '烤肉', '鐵板燒', 'bbq', '燒肉'] };
  assert.equal(categoryMatches({ category: '燒烤/鐵板燒' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'passerby', category: '燒肉' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'passerby', category: '板前燒肉' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'passerby', category: '甜點(布丁)' }, ['燒烤/鐵板燒'], KW), false);
  assert.equal(categoryMatches({ source: 'passerby', category: null }, ['燒烤/鐵板燒'], KW), false);
  assert.equal(categoryMatches({ category: '燒烤/鐵板燒' }, [], KW), false);
});

t('sheet constants present', () => {
  assert.equal(PASSERBY_SHEET.id, '1XqOiho7B5SauaFsfh-afi2faNkNXFJ9HV4tFkqrGkPY');
  assert.equal(PASSERBY_SHEET.gid, '1065289423');
});

console.log(`\n${n} tests passed`);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/tedlin/CClaude/restaurant-bookmarks && node tests/test-passerby.mjs`
Expected: FAIL with `marker block not found in index.html`

- [ ] **Step 4: Insert the marker block into index.html**

Using the Edit tool, find the unique anchor string `\nfunction starStr(d) {` and insert the following block **before** it (i.e. replace `\nfunction starStr(d) {` with the block below followed by `\nfunction starStr(d) {`):

```js
// ==== [passerby:pure:start] 路人推薦 純函式與快照（tests/test-passerby.mjs 會抽取此區塊執行，勿在此使用 DOM/DATA）====
const PASSERBY_SHEET = {
  id: '1XqOiho7B5SauaFsfh-afi2faNkNXFJ9HV4tFkqrGkPY',
  gid: '1065289423',
};

const PASSERBY_SNAPSHOT = {
  date: '2026-07-16',
  rows: [
    ["Hi MATE","澳式早午餐","台北市士林區劍潭路80號1樓"],
    ["富馨園","江浙菜(酸菜白肉鍋)","台北市大安區復興南路一段269號"],
    ["煙幕府","日式炸豬排/拉麵","新北市三重區仁愛街16號1樓"],
    ["立秋 Li chiu","燒肉","台北市大安區辛亥路二段171巷9號1樓"],
    ["威美早餐店","早餐店","台北市信義區莊敬路377號"],
    ["八條老宅","臭豆腐","台北市中山區林森北路133巷3號","查得同名店家實際為麻辣鍋/鴨血臭豆腐","與「臭豆腐」分類略有出入","建議確認"],
    ["鼎旺","小吃(雞爪鴨血)","台北市大安區大安路一段251號1樓(一店)","另有二店 大安路一段229號"],
    ["東引快刀手","牛肉麵","台北市松山區光復南路54號(光復店)","連鎖多分店","無法確認實際造訪分店"],
    ["老麵攤","麵食(船麵)","台北市中山區四平街21號","推測為Kanokwan老麵攤(泰式船麵)"],
    ["On the road","冰淇淋","台北市士林區忠誠路二段136號"],
    ["鑫吉野","烤肉飯","台北市信義區吳興街269巷11號1樓(信義吳興店)","連鎖多分店","無法確認實際造訪分店"],
    ["南方漁場","丼飯","台北市信義區松信路208號"],
    ["奎士咖啡","咖啡廳","台北市信義區忠孝東路四段563號1樓(市府旗艦店)","另有專櫃分店"],
    ["吳一無二","甜點(聖多諾黑)","台北市大安區安和路二段184巷6號","已遷址","原址為信義區忠孝東路四段553巷"],
    ["Churros吉那圈","甜點(吉拿棒)","台北市大安區光復南路260巷24號(近國父紀念館站)","另有信義店 松壽路11號A11"],
    ["頂好紫琳","小吃(鍋貼/綠豆湯)","台北市大安區忠孝東路四段97號B1樓"],
    ["小螺波","螺螄粉","台北市萬華區西寧南路105號1F(西門店)","連鎖多分店","無法確認實際造訪分店"],
    ["味鼎早餐","早餐店","台北市中山區龍江路21巷3號(龍江店)","另有分店"],
    ["柑橘shinn拉麵","日式拉麵","台北市大安區仁愛路四段228-6號(本店)","另有二店/三店"],
    ["Marcoc馬路口","麵包店","台北市大安區建國南路二段27號"],
    ["阜杭豆漿","早餐(燒餅豆漿)","台北市中正區忠孝東路一段108號(華山市場2樓)"],
    ["欣葉台菜","台菜","台北市中山區雙城街34-1號(創始店)","連鎖多分店"],
    ["先進海產店","海產熱炒","台北市松山區延吉街23巷5號"],
    ["象廚泰式料理","泰式料理","台北市信義區基隆路一段147巷9號"],
    ["金宴火爐","韓式烤肉","台北市大安區忠孝東路四段170巷6弄5號","信心中等","來源為公司登記地址"],
    ["雞の兄弟","鹹酥雞","台北市文山區興德路18號(興德市場內)","另有瑞億市場分店(廣明街41巷2弄1號)"],
    ["Asylum","滷肉飯/義大利麵","台北市大安區復興南路一段219巷10號"],
    ["麗芳老樓","未提供","台北市中山區雙城街18巷15號"],
    ["金奇","日式漢堡排","台北市中山區林森北路85巷43號"],
    ["鮨天本","日式壽司","台北市大安區仁愛路四段371號(本店)","另有登龍門分店 忠孝東路四段216巷27弄16號"],
    ["嗜鼎","酸辣粉","台北市萬華區成都路27巷23號","另有永康店 大安區永康街6巷9號"],
    ["野菜家","日式居酒屋","台北市中山區林森北路119巷74號"],
    ["美川壽司","日式壽司","台北市內湖區內湖路一段411巷9弄15號"],
    ["Pasta&Co","義大利麵","台北市中山區南京東路三段9號"],
    ["旨丼生魚片丼飯專賣店","日本料理(丼飯)","台北市中山區中山北路二段59巷54號","查證結果實際位於中山北路二段/雙連站附近","與原提示行天宮不符"],
    ["Peppa","蔬食/海鮮","台北市松山區興安街218號"],
    ["麒麟拉麵 Qilin Ramen","日式拉麵","台北市中山區中山北路一段140巷25號"],
    ["臨江夜市雞翅攤","鹹酥雞/雞翅","台北市大安區臨江街92號(攤位「再來一翅」)"],
    ["和牛47","三明治","台北市信義區松仁路100號47樓(微風南山47樓)"],
    ["內湖錢嫂小吃","小吃(雞絲板條)","台北市內湖區成功路二段115巷49弄10號"],
    ["梁記北平良田刀削麵","刀削麵","台北市內湖區江南街14號"],
    ["阿田麵","麵食","新北市三重區光興街34號"],
    ["三色布丁","甜點(布丁)","新北市三重區集美街161號"],
    ["三光紅麵","麵食","新北市三重區環河南路221巷29號","隱身巷弄無明顯招牌"],
    ["介合口筒仔米糕","筒仔米糕","新北市三重區環河南路221巷19號","原提示「大橋頭」與查證結果不符","實際位於三重集美街周邊"],
    ["麻辣純萃養生鴨血臭豆腐","小吃(鴨血臭豆腐)","新北市蘆洲區成功路207號","信心中等","店名未逐字確認"],
    ["天香","小吃(麻辣鴨血)","新北市三重區忠孝路一段30巷58號","信心中等","勿與「雅口天香臭豆腐」(中央北路69號)混淆"],
    ["義大利米蘭手工窯烤披薩","披薩","台北市中山區四平街55號2樓"],
    ["papa Kevin's","西式餐廳","台北市松山區南京東路三段303巷8弄5號","已遷址","原址為中山區民生東路二段115巷6號"],
    ["布雍家","未提供","台北市信義區忠孝東路五段71巷32弄2號1樓","法式小館Bouillon布雍家"],
    ["國秀","餐酒館","查無資料","店名過於常見","搜尋僅找到高雄同名店家","建議另行確認"],
    ["美福乾式牛排","乾式牛排館","台北市內湖區民善街128號2F","近內湖Costco"],
    ["AD Astra","Fine Dining","台北市中山區中山北路二段45巷23號","近晶華酒店"],
    ["M&CO","Fine Dining","台北市松山區民生東路三段127巷6號","約2026年6月已歇業","是否保留請自行判斷"],
    ["nabo ulv","Fine Dining","台北市大安區敦化南路一段160巷18號"],
    ["鮨緣","板前壽司","台北市內湖區康寧路一段48巷10號"],
    ["利休","板前壽司","台北市大安區敦化南路二段144號1樓","近六張犁站","亦提供涮涮鍋"],
    ["鮨洵","板前壽司","台北市中山區林森北路353巷7號1樓"],
    ["鮨香","板前壽司","台北市中山區林森北路458巷10號"],
    ["綾壽司","板前壽司","台北市大安區大安路一段192號","信心度低","查證時與另一店家地址疑似重疊","建議查證"],
    ["鈉","鐵板燒","台北市大安區敦化南路二段146巷1號"],
    ["酉志","串燒(板前燒鳥)","台北市大安區愛國東路99號1樓","已遷址","原址為中山區中山北路一段135巷33-2號"],
    ["燒鳥すみか","串燒(板前燒鳥)","台北市大安區敦化南路一段161巷31號"],
    ["八和","板前燒肉","台北市大安區安和路一段102巷4號(安和本店)","另有敦北二店"],
    ["牛花","板前燒肉","台北市松山區復興北路313巷23號1樓"],
    ["樂軒松板亭","壽喜燒","台北市信義區松高路19號6樓(新光三越A4)"],
    ["208","叉燒/燒臘","查無資料","搜尋僅找到公館「鳳城燒臘」與信義區「貳零捌」私廚","均與描述不完全吻合","建議確認"],
    ["晶華軒","港式點心","台北市中山區中山北路二段39巷3號3樓(晶華酒店內)"],
    ["Lora Cake","甜點(巴斯克蛋糕)","台北市松山區敦化北路155巷6號"],
    ["西湖水產","海鮮丼飯","台北市信義區松山路465巷25弄2號"],
    ["五之神","日式沾麵(蝦沾麵)","台北市信義區忠孝東路四段553巷6弄6號"],
    ["雞湯人生","雞湯麵","台北市大安區大安路一段51巷10號"],
    ["九月茶餐廳","港式茶餐廳","台北市大同區承德路二段213號"],
    ["青沐","義大利麵","台北市大安區大安路一段52巷25號(大安店)","連鎖多分店","無法確認實際造訪分店"],
    ["川渝小吃坊","川菜小吃(酸辣粉)","台北市大同區南京西路18巷6弄8之1號","另有中正店 南陽街15之7號"],
    ["大邱大叔","韓式料理","台北市士林區忠誠路一段91號(天母主店)","另有北投店 育仁路56號"],
    ["通庵咖喱","咖哩料理","台北市大安區通安街115號(本店)","另有中山店、南京店"],
    ["Lay back","美式餐廳(漢堡/義大利麵)","台北市大安區通安街7號1樓"],
    ["想","下午茶(鬆餅)","台北市士林區國泰街10號","即「想 陽明山」"],
    ["Toasteria Cafe","西式輕食(多士)","連鎖店(未提供特定地址)"],
    ["發肉","燒肉","台北市大安區大安路一段51巷17號","信心中等","另有「發肉燒肉餐酒」品牌(敦北/忠孝分店)","請確認是否同一店家"],
    ["醉好Another Round","餐酒館","台北市大安區大安路一段19巷13號1F"],
    ["粥起","粥底火鍋熱炒","台北市大安區東豐街65號1樓"],
    ["如嫦","港式雞煲(卜卜蜆)","台北市中山區民權東路三段60巷11號1樓"]
  ],
};

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function deriveRegion(address) {
  if (!address) return '未標示地區';
  const m = address.match(/(台北|臺北|新北)市([^市區]{1,3})區/);
  if (m) return m[2];
  if (/(台北|臺北)市/.test(address)) return '台北';
  if (/新北市/.test(address)) return '新北';
  return '未標示地區';
}

function buildMapsUrl(name, address) {
  const q = address ? name + ' ' + address : name;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

const PASSERBY_NO_ADDRESS = /^(未提供|查無資料)|未提供特定地址/;

function transformPassersby(rows) {
  return rows
    .filter(r => r && r[0] && r[0].trim() && r[0].trim() !== '店名')
    .map((r, i) => {
      const name = r[0].trim();
      const rawCat = (r[1] || '').trim();
      const rawAddr = (r[2] || '').trim();
      const address = rawAddr && !PASSERBY_NO_ADDRESS.test(rawAddr) ? rawAddr : null;
      const notes = r.slice(3).map(s => (s || '').trim()).filter(Boolean);
      return {
        id: 'pr-' + (i + 1),
        source: 'passerby',
        name,
        category: rawCat && rawCat !== '未提供' ? rawCat : null,
        address,
        region: deriveRegion(address),
        note: notes.length ? notes.join('；') : null,
        url: buildMapsUrl(name, address),
        lists: ['路人推薦'],
        rating: null,
        rating_source: null,
        review_count: null,
        review_text: null,
        price_range: null,
        google_category: null,
        has_review: false,
      };
    });
}

function categoryMatches(d, matchedCats, keywordMap) {
  if (!matchedCats.length) return false;
  if (matchedCats.includes(d.category)) return true;
  if (d.source !== 'passerby' || !d.category) return false;
  const cat = d.category.toLowerCase();
  return matchedCats.some(mc => (keywordMap[mc] || []).some(k => cat.includes(k.toLowerCase())));
}
// ==== [passerby:pure:end] ====
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/test-passerby.mjs`
Expected: `ok -` lines for every test, ending `9 tests passed`

- [ ] **Step 6: Commit**

```bash
git add index.html tests/test-passerby.mjs
git commit -m "feat: 路人推薦 pure logic + snapshot data + tests"
```

---

### Task 2: Wire 路人推薦 into stats, filters, browse, and recommender

**Files:**
- Modify: `index.html` (JS functions `groupsOf`, `renderStats`, `populateFilters`, `cardHtml`, `renderGrid`, `recommend`; CSS badge rules)

All edits use the Edit tool with the exact quoted strings as anchors (each is unique in the file).

- [ ] **Step 1: Add runtime state after the marker block**

Replace:
```js
// ==== [passerby:pure:end] ====
```
with:
```js
// ==== [passerby:pure:end] ====

let PASSERBY = transformPassersby(PASSERBY_SNAPSHOT.rows);
let passerbySourceLabel = '內建快照（更新於 ' + PASSERBY_SNAPSHOT.date + '）';
function allData() { return DATA.concat(PASSERBY); }
```

- [ ] **Step 2: Extend groupsOf**

Replace:
```js
  if (d.lists.includes('這裡很無聊')) g.push('這裡很無聊');
  return g;
```
with:
```js
  if (d.lists.includes('這裡很無聊')) g.push('這裡很無聊');
  if (d.lists.includes('路人推薦')) g.push('路人推薦');
  return g;
```

- [ ] **Step 3: Add the 路人推薦 stat chip**

In `renderStats()`, replace:
```js
    <div class="stat"><b>${total}</b>間餐廳書籤</div>
    ${gStats}
```
with:
```js
    <div class="stat"><b>${total}</b>間餐廳書籤</div>
    ${gStats}
    <div class="stat passerby-stat"><b>${PASSERBY.length}</b>路人推薦</div>
```
(Own-data stats — 已標示地區 / Google 即時評分 — intentionally stay computed over `DATA` only.)

- [ ] **Step 4: Make populateFilters idempotent and passerby-aware**

Replace the entire function:
```js
function populateFilters() {
  const cats = ['吃到飽', '老饕', '這裡很無聊'];
  const regions = [...new Set(DATA.map(d => d.region))].sort();
  const fc = document.getElementById('fCategory');
  cats.forEach(c => fc.innerHTML += `<option value="${c}">${c}</option>`);
  const fr = document.getElementById('fRegion');
  regions.forEach(r => fr.innerHTML += `<option value="${r}">${r}</option>`);
}
```
with:
```js
function populateFilters() {
  const cats = ['吃到飽', '老饕', '這裡很無聊', '路人推薦'];
  const regions = [...new Set(allData().map(d => d.region))].sort();
  const fc = document.getElementById('fCategory');
  const fr = document.getElementById('fRegion');
  const keepCat = fc.value, keepRegion = fr.value;
  fc.innerHTML = '<option value="">全部種類</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  fr.innerHTML = '<option value="">全部地區</option>' + regions.map(r => `<option value="${r}">${r}</option>`).join('');
  fc.value = keepCat;
  fr.value = keepRegion;
}
```
(Idempotent because live fetch re-calls it; assigning a vanished value falls back to `""` = 全部.)

- [ ] **Step 5: Badge + note label in cardHtml**

Replace:
```js
  const note = d.note ? `<div class="review-text">筆記：${d.note}</div>` : '';
```
with:
```js
  const note = d.note ? `<div class="review-text">${d.source === 'passerby' ? '備註' : '筆記'}：${d.note}</div>` : '';
```
Then replace:
```js
        ${groupsOf(d).map(g => `<span class="badge cat">${g}</span>`).join('')}
```
with:
```js
        ${groupsOf(d).map(g => `<span class="badge ${g === '路人推薦' ? 'passerby' : 'cat'}">${g}</span>`).join('')}
```

- [ ] **Step 6: Browse over the combined dataset**

In `renderGrid()`, replace:
```js
  let rows = DATA.filter(d => {
```
with:
```js
  let rows = allData().filter(d => {
```

- [ ] **Step 7: Recommender over the combined dataset with keyword category matching**

Replace:
```js
  const regions = [...new Set(DATA.map(d => d.region))];
```
with:
```js
  const regions = [...new Set(allData().map(d => d.region))];
```
Replace:
```js
  const scored = DATA.map(d => {
    let score = 0;
    let reasons = [];
    if (matchedCats.includes(d.category)) { score += 5; reasons.push('符合種類：' + d.category); }
```
with:
```js
  const scored = allData().map(d => {
    let score = 0;
    let reasons = [];
    if (categoryMatches(d, matchedCats, NEED_KEYWORDS)) { score += 5; reasons.push('符合種類：' + (d.category || '路人推薦')); }
```
Replace the rec-card meta/review lines:
```js
        <div class="rmeta">${d.category}・${d.region}・${starStr(d)}</div>
        ${d.review_text ? `<div class="review-text">「${d.review_text}」</div>` : ''}
```
with:
```js
        <div class="rmeta">${d.source === 'passerby' ? '<span class="badge passerby">路人推薦</span>　' : ''}${d.category || '未分類'}・${d.region}・${starStr(d)}</div>
        ${d.review_text ? `<div class="review-text">「${d.review_text}」</div>` : ''}
        ${d.source === 'passerby' && d.note ? `<div class="review-text">備註：${d.note}</div>` : ''}
```

- [ ] **Step 8: Badge CSS**

Replace:
```css
  .badge.region { background: rgba(77,171,247,.12); color: var(--accent2); border-color: rgba(77,171,247,.3); }
```
with:
```css
  .badge.region { background: rgba(77,171,247,.12); color: var(--accent2); border-color: rgba(77,171,247,.3); }
  .badge.passerby { background: rgba(177,151,252,.14); color: #b197fc; border-color: rgba(177,151,252,.35); }
  .stat.passerby-stat b { color: #b197fc; }
```

- [ ] **Step 9: Tests still green + JS syntax check**

Run: `node tests/test-passerby.mjs && node -e "
const html = require('fs').readFileSync('index.html','utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
new Function(js.replace(/document\./g, 'noDom.')); // parse-only via Function constructor would still execute nothing
console.log('script block parses');
"`
Expected: `9 tests passed` then `script block parses`. (The `new Function` call only *parses* — it never invokes — so DOM access is irrelevant; the replace is belt-and-suspenders.)

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat: 路人推薦 group in stats/filters/browse/recommender with distinct badge"
```

---

### Task 3: Live fetch with snapshot fallback + source line

**Files:**
- Modify: `index.html` (methodology list item, `loadPassersby()`, init call)

- [ ] **Step 1: Add the source line to the methodology list**

Replace:
```html
      <li>國家別：本次資料幾乎全數為台灣地點，故不另外呈現國家篩選。</li>
```
with:
```html
      <li>國家別：本次資料幾乎全數為台灣地點，故不另外呈現國家篩選。</li>
      <li>「路人推薦」為另外收集的口袋名單（Google 試算表），與個人書籤分開標示；其地址與備註為自動查證結果，僅供參考。</li>
      <li id="passerbySource">路人推薦資料來源：內建快照。</li>
```

- [ ] **Step 2: Add loadPassersby and call it at init**

Replace:
```js
renderStats();
populateFilters();
renderGrid();
setupChips();
```
with:
```js
async function loadPassersby() {
  const url = 'https://docs.google.com/spreadsheets/d/' + PASSERBY_SHEET.id + '/gviz/tq?tqx=out:csv&gid=' + PASSERBY_SHEET.gid;
  try {
    const opts = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? { signal: AbortSignal.timeout(8000) } : {};
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const records = transformPassersby(parseCsv(await res.text()));
    if (!records.length) throw new Error('no data rows');
    PASSERBY = records;
    passerbySourceLabel = '即時（Google 試算表）';
    renderStats();
    populateFilters();
    renderGrid();
  } catch (e) {
    // 試算表未開放連結檢視（HTTP 401）、離線或資料異常時，沿用內建快照。
  }
  const srcEl = document.getElementById('passerbySource');
  if (srcEl) srcEl.textContent = '路人推薦資料來源：' + passerbySourceLabel + '，共 ' + PASSERBY.length + ' 筆。';
}

renderStats();
populateFilters();
renderGrid();
setupChips();
loadPassersby();
```

- [ ] **Step 3: Tests still green**

Run: `node tests/test-passerby.mjs`
Expected: `9 tests passed`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: live-fetch 路人推薦 from Google Sheet with snapshot fallback"
```

---

### Task 4: Browser verification

**Files:**
- Create: `/Users/tedlin/CClaude/.claude/launch.json` (if absent)

- [ ] **Step 1: Launch config + server**

Write `/Users/tedlin/CClaude/.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "restaurant-bookmarks",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8123", "--directory", "restaurant-bookmarks"],
      "port": 8123
    }
  ]
}
```
Start it with the preview tool (`preview_start` name=`restaurant-bookmarks`), open `http://localhost:8123/`.

- [ ] **Step 2: Verify, in order** (read_page / form_input / read_console_messages)

1. Stats row contains a chip `84 路人推薦`.
2. 種類 select has option 路人推薦; choosing it → result count `84 筆結果`; cards show violet 路人推薦 badge; 國秀 card shows 備註 text and 尚無評分資料.
3. 依需求推薦: enter `想吃燒肉` → results include at least one violet-badged 路人推薦 entry (e.g. 立秋 Li chiu / 發肉 / 八和) alongside own bookmarks.
4. Methodology details: source line reads `路人推薦資料來源：內建快照（更新於 2026-07-16），共 84 筆。` (the live fetch 401s while the sheet is private — fallback path is thereby exercised for real).
5. Console: no uncaught errors (the fetch failure must be swallowed by the catch; a plain network-level log line from the browser itself is acceptable).
6. Screenshot the browse tab filtered to 路人推薦 as proof.

- [ ] **Step 3: Fix-and-repeat**

Any failure: diagnose in source, fix, re-run from Step 2. Commit fixes as `fix: <what>`.

---

### Task 5: Version bump, offline copy, README

**Files:**
- Modify: `index.html`, `README.md`
- Create: `我的餐廳書籤資料庫-v1.2.0.html` · Delete: `我的餐廳書籤資料庫-v1.1.0.html`

- [ ] **Step 1: Bump version strings in index.html**

Replace:
```html
  <p class="sub">從 Google Maps 已儲存清單匯出並自動篩選出的餐廳類地點，依種類 / 地區 / 星等整理・<b style="color:var(--accent)">v1.1.0</b></p>
```
with:
```html
  <p class="sub">從 Google Maps 已儲存清單匯出並自動篩選出的餐廳類地點，依種類 / 地區 / 星等整理，並附路人推薦口袋名單・<b style="color:var(--accent)">v1.2.0</b></p>
```
Replace:
```html
<footer>由 Claude 依你的 Google Maps 書籤自動整理・僅供個人參考・v1.1.0</footer>
```
with:
```html
<footer>由 Claude 依你的 Google Maps 書籤自動整理・僅供個人參考・v1.2.0</footer>
```

- [ ] **Step 2: Regenerate offline copy**

```bash
cp index.html 我的餐廳書籤資料庫-v1.2.0.html
git rm 我的餐廳書籤資料庫-v1.1.0.html
```

- [ ] **Step 3: Update README.md**

- Change **every** `v1.1.0` occurrence to `v1.2.0`: the 檔案說明 table (HTML + APK filenames/links) **and** the APK download link in the 安裝步驟 section (`/raw/main/我的餐廳書籤-v1.1.0.apk`). Verify with `grep -c 'v1\.1\.0' README.md` → only the historical 版本 table row may remain.
- In the 功能 section add: `- **路人推薦**:另外收集的口袋名單(Google 試算表),以紫色「路人推薦」標籤與個人書籤分開;瀏覽頁可用種類「路人推薦」單獨篩選,依需求推薦也會一併比對`
- Add section before 版本:
```markdown
## 路人推薦資料更新

路人推薦清單來自 Google 試算表「台北餐廳清單_補齊地址」。App 每次開啟會嘗試讀取試算表最新內容,讀不到時使用內建快照(2026-07-16)。

要啟用「編輯試算表 → App 自動更新」:把該試算表的共用設定改為「知道連結的使用者皆可檢視」即可,無需改程式。試算表保持私人時,App 仍可正常使用內建快照。
```
- In the 版本 table add a `v1.2.0` row: `新增路人推薦口袋名單(84 間,含即時試算表更新與內建快照);APK 因重新簽章,更新前需先解除安裝 v1.1.0`

- [ ] **Step 4: Tests + commit**

```bash
node tests/test-passerby.mjs
git add -A
git commit -m "chore: v1.2.0 版本標示、離線檔與 README"
```

---

### Task 6: Rebuild the APK

**Files:**
- Create: `我的餐廳書籤-v1.2.0.apk` · Delete: `我的餐廳書籤-v1.1.0.apk`
- Create (outside repo, never committed): `/Users/tedlin/CClaude/restaurant-bookmarks-signing/{restaurant.keystore,keystore.pass}`

- [ ] **Step 1: Tooling check**

Run: `which zip jarsigner keytool`
If `jarsigner` or `keytool` is missing: SKIP this task, keep `我的餐廳書籤-v1.1.0.apk` in place, note "APK follow-up: needs a JDK" in the final report and WORKING-DIARY, and continue with Task 7.

- [ ] **Step 2: One-time keystore (outside the repo — never git add)**

```bash
mkdir -p /Users/tedlin/CClaude/restaurant-bookmarks-signing
cd /Users/tedlin/CClaude/restaurant-bookmarks-signing
[ -f keystore.pass ] || (openssl rand -hex 16 > keystore.pass)
[ -f restaurant.keystore ] || keytool -genkeypair -keystore restaurant.keystore -alias restaurant \
  -keyalg RSA -keysize 2048 -validity 10000 -storepass "$(cat keystore.pass)" \
  -dname "CN=Restaurant Bookmarks"
```

- [ ] **Step 3: Swap the HTML, strip old signature, re-sign**

```bash
cd /Users/tedlin/CClaude/restaurant-bookmarks
WORK=$(mktemp -d); mkdir -p "$WORK/assets"
cp 我的餐廳書籤-v1.1.0.apk "$WORK/我的餐廳書籤-v1.2.0.apk"
cp index.html "$WORK/assets/index.html"
cd "$WORK"
zip 我的餐廳書籤-v1.2.0.apk assets/index.html
zip -d 我的餐廳書籤-v1.2.0.apk 'META-INF/*'
jarsigner -keystore /Users/tedlin/CClaude/restaurant-bookmarks-signing/restaurant.keystore \
  -storepass "$(cat /Users/tedlin/CClaude/restaurant-bookmarks-signing/keystore.pass)" \
  -sigalg SHA256withRSA -digestalg SHA-256 我的餐廳書籤-v1.2.0.apk restaurant
jarsigner -verify 我的餐廳書籤-v1.2.0.apk
```
Expected: `jar verified.` (warnings about self-signed certs are normal).

- [ ] **Step 4: Sanity-check the new APK contents**

Run: `unzip -l 我的餐廳書籤-v1.2.0.apk`
Expected: same entries as v1.1.0 (AndroidManifest.xml, assets/index.html at the NEW size, res/*, resources.arsc, classes.dex) plus fresh META-INF files.

- [ ] **Step 5: Move into repo + commit**

```bash
cp "$WORK/我的餐廳書籤-v1.2.0.apk" /Users/tedlin/CClaude/restaurant-bookmarks/
cd /Users/tedlin/CClaude/restaurant-bookmarks
git rm 我的餐廳書籤-v1.1.0.apk
git add 我的餐廳書籤-v1.2.0.apk
git commit -m "feat: APK v1.2.0(重新簽章,需先解除安裝舊版)"
rm -rf "$WORK"
```
Also update the two APK links/filenames in README.md from v1.1.0 to v1.2.0 if Step 1 of Task 5 didn't already (it should have); if a change is needed: `git add README.md && git commit --amend --no-edit`.

---

### Task 7: Push, Pages check, release, diary

- [ ] **Step 1: Confirm push access**

Run: `gh api repos/detnil1979/restaurant-bookmarks --jq '.permissions.push'`
Expected: `true`. If `false`, STOP — report that the collaborator invite (detnil1979 → Detnil) hasn't been accepted yet; do not attempt workarounds.

- [ ] **Step 2: Push**

```bash
cd /Users/tedlin/CClaude/restaurant-bookmarks
git push origin main
```

- [ ] **Step 3: Verify GitHub Pages serves v1.2.0**

Run (Pages can take 1–3 min; retry up to 5×/30s):
`curl -s https://detnil1979.github.io/restaurant-bookmarks/ | grep -o 'v1\.2\.0' | head -1`
Expected: `v1.2.0`

- [ ] **Step 4: Tag + release (matches the v1.1.0 pattern)**

```bash
git tag v1.2.0 && git push origin v1.2.0
gh release create v1.2.0 --repo detnil1979/restaurant-bookmarks \
  --title "v1.2.0 路人推薦" \
  --notes "新增「路人推薦」口袋名單(84 間,來自 Google 試算表,支援即時更新與內建快照)。瀏覽/推薦皆以紫色標籤與個人書籤分開。APK 重新簽章:請先解除安裝 v1.1.0 再安裝。" \
  我的餐廳書籤-v1.2.0.apk
```
(Omit the APK asset argument if Task 6 was skipped.)

- [ ] **Step 5: Working diary**

Append the newest-on-top entry to `/Users/tedlin/CClaude/WORKING-DIARY.md` (create the file if missing) covering: what shipped (v1.2.0 路人推薦), key decisions (live fetch + snapshot; separate badge/filter; APK re-signed), current state (Pages live; sheet still private → snapshot mode), outstanding (user flips sheet sharing to enable live updates; phones must uninstall old APK).

---

## Self-review notes (done at plan time)

- **Spec coverage:** mapping table → Task 1 `transformPassersby`; UI separation → Task 2; live fetch/fallback/source line → Task 3; version/README/offline copy → Task 5; APK + keystore rules → Task 6; Pages verify + release → Task 7; testing items 1–4 of the spec → Tasks 1, 4, 7. The spec's "84 rows" supersedes the earlier "80" (the sheet gained rows after the local CSV export; sheet is source of truth).
- **Types:** `PASSERBY` (let, records), `PASSERBY_SNAPSHOT.rows` (raw string arrays), `allData()` (concat, no mutation), `categoryMatches(d, matchedCats, keywordMap)` — names used consistently across Tasks 1–3.
- **Known accepted risks:** re-zipped APK is not zipaligned (acceptable for this low-target WebView app; original installs with a v1 JAR signature); recommender treats passerby category free-text via keyword containment, which may under-match unusual categories (e.g. 未提供) — those entries remain reachable via browse.
