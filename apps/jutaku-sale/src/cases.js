/* ============================================================
   近隣の取引事例。

   数字を1つ出して「これです」と言うより、実際にあった取引を何件か並べて
   自分の物件に近いものを選ばせるほうが、当たりの付け方として素直で、
   外したときも「どれを選んだからこうなった」が自分で分かる。

   データは国土交通省「不動産情報ライブラリ」から、ビルド時に取って同梱する
   （scripts/fetch-cases.mjs）。実行時に国交省へ問い合わせることはしない。
   画面は data/index.json を見て、収録済みの都道府県の JSON だけを読む。
   ============================================================ */

export const PREFECTURES = [
  ["01", "北海道"], ["02", "青森県"], ["03", "岩手県"], ["04", "宮城県"], ["05", "秋田県"],
  ["06", "山形県"], ["07", "福島県"], ["08", "茨城県"], ["09", "栃木県"], ["10", "群馬県"],
  ["11", "埼玉県"], ["12", "千葉県"], ["13", "東京都"], ["14", "神奈川県"], ["15", "新潟県"],
  ["16", "富山県"], ["17", "石川県"], ["18", "福井県"], ["19", "山梨県"], ["20", "長野県"],
  ["21", "岐阜県"], ["22", "静岡県"], ["23", "愛知県"], ["24", "三重県"], ["25", "滋賀県"],
  ["26", "京都府"], ["27", "大阪府"], ["28", "兵庫県"], ["29", "奈良県"], ["30", "和歌山県"],
  ["31", "鳥取県"], ["32", "島根県"], ["33", "岡山県"], ["34", "広島県"], ["35", "山口県"],
  ["36", "徳島県"], ["37", "香川県"], ["38", "愛媛県"], ["39", "高知県"], ["40", "福岡県"],
  ["41", "佐賀県"], ["42", "長崎県"], ["43", "熊本県"], ["44", "大分県"], ["45", "宮崎県"],
  ["46", "鹿児島県"], ["47", "沖縄県"],
].map(([code, name]) => ({ code, name }));

export const KINDS = [
  { id: "mansion", label: "中古マンション" },
  { id: "house", label: "戸建" },
  { id: "land", label: "土地" },
];

/**
 * 政令指定都市。国交省の事例は市の親コード（札幌市 01100 など）では 404 になり、
 * 区コードにだけ入っている。親が落ちるので、区だけ見ると「どの市の区か」が分からない。
 * 標準地域コード順に並べてあり、同じ県の複数市（横浜／川崎／相模原、大阪／堺）は
 * 「その区コードより小さく最も近い親」で切り分ける。
 */
const DESIGNATED_CITIES = [
  ["01100", "札幌市"],
  ["04100", "仙台市"],
  ["11100", "さいたま市"],
  ["12100", "千葉市"],
  ["14100", "横浜市"],
  ["14130", "川崎市"],
  ["14150", "相模原市"],
  ["15100", "新潟市"],
  ["22100", "静岡市"],
  ["22130", "浜松市"],
  ["23100", "名古屋市"],
  ["26100", "京都市"],
  ["27100", "大阪市"],
  ["27140", "堺市"],
  ["28100", "神戸市"],
  ["33100", "岡山市"],
  ["34100", "広島市"],
  ["40100", "北九州市"],
  ["40130", "福岡市"],
  ["43100", "熊本市"],
];

/**
 * 区名がどの政令市に属するかを返す。東京23区や通常の市は null。
 * 名前が「区」で終わらないものは、コードが親の後ろにあっても付けない
 * （堺市の後ろの豊中市を堺市扱いにしないため）。
 */
export function designatedCityOf(code, name = "") {
  const raw = String(name ?? "");
  if (!raw.endsWith("区")) return null;
  const n = String(code ?? "").padStart(5, "0");
  let found = null;
  for (const [pcode, pname] of DESIGNATED_CITIES) {
    if (pcode.slice(0, 2) !== n.slice(0, 2)) continue;
    if (pcode < n) found = pname;
  }
  return found;
}

/** 画面用。北区 → 大阪市北区。すでに市名が付いていればそのまま。 */
export function cityDisplayName(code, name) {
  const raw = String(name ?? "");
  const parent = designatedCityOf(code, raw);
  if (!parent) return raw;
  if (raw.startsWith(parent)) return raw;
  return parent + raw;
}

/* ------------------------------------------------------------
   読み込み。目次に無い都道府県は取りにいかず "missing" にする。
   国交省の API には実行時に問い合わせない。読むのは同梱した JSON だけ。
   ------------------------------------------------------------ */

const cache = new Map();
let indexCache = { status: "idle" };

export function casesState(pref) {
  return cache.get(pref) || { status: "idle" };
}

export function indexState() {
  return indexCache;
}

/** 目次に載っている都道府県だけ、事例 JSON がある。 */
export function prefIsListed(index, pref) {
  const code = String(pref ?? "").padStart(2, "0");
  return Array.isArray(index?.prefs) && index.prefs.includes(code);
}

/**
 * どの県が収録済みかを先に読む。これがないと、未収録の県を選ぶたびに 404 になる。
 */
export function loadIndex(onChange = () => {}) {
  if (indexCache.status !== "idle") return;
  indexCache = { status: "loading" };
  onChange();
  fetch("./data/index.json")
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((data) => {
      indexCache = { status: "ready", data };
    })
    .catch(() => {
      indexCache = { status: "missing" };
    })
    .finally(onChange);
}

/**
 * 都道府県のデータを読む。二重に走らないよう、状態を先に置いてから取りにいく。
 * 目次が読めていて載っていない県は、通信せず missing にする。
 * onChange は状態が変わるたびに呼ぶ（描画のやり直し用）。
 */
export function loadCases(pref, onChange = () => {}) {
  const now = cache.get(pref);
  if (now && now.status !== "idle") return;
  if (indexCache.status === "ready" && !prefIsListed(indexCache.data, pref)) {
    cache.set(pref, { status: "missing" });
    onChange();
    return;
  }
  cache.set(pref, { status: "loading" });
  onChange();
  fetch(`./data/cases-${pref}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((data) => cache.set(pref, { status: "ready", data }))
    .catch(() => cache.set(pref, { status: "missing" }))
    .finally(onChange);
}

/** テスト用。読み込みを経ずに中身を差し込む。 */
export function seedCases(pref, data) {
  cache.set(pref, { status: "ready", data });
}

export function seedIndex(data) {
  indexCache = { status: "ready", data };
}

export function resetCasesForTest() {
  cache.clear();
  indexCache = { status: "idle" };
}

/* ------------------------------------------------------------
   取り出しと表示
   ------------------------------------------------------------ */

/**
 * 市区町村の一覧。市区町村コード順に出す。
 * 名前順にしたいところだが、漢字だけでは読みが決まらず、localeCompare は
 * 「千代田区」を「渋谷区」より後ろに置いてしまう。コード順は総務省の
 * 標準地域コードの並びで、自治体の公式な一覧と同じ順序になる。
 */
export function cityList(data) {
  if (!data?.cities) return [];
  return Object.entries(data.cities)
    .map(([code, c]) => {
      const raw = c.name || "";
      return {
        code,
        name: cityDisplayName(code, raw),
        group: designatedCityOf(code, raw) || "",
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** 選んだ市区町村・種別の事例。無ければ空。 */
export function bucketOf(data, cityCode, kind) {
  const bucket = data?.cities?.[cityCode]?.kinds?.[kind];
  if (!bucket) return null;
  return bucket;
}

/** その種別で、この市区町村に事例があるか。無い種別のボタンは押させない。 */
export function availableKinds(data, cityCode) {
  const kinds = data?.cities?.[cityCode]?.kinds || {};
  return KINDS.filter((k) => kinds[k.id]);
}

/**
 * 事例1件の見出し。面積・築年・駅からの分数のうち、あるものだけを並べる。
 * 元データは欠けている項目が多いので、無いものは黙って落とす。
 */
export function caseLabel(c) {
  const parts = [];
  if (c.a) parts.push(`${Math.round(c.a).toLocaleString("ja-JP")}㎡`);
  if (c.f) parts.push(c.f);
  if (c.b) parts.push(`${c.b}年築`);
  if (c.w) parts.push(c.w);
  return parts.join("・");
}

/**
 * 万円/㎡。画面の入力欄がその単位なので、そこに合わせて返す。
 *
 * 小数第1位で丸めると、地方が壊れる。土地の単価は 1,000〜5,000円/㎡ の地域が
 * 多く（実測で全バケットの4割超）、0.1万円刻みでは 1,389円 と 1,000円 が同じ値になる。
 * 桁に応じて残す小数を変える。
 */
export function unitPriceMan(c) {
  const yen = typeof c === "number" ? c : (c?.u ?? 0);
  const man = yen / 10_000;
  const decimals = man >= 10 ? 1 : man >= 1 ? 2 : 3;
  return Number(man.toFixed(decimals));
}

/** 「1.4万円」のような表示用。0万円に丸めないため単位を付けてここで作る。 */
export function unitPriceManLabel(yen) {
  return `${unitPriceMan(yen).toLocaleString("ja-JP")}万円`;
}

/**
 * 母数が薄いかどうか。表示枠（12件）を埋めきれない地域は、選んだ1件で
 * 想定価格が大きく動く。実測では母数12件未満で単価の幅がはっきり広がる。
 *
 * 注意すべきは、これが「その地域の取引が少ない」ことを意味しないこと。
 * 元データは買主アンケートで、回収率は全国でおおむね3割。取引があっても
 * 回答がなければ公表されない。少ないのは公表事例のほうなので、文言もそう書く。
 */
export const THIN_SAMPLE = 12;

export function isThinSample(bucket) {
  if (!bucket) return false;
  const n = bucket.n ?? bucket.cases?.length ?? 0;
  return n > 0 && n < THIN_SAMPLE;
}

/**
 * 事例の並びから、安い側・中央・高い側の3つの位置を返す。
 * どれを選ぶかで想定価格がどれだけ動くかを、先に見せるため。
 */
export function spreadSummary(bucket) {
  if (!bucket?.cases?.length) return null;
  const units = bucket.cases.map((c) => c.u).sort((a, b) => a - b);
  return {
    low: units[0],
    median: bucket.med ?? units[Math.floor(units.length / 2)],
    high: units[units.length - 1],
    count: bucket.n ?? units.length,
  };
}
