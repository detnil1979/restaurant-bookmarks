import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const threadsCsv = readFileSync(new URL('../data/threads_taipei_restaurants_2026-07-21.csv', import.meta.url), 'utf8');
const m = html.match(/\/\/ ==== \[passerby:pure:start\][\s\S]*?\/\/ ==== \[passerby:pure:end\]/);
assert.ok(m, 'marker block not found in index.html');

// 以 new Function 於同一 realm 執行標記區塊（node:vm 會產生跨 realm 的 Array，導致 deepEqual 誤判）
const { parseCsv, deriveRegion, buildMapsUrl, transformPassersby, transformThreads, isCommunitySource, categoryMatches, reservePasserbySlots, shortStar, groupByRegion, queryCategoryHit, QUERY_AMBIGUOUS, blogLinkFor, BLOG_LINKS, PASSERBY_SNAPSHOT, PASSERBY_SHEET, THREADS_SNAPSHOT, encodeSharePayload, decodeSharePayload, APP_VERSION, compareVersions } =
  new Function(m[0] + '\n;return { parseCsv, deriveRegion, buildMapsUrl, transformPassersby, transformThreads, isCommunitySource, categoryMatches, reservePasserbySlots, shortStar, groupByRegion, queryCategoryHit, QUERY_AMBIGUOUS, blogLinkFor, BLOG_LINKS, PASSERBY_SNAPSHOT, PASSERBY_SHEET, THREADS_SNAPSHOT, encodeSharePayload, decodeSharePayload, APP_VERSION, compareVersions };')();

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

t('share payload: round-trips Traditional Chinese notes and rejects invalid data', () => {
  const payload = { v: 1, id: 'tr-9', note: '純粹好吃，會再來！', photoUrl: 'https://example.com/food.jpg' };
  const encoded = encodeSharePayload(payload);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSharePayload(encoded), payload);
  assert.equal(decodeSharePayload('%%%'), null);
});

t('version comparison: detects newer, equal, and older releases', () => {
  assert.equal(APP_VERSION, '1.8.0');
  assert.equal(compareVersions('1.8.1', APP_VERSION), 1);
  assert.equal(compareVersions('1.8.0', APP_VERSION), 0);
  assert.equal(compareVersions('1.7.9', APP_VERSION), -1);
  assert.equal(compareVersions('2.0', '1.99.99'), 1);
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

t('transformThreads: full snapshot keeps source attribution', () => {
  const recs = transformThreads(THREADS_SNAPSHOT.rows);
  assert.equal(THREADS_SNAPSHOT.date, '2026-07-21');
  assert.equal(THREADS_SNAPSHOT.verified, 140);
  assert.equal(THREADS_SNAPSHOT.pending, 38);
  assert.equal(recs.length, 178);
  assert.equal(new Set(recs.map(r => r.id)).size, 178);
  assert.equal(new Set(recs.map(r => r.name)).size, 178);
  for (const r of recs) {
    assert.equal(r.source, 'threads');
    assert.deepEqual(r.lists, ['Threads推薦']);
    assert.ok(r.url.startsWith('https://www.google.com/maps/'));
    assert.ok(r.thread_url?.startsWith('https://www.threads.com/'));
    assert.ok(['已查證', '待確認'].includes(r.verification_status));
  }
  assert.equal(recs.filter(r => r.verification_status === '已查證').length, 140);
  assert.equal(recs.filter(r => r.verification_status === '待確認').length, 38);
  assert.equal(recs.filter(r => r.rating_source === 'google_live').length, 140);
  const byName = Object.fromEntries(recs.map(r => [r.name, r]));
  assert.equal(byName['26am 餐酒館'].region, '中山');
  assert.equal(byName['26am 餐酒館'].recommender, '26a.mrestaurant');
  assert.equal(byName['26am 餐酒館'].category, '日式料理');
  assert.equal(byName['26am 餐酒館'].rating, 5);
  assert.equal(byName['26am 餐酒館'].google_name.startsWith('26am 凌晨兩點'), true);
  assert.equal(byName['26am 餐酒館'].verification_status, '已查證');
  assert.equal(byName['7-ELEVEN i珍食'].verification_status, '待確認');
  assert.equal(byName['7-ELEVEN i珍食'].rating, null);
  assert.equal(byName['八條老宅麻辣鍋'].note, '老宅巷弄；麻辣湯頭、鴨血豆腐');
  assert.equal(byName['八條老宅麻辣鍋'].category, '火鍋/鍋物');
  assert.equal(byName['八條老宅麻辣鍋'].address, '104臺北市中山區正義里林森北路133巷3號');
});

t('Threads CSV: enriched schema matches embedded snapshot', () => {
  const rows = parseCsv(threadsCsv);
  assert.equal(rows.length, 179);
  assert.equal(rows[0].length, 19);
  assert.deepEqual(rows, THREADS_SNAPSHOT.rows.map(row => row.map(value => String(value))));
  assert.equal(rows.filter(r => r[17] === '已查證').length, 140);
  assert.equal(rows.filter(r => r[17] === '待確認').length, 38);
});

t('isCommunitySource: passerby and Threads are community sources', () => {
  assert.equal(isCommunitySource({ source: 'passerby' }), true);
  assert.equal(isCommunitySource({ source: 'threads' }), true);
  assert.equal(isCommunitySource({}), false);
});

t('categoryMatches: own exact + passerby keyword + no cats', () => {
  const KW = { '燒烤/鐵板燒': ['燒烤', '烤肉', '鐵板燒', 'bbq', '燒肉'] };
  assert.equal(categoryMatches({ category: '燒烤/鐵板燒' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'passerby', category: '燒肉' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'passerby', category: '板前燒肉' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'threads', category: '燒肉' }, ['燒烤/鐵板燒'], KW), true);
  assert.equal(categoryMatches({ source: 'passerby', category: '甜點(布丁)' }, ['燒烤/鐵板燒'], KW), false);
  assert.equal(categoryMatches({ source: 'passerby', category: null }, ['燒烤/鐵板燒'], KW), false);
  assert.equal(categoryMatches({ category: '燒烤/鐵板燒' }, [], KW), false);
});

t('reservePasserbySlots: buried passerby entries get up to 2 tail slots', () => {
  const own = Array.from({ length: 12 }, (_, i) => ({ d: { name: 'own' + i }, score: 12 - i }));
  const pb = [{ d: { name: 'pb1', source: 'passerby' }, score: 5 }, { d: { name: 'pb2', source: 'passerby' }, score: 4.5 }];
  const scored = own.concat(pb).sort((a, b) => b.score - a.score);
  const top = reservePasserbySlots(scored, 10, 2);
  assert.equal(top.length, 10);
  assert.deepEqual(top.slice(8).map(x => x.d.name), ['pb1', 'pb2']);
  assert.equal(top.filter(x => x.d.source === 'passerby').length, 2);
});

t('reservePasserbySlots: passerby already in top / absent → unchanged', () => {
  const inTop = [{ d: { name: 'pb', source: 'passerby' }, score: 9 }, { d: { name: 'o1' }, score: 8 }, { d: { name: 'o2' }, score: 7 }];
  assert.deepEqual(reservePasserbySlots(inTop, 10, 2), inTop);
  const noPb = Array.from({ length: 12 }, (_, i) => ({ d: { name: 'own' + i }, score: 12 - i }));
  assert.deepEqual(reservePasserbySlots(noPb, 10, 2), noPb.slice(0, 10));
});

t('reservePasserbySlots: Threads recommendations also receive community slots', () => {
  const own = Array.from({ length: 12 }, (_, i) => ({ d: { name: 'own' + i }, score: 12 - i }));
  const tr = [{ d: { name: 'tr1', source: 'threads' }, score: 5 }];
  const top = reservePasserbySlots(own.concat(tr).sort((a, b) => b.score - a.score), 10, 2);
  assert.ok(top.some(x => x.d.name === 'tr1'));
});

t('shortStar: rated and unrated', () => {
  assert.equal(shortStar({ rating: 4.86 }), '★ 4.9');
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

t('categoryMatches: 誤導詞不再造成錯誤配對,正確配對保留', () => {
  const KW = {
    '火鍋/鍋物': ['火鍋', '鍋', '麻辣', '涮涮鍋', '薑母鴨', '羊肉爐'],
    '泰越料理': ['泰式', '泰國', '越南', '河粉', '酸辣'],
    '義式/西式': ['義大利', 'pizza', '披薩', '牛排', '漢堡', '美式', '酒吧', '餐酒館'],
    '韓式料理': ['韓式', '韓國', '部隊鍋', '烤肉'],
    '燒烤/鐵板燒': ['燒烤', '烤肉', '鐵板燒', 'bbq', '燒肉'],
    '小吃/麵食': ['小吃', '麵', '牛肉麵', '便當', '平價'],
  };
  const pb = c => ({ source: 'passerby', category: c });
  assert.equal(categoryMatches(pb('小吃(鍋貼/綠豆湯)'), ['火鍋/鍋物'], KW), false);
  assert.equal(categoryMatches(pb('江浙菜(酸菜白肉鍋)'), ['火鍋/鍋物'], KW), true);
  assert.equal(categoryMatches(pb('酸辣粉'), ['泰越料理'], KW), false);
  assert.equal(categoryMatches(pb('川菜小吃(酸辣粉)'), ['小吃/麵食'], KW), true);
  assert.equal(categoryMatches(pb('日式漢堡排'), ['義式/西式'], KW), false);
  assert.equal(categoryMatches(pb('烤肉飯'), ['韓式料理'], KW), false);
  assert.equal(categoryMatches(pb('烤肉飯'), ['燒烤/鐵板燒'], KW), false);
  assert.equal(categoryMatches(pb('韓式烤肉'), ['韓式料理'], KW), true);
  assert.equal(categoryMatches(pb('麵包店'), ['小吃/麵食'], KW), false);
  assert.equal(categoryMatches(pb('刀削麵'), ['小吃/麵食'], KW), true);
});

t('queryCategoryHit: 查詢文字直接命中分類詞元', () => {
  const pb = c => ({ source: 'passerby', category: c });
  assert.equal(queryCategoryHit(pb('小吃(鍋貼/綠豆湯)'), '想吃鍋貼'), true);
  assert.equal(queryCategoryHit(pb('甜點(吉拿棒)'), '想吃吉拿棒'), true);
  assert.equal(queryCategoryHit(pb('日式漢堡排'), '想吃漢堡排'), true);
  assert.equal(queryCategoryHit(pb('日式漢堡排'), '想吃漢堡'), false);
  assert.equal(queryCategoryHit(pb('小吃(鍋貼/綠豆湯)'), '想吃火鍋'), false);
  assert.equal(queryCategoryHit({ category: '火鍋/鍋物' }, '想吃火鍋'), true);
  assert.equal(queryCategoryHit({ category: null, source: 'passerby' }, '想吃火鍋'), false);
});

t('QUERY_AMBIGUOUS: 新增的誤導詞在表內', () => {
  for (const w of ['鍋貼', '酸辣粉', '漢堡排', '烤肉飯', '麵包']) {
    assert.ok(QUERY_AMBIGUOUS.includes(w), w + ' missing');
  }
});

t('blogLinkFor: 命中愛食記 / 後備搜尋連結', () => {
  const links = { '鼎旺|大安': { url: 'https://ifoodie.tw/restaurant/559d8df2c03a103ee86c88a9' } };
  const hit = blogLinkFor({ name: '鼎旺', region: '大安' }, links);
  assert.deepEqual(hit, { kind: 'ifoodie', url: 'https://ifoodie.tw/restaurant/559d8df2c03a103ee86c88a9' });
  const fb = blogLinkFor({ name: '立秋 Li chiu', region: '大安', address: '台北市大安區辛亥路二段171巷9號1樓' }, links);
  assert.equal(fb.kind, 'search');
  assert.ok(fb.url.startsWith('https://www.google.com/search?q='));
  assert.ok(fb.url.includes(encodeURIComponent('食記')));
  assert.ok(fb.url.includes(encodeURIComponent('台北市大安區辛')));
  const noAddr = blogLinkFor({ name: '國秀', region: '未標示地區', address: null }, links);
  assert.equal(noAddr.kind, 'search');
  assert.equal(noAddr.url, 'https://www.google.com/search?q=' + encodeURIComponent('國秀 食記'));
});

t('BLOG_LINKS: 所有連結皆為愛食記店頁', () => {
  for (const [k, v] of Object.entries(BLOG_LINKS)) {
    assert.ok(v.url.startsWith('https://ifoodie.tw/restaurant/'), k);
  }
});

t('sheet constants present', () => {
  assert.equal(PASSERBY_SHEET.id, '1XqOiho7B5SauaFsfh-afi2faNkNXFJ9HV4tFkqrGkPY');
  assert.equal(PASSERBY_SHEET.gid, '1065289423');
});

console.log(`\n${n} tests passed`);
