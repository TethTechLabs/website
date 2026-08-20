/* ============================================================
   近隣の取引事例。

   数字を1つ出して「これです」と言うより、実際にあった取引を何件か並べて
   自分の物件に近いものを選ばせるほうが、当たりの付け方として素直で、
   外したときも「どれを選んだからこうなった」が自分で分かる。

   データは国土交通省「不動産情報ライブラリ」から、ビルド時に取って同梱する
   （scripts/fetch-cases.mjs）。実行時に外へ問い合わせることはしない。
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

/* ------------------------------------------------------------
   読み込み。同梱していない都道府県は "missing" になる。
   ------------------------------------------------------------ */

const cache = new Map();

export function casesState(pref) {
  return cache.get(pref) || { status: "idle" };
}

/**
 * 都道府県のデータを読む。二重に走らないよう、状態を先に置いてから取りにいく。
 * onChange は状態が変わるたびに呼ぶ（描画のやり直し用）。
 */
export function loadCases(pref, onChange = () => {}) {
  const now = cache.get(pref);
  if (now && now.status !== "idle") return;
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
    .map(([code, c]) => ({ code, name: c.name }))
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

/** 万円/㎡。画面の入力欄がその単位なので、そこに合わせて返す。 */
export function unitPriceMan(c) {
  return Math.round((c.u / 10_000) * 10) / 10;
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
