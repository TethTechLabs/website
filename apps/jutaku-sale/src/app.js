import {
  simulate,
  breakEvenPrice,
  taxStartPrice,
  priceMatrix,
  brokerageCap,
  priceFromUnit,
  priceFromAssessed,
  priceFromRosenka,
  priceRange,
  tsuboToSqm,
  sqmToTsubo,
  STRUCTURES,
  RESIDENTIAL_DEDUCTION,
  termOf,
  canUseReduced10,
  yen,
  man,
  manShort,
  percent,
} from "./calc.js";
import { waterfallChart, proceedsChart, indexFromPointer, xForIndex } from "./charts.js";
import { buildShareCanvas, buildShareText } from "./share.js";
import { affiliateHtml } from "./affiliates.js";
import { sellingNotes, LEVELS, STAGES, countByLevel } from "./notes.js";
import {
  PREFECTURES,
  KINDS as CASE_KINDS,
  casesState,
  loadCases,
  cityList,
  bucketOf,
  availableKinds,
  caseLabel,
  unitPriceMan,
  spreadSummary,
} from "./cases.js";

const NOW = new Date();
const TODAY_LABEL = NOW.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });

const STORAGE_KEY = "sale-sim-v1";

/**
 * 共有テキストに載せる公開URL。受け取った人がここから試算に来られるようにする。
 * ストアアプリ版では location が capacitor:// などになるため、実行時ではなく定数で持つ。
 */
const APP_URL = "https://tethtechlabs.com/apps/jutaku-sale/";

const defaults = {
  priceMan: 3500,
  priceStep: 50,
  loanMan: 2000,

  // 取得と譲渡の時期。所有期間は年月から出すので、年数を直接持たない。
  buyYear: NOW.getFullYear() - 12,
  buyMonth: 4,
  sellYear: NOW.getFullYear(),
  sellMonth: NOW.getMonth() + 1,

  isResidence: true,
  useDeduction: true,
  useReduced10: true,

  // 売却の費用
  brokerageMode: "auto",
  brokerageMan: "",
  brokerageLowPrice: false,
  stampMode: "auto",
  stampMan: "",
  releaseProperties: 2,
  releaseJudicialMan: 1.5,
  prepayFeeMan: 2.2,
  extras: [],

  // 取得費
  purchaseKnown: true,
  purchaseLandMan: 1800,
  purchaseBuildingMan: 2000,
  purchaseCostMan: 150,
  structure: "wood",

  // どの段階にいるか。見せるものと、注意点の中身がこれで変わる。
  stage: "guess",

  // 相場の当たりのつけかた
  estMethod: "cases",
  casePref: "13",
  caseCity: "",
  caseKind: "mansion",
  casePicked: -1,
  areaUnit: "sqm",
  areaSqm: 100,
  unitPriceMan: 35,
  assessedMan: 2450,
  rosenkaMan: 2800,

  // 売り出してから決まるまでの幅
  rangeUpPct: 8,
  rangeDownPct: 12,

  // 税額は変えないが、注意点の出し分けに効く事情
  inherited: false,
  coOwned: false,
  buyingNext: false,

  resultTab: "flow",
  theme: "system",
  palette: "standard",
};

/**
 * 段階ごとの既定の振れ幅。
 * まだ何もない人は当たりが粗いので広く、売り出し中は交渉のぶんだけ、
 * 契約済みは価格が決まっているので振らない。
 */
const STAGE_RANGE = {
  guess: { down: 20, up: 12 },
  quoted: { down: 12, up: 8 },
  listed: { down: 10, up: 3 },
  contracted: { down: 0, up: 0 },
};

/** 相場の当たりのつけかた。根拠が違うので、2つ以上で近ければ確からしい。 */
const EST_METHODS = [
  { id: "cases", label: "取引事例" },
  { id: "unit", label: "㎡単価" },
  { id: "assessed", label: "固定資産税" },
  { id: "rosenka", label: "路線価" },
];

/** 価格を調べられる公的なところ。どこも登録なしで見られる。 */
const PRICE_SOURCES = [
  {
    href: "https://www.reinfolib.mlit.go.jp/",
    title: "不動産情報ライブラリ（国土交通省）",
    blurb: "実際に取引された価格を地図から探せる。まずここ。",
  },
  {
    href: "http://www.contract.reins.or.jp/",
    title: "レインズ・マーケット・インフォメーション",
    blurb: "不動産会社が使う成約データ。面積・築年で絞れる。",
  },
  {
    href: "https://www.chikamap.jp/",
    title: "全国地価マップ",
    blurb: "路線価と固定資産税評価額を地図で引ける。",
  },
];

const THEMES = [
  { id: "system", label: "端末に合わせる" },
  { id: "light", label: "ライト" },
  { id: "dark", label: "ダーク" },
];

/** グラフの配色。見本の色は CSS のトークンと合わせてある。 */
const PALETTES = [
  { id: "standard", label: "標準", swatch: ["#1b45c9", "#d4761b", "#c02a20"] },
  { id: "ai", label: "藍と朱", swatch: ["#23407c", "#dd5b24", "#a8261c"] },
  { id: "teal", label: "青緑と橙", swatch: ["#0d6a6d", "#c2660c", "#9c2f8f"] },
  { id: "mono", label: "濃淡だけ", swatch: ["#333e4d", "#b3bcc8", "#10151c"] },
];

const BOUNDS = {
  priceMan: { min: 50, max: 30000 },
  loanMan: { min: 0, max: 20000 },
};

const PRICE_STEPS = [10, 50, 100, 500];
const EXTRA_MAX = 6;

/** よく出る費用。押すと行が増える。deductible は譲渡費用にできるかどうか。 */
const EXTRA_PRESETS = [
  { label: "測量費", man: 50, deductible: true },
  { label: "建物の解体費", man: 150, deductible: true },
  { label: "ハウスクリーニング", man: 8, deductible: false },
  { label: "引越し費用", man: 20, deductible: false },
  { label: "残置物の処分", man: 10, deductible: false },
];

/* ------------------------------------------------------------ 状態 */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

const S = load();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(S)), 250);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const toYen = (m) => num(m) * 10_000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ------------------------------------------------------------ 期間 */

const monthsBetween = (y1, m1, y2, m2) => (y2 - y1) * 12 + (m2 - m1);

/** 購入から引き渡しまでの年数。減価償却の経過年数に使う。 */
function ownedYears() {
  return Math.max(0, monthsBetween(num(S.buyYear), num(S.buyMonth), num(S.sellYear), num(S.sellMonth)) / 12);
}

/**
 * 税法上の所有期間。「譲渡した年の1月1日」までで数えるので、
 * 実際に持っていた年数より最大1年ほど短くなる。
 * 5年・10年の境目はここで決まるため、実期間と分けて持つ。
 */
function taxYears() {
  return Math.max(0, monthsBetween(num(S.buyYear), num(S.buyMonth), num(S.sellYear), 1) / 12);
}

/** いまの当たりのつけかたで出した想定価格。 */
function estimatedPriceYen() {
  const area = S.areaUnit === "tsubo" ? tsuboToSqm(num(S.areaSqm)) : num(S.areaSqm);
  if (S.estMethod === "assessed") return priceFromAssessed(toYen(S.assessedMan));
  if (S.estMethod === "rosenka") return priceFromRosenka(toYen(S.rosenkaMan));
  // 事例モードも、最後は㎡単価×面積。事例を選ぶと単価の欄が入れ替わるだけにしてある。
  return priceFromUnit(area, toYen(S.unitPriceMan));
}

/** 事例データを読み、読み終わったら描き直す。市区町村が未選択なら先頭を入れる。 */
function ensureCases() {
  if (S.estMethod !== "cases") return;
  const state = casesState(S.casePref);
  if (state.status === "idle") {
    loadCases(S.casePref, () => {
      const next = casesState(S.casePref);
      if (next.status === "ready") {
        const cities = cityList(next.data);
        if (!cities.some((c) => c.code === S.caseCity)) S.caseCity = cities[0]?.code || "";
        const kinds = availableKinds(next.data, S.caseCity);
        if (!kinds.some((k) => k.id === S.caseKind)) S.caseKind = kinds[0]?.id || "mansion";
      }
      update();
    });
  }
}

function extrasCopy() {
  return Array.isArray(S.extras) ? S.extras.map((e) => ({ ...e })) : [];
}

/* ------------------------------------------------------------ 計算 */

function buildInput(overrides = {}) {
  return {
    priceYen: toYen(S.priceMan),
    loanBalanceYen: toYen(S.loanMan),

    brokerageMode: S.brokerageMode,
    brokerageYen: toYen(S.brokerageMan),
    brokerageLowPrice: Boolean(S.brokerageLowPrice),
    stampMode: S.stampMode,
    stampYen: toYen(S.stampMan),
    releaseProperties: num(S.releaseProperties),
    releaseJudicialYen: toYen(S.releaseJudicialMan),
    prepayFeeYen: toYen(S.prepayFeeMan),
    extras: extrasCopy().map((e) => ({
      label: e.label,
      yen: toYen(e.man),
      deductible: Boolean(e.deductible),
    })),

    purchaseKnown: Boolean(S.purchaseKnown),
    purchaseLandYen: toYen(S.purchaseLandMan),
    purchaseBuildingYen: toYen(S.purchaseBuildingMan),
    purchaseCostYen: toYen(S.purchaseCostMan),
    structure: S.structure,
    elapsedYears: ownedYears(),

    heldYears: taxYears(),
    isResidence: Boolean(S.isResidence),
    useDeduction: Boolean(S.useDeduction),
    useReduced10: Boolean(S.useReduced10),
    ...overrides,
  };
}

/**
 * 価格帯の並び。いまの価格を中心に、上下30%を11段で刻む。
 * ただし手取り0の価格がその下に近くあるときは、そこまで下端を伸ばす。
 * 「あといくら下がったら持ち出しになるか」は、この表で一番読みたいところなので、
 * 帯の外に出したままにしない。離れすぎている場合は伸ばさない（刻みが粗くなるだけのため）。
 */
function matrixPrices(priceYen, breakEven = null) {
  const base = Math.max(1_000_000, priceYen);
  let lo = base * 0.7;
  if (breakEven != null && breakEven < lo && breakEven > base * 0.4) lo = breakEven * 0.93;
  const stepRaw = (base * 1.3 - lo) / 10;
  // 目盛が「3,283万」のような読みにくい数字にならないよう、50万円単位に丸める。
  const step = Math.max(500_000, Math.round(stepRaw / 500_000) * 500_000);
  const start = Math.max(0, Math.round(lo / step) * step);
  const out = [];
  for (let i = 0; i < 11; i++) out.push(start + step * i);
  return out;
}

let current = null;

function compute() {
  const input = buildInput();
  const r = simulate(input);
  const breakEven = breakEvenPrice(input);
  const prices = matrixPrices(input.priceYen, breakEven);

  // 売り出し価格そのままで決まることは少ない。上下に振った3本で持つ。
  const band = priceRange(input.priceYen, {
    upPercent: num(S.rangeUpPct),
    downPercent: num(S.rangeDownPct),
  });
  const scenarios = [
    { id: "low", label: "早く決める", price: band.low, r: simulate({ ...input, priceYen: band.low }) },
    { id: "mid", label: "この価格", price: band.mid, r },
    { id: "high", label: "時間をかける", price: band.high, r: simulate({ ...input, priceYen: band.high }) },
  ];

  const notes = sellingNotes({
    input,
    result: r,
    ownedYears: ownedYears(),
    flags: {
      breakEven,
      stage: S.stage,
      inherited: Boolean(S.inherited),
      coOwned: Boolean(S.coOwned),
      buyingNext: Boolean(S.buyingNext),
    },
  });

  return {
    input,
    r,
    prices,
    rows: priceMatrix(input, prices),
    breakEven,
    taxStart: taxStartPrice(input),
    band,
    scenarios,
    notes,
  };
}

/* ------------------------------------------------------------ 部品 */

function stepPicker(key, steps, fmt) {
  return `<div class="steps" role="group" aria-label="刻み">
    <span>刻み</span>
    ${steps
      .map((v) => `<button type="button" class="tick" data-step-for="${key}" data-value="${v}">${fmt(v)}</button>`)
      .join("")}
  </div>`;
}

function sliderCard({ key, label, hint, unit, presets = [], scale = null, extra = "", picker = "" }) {
  const b = BOUNDS[key];
  return `
    <div class="ctrl" data-key="${key}">
      <div class="ctrl-head">
        <label class="ctrl-label" for="r-${key}">${label}</label>
        <span class="ctrl-hint">${hint}</span>
      </div>
      <div class="ctrl-value">
        <button type="button" class="step" data-nudge="-1" aria-label="${label}を減らす">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <output class="ctrl-num" for="r-${key}">
          <b data-out="${key}">${num(S[key]).toLocaleString("ja-JP")}</b><span>${unit}</span>
        </output>
        <button type="button" class="step" data-nudge="1" aria-label="${label}を増やす">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${scale ? `<div class="ctrl-scale"><span>${scale[0]}</span><span>${scale[1]}</span></div>` : ""}
      <input class="range" id="r-${key}" type="range"
             min="${b.min}" max="${b.max}" step="${key === "priceMan" ? num(S.priceStep) : 10}"
             value="${S[key]}" aria-label="${label}" />
      ${picker}
      ${
        presets.length
          ? `<div class="presets">${presets
              .map((p) => `<button type="button" class="pill" data-preset="${key}" data-value="${p.value}">${p.label}</button>`)
              .join("")}</div>`
          : ""
      }
      ${extra}
    </div>`;
}

function field(key, label, { unit = "", step = "1", min = "0" } = {}) {
  const v = S[key] === "" ? "" : S[key];
  // 単位は別要素にしない。.grid-inputs label は grid なので、行が増えて欄が縦に伸びる。
  return `<label>${label}${unit ? `（${unit}）` : ""}
    <input type="number" inputmode="decimal" data-field="${key}" value="${v}" step="${step}" min="${min}" />
  </label>`;
}

function toggleChip(key, label) {
  return `<button type="button" class="chip-toggle" data-toggle="${key}" aria-pressed="${Boolean(S[key])}">${label}</button>`;
}

function segment(key, options, aria) {
  return `<div class="seg small" role="group" aria-label="${aria}">
    ${options.map((o) => `<button type="button" data-set="${key}" data-value="${o.id}">${o.label}</button>`).join("")}
  </div>`;
}

/**
 * 広告の差し込み位置。実タグが決まるまでは何も描かない。
 * プレースホルダーを置いたままだと審査で落ちるため、空要素にしておく。
 */
function adSlotHtml(id) {
  return `<div class="ad-slot is-empty" data-ad-slot="${id}" aria-hidden="true"></div>`;
}

/* ------------------------------------------------------------ 画面 */

function scaffold() {
  return `
    <header class="hero" id="hero">
      <div class="hero-main">
        <p class="hero-label" data-out="heroLabel">手元に残る額</p>
        <p class="hero-value" data-out="heroNet">—</p>
      </div>
      <div class="hero-bonus">
        <p class="hero-label">手取りが0になる価格</p>
        <p class="hero-value2" data-out="heroBreak">—</p>
      </div>
      <dl class="hero-stats">
        <div><dt>諸費用</dt><dd data-out="heroCosts">—</dd></div>
        <div><dt>ローン残債</dt><dd data-out="heroLoan">—</dd></div>
        <div><dt>譲渡所得税</dt><dd data-out="heroTax">—</dd></div>
      </dl>
    </header>

    <div class="screen-scroll" data-screen-scroll>
    <div class="screen" data-screen-panel="stage">
      <section class="stage" aria-labelledby="h-stage">
        <h2 id="h-stage">いまどの段階ですか</h2>
        <div class="stage-seg" role="group" aria-label="いまの段階">
          ${STAGES.map(
            (st) => `<button type="button" data-set="stage" data-value="${st.id}">
              <b>${st.label}</b><span>${st.full}</span>
            </button>`
          ).join("")}
        </div>
        <p class="hint" data-out="stageHint"></p>
      </section>
      <p class="step-note">ここで選んだ段階に合わせて、この先に出るものが変わります。あとから変えられます。</p>
    </div>

    <div class="screen" data-screen-panel="sell">
      <section class="controls" aria-label="売却の条件">
        ${sliderCard({
          key: "priceMan",
          label: "売却価格（想定）",
          hint: "査定額や相場から",
          unit: "万円",
          scale: ["50万", "3億"],
          picker: stepPicker("priceMan", PRICE_STEPS, (v) => `${v}万`),
        })}
        ${sliderCard({
          key: "loanMan",
          label: "ローン残債",
          hint: "引き渡し時点の残り",
          unit: "万円",
          scale: ["0", "2億"],
          extra: `<p class="ctrl-hint" data-out="loanHint"></p>`,
        })}
      </section>
      <button type="button" class="costs-entry" data-goto="market" data-market-entry>相場から当たりをつけ直す</button>
      <button type="button" class="costs-entry" data-goto="costs">諸費用の内訳を開く</button>
      ${adSlotHtml("input-banner")}
    </div>

    <div class="screen" data-screen-panel="buy">
        <div class="panel-head">
          <h2 id="h-when">買った時期と売る時期</h2>
          <p class="panel-sub">税率の分かれ目は「売った年の1月1日時点で何年持っていたか」で決まる。引き渡し日ではないので、年月から数え直します。</p>
        </div>
        <div class="grid-inputs tight">
          ${field("buyYear", "購入した年", { unit: "年", min: "1950" })}
          ${field("buyMonth", "購入した月", { unit: "月", min: "1" })}
          ${field("sellYear", "売却する年", { unit: "年", min: "1950" })}
          ${field("sellMonth", "売却する月", { unit: "月", min: "1" })}
        </div>
        <div class="minis">
          <div class="mini"><span>実際に持っていた期間</span><b data-out="ownedLabel">—</b></div>
          <div class="mini"><span>税法上の所有期間（1月1日基準）</span><b data-out="taxYearsLabel">—</b></div>
        </div>
        <p class="hint" data-out="termHint"></p>
      </section>

      <section class="panel" aria-labelledby="h-buy">
        <div class="panel-head">
          <h2 id="h-buy">買ったときの金額（取得費）</h2>
          <p class="panel-sub">売買契約書が手元にあれば入れてください。分からないときは、売却価格の5%を取得費とみなして計算します。この差で税額は大きく変わります。</p>
        </div>
        <div class="row">
          ${toggleChip("purchaseKnown", "購入時の金額が分かる")}
        </div>
        <div data-out="purchasePanel"></div>
      </section>
    </div>

    <div class="screen" data-screen-panel="case">
        <div class="panel-head">
          <h2 id="h-tax">税金の条件</h2>
          <p class="panel-sub">住んでいた家を売るときは、譲渡益から3,000万円まで引ける特例があります。適用には要件があるので、使えるかどうかは自分で確かめてください。</p>
        </div>
        <div class="row">
          ${toggleChip("isResidence", "自分が住んでいた家")}
          ${toggleChip("useDeduction", "3,000万円の特別控除を使う")}
          ${toggleChip("useReduced10", "10年超の軽減税率を使う")}
        </div>
        <p class="hint" data-out="taxHint"></p>
        <div class="row">
          <span class="row-label">当てはまるもの</span>
        </div>
        <div class="row">
          ${toggleChip("inherited", "相続で取得した")}
          ${toggleChip("coOwned", "共有名義")}
          ${toggleChip("buyingNext", "売却後に住み替えて、新居でローンを組む")}
        </div>
        <p class="hint">この3つは税額の計算を変えません。当てはまる場合に見落としやすい点を、注意点として出すために使います。</p>
    </div>

    <div class="screen" data-screen-panel="result">
      <section class="panel" aria-labelledby="h-band">
        <div class="panel-head">
          <h2 id="h-band" data-out="bandTitle">決まる価格には幅がある</h2>
          <p class="panel-sub" data-out="bandSub"></p>
        </div>
        <div data-out="band"></div>
      </section>

      <div class="tabbar" role="tablist" aria-label="結果の見かた">
        <button type="button" role="tab" data-tab="flow">内訳</button>
        <button type="button" role="tab" data-tab="range">価格帯</button>
        <button type="button" role="tab" data-tab="tax">税金</button>
        <button type="button" role="tab" data-tab="notes">注意点<b data-out="noteBadge"></b></button>
      </div>

      <div data-tabpanel="flow" role="tabpanel">
        <div data-out="answer"></div>
        <div class="chart-wrap">
          <p class="chart-title">売却価格から手取りまで</p>
          <div data-out="waterfall"></div>
        </div>
        <div data-out="flowTable"></div>
      </div>

      <div data-tabpanel="range" role="tabpanel">
        <div class="chart-wrap">
          <p class="chart-title">いくらで売れたら、いくら残るか</p>
          <div data-out="proceeds"></div>
          <p class="readout" data-out="proceedsReadout"></p>
          <p class="scrub-hint">グラフを指でなぞると、その価格の手取りが出ます。</p>
        </div>
        <div data-out="matrix"></div>
      </div>

      <div data-tabpanel="tax" role="tabpanel">
        <div data-out="taxPanel"></div>
      </div>

      <div data-tabpanel="notes" role="tabpanel">
        <div data-out="notes"></div>
        <section class="panel" aria-labelledby="h-steps">
          <div class="panel-head">
            <h2 id="h-steps">売却の段取り</h2>
            <p class="panel-sub">お金が動くところに印をつけてあります。</p>
          </div>
          <ol class="flow-steps">
            <li><b>相場を調べる</b><span>成約事例で当たりをつける。査定を頼む前に自分の数字を持っておく。</span></li>
            <li><b>査定・媒介契約</b><span>複数社に出す。ここで仲介手数料と契約の種類が決まる。</span></li>
            <li><b>売り出し・内見</b><span>反応がなければ3か月を目安に価格を見直す。</span></li>
            <li><b>価格交渉</b><span>指値が入る前提で売り出す。手取りの下限をここまでに決めておく。</span></li>
            <li><b>売買契約</b><em>手付金を受け取る／印紙税</em><span>手付解除の期限と違約金の条件を読む。</span></li>
            <li><b>引き渡し・決済</b><em>残代金／残債完済／仲介手数料／抵当権抹消</em><span>同じ日に全部動く。司法書士が立ち会う。</span></li>
            <li><b>翌年の確定申告</b><em>所得税</em><span>特例を使うなら申告が必須。2月16日〜3月15日。</span></li>
            <li><b>翌年6月ごろ</b><em>住民税</em><span>売った翌年に来る。取り分けておく。</span></li>
          </ol>
        </section>
      </div>

      ${adSlotHtml("result-banner")}
      ${affiliateHtml()}
    </div>

    <div class="screen" data-screen-panel="costs">
      <button type="button" class="back-btn" data-back>← 戻る</button>
      <section class="panel" aria-labelledby="h-cost">
        <div class="panel-head">
          <h2 id="h-cost">売却にかかる費用</h2>
          <p class="panel-sub">仲介手数料と印紙税は売却価格から自動で出します。実際の金額が決まったら、手入力に切り替えて上書きしてください。</p>
        </div>
        <div data-out="costs"></div>
      </section>
    </div>

    <div class="screen" data-screen-panel="market">
      <button type="button" class="back-btn" data-back data-market-back>← 戻る</button>

      <section class="panel" aria-labelledby="h-src">
        <div class="panel-head">
          <h2 id="h-src">まず、近隣がいくらで売れたかを見る</h2>
          <p class="panel-sub">査定を頼むと営業が始まります。その前に、公的なデータで自分の当たりを持っておくと、出てきた査定額が高いのか安いのかを判断できます。どれも登録なしで見られます。</p>
        </div>
        <div class="src-list">
          ${PRICE_SOURCES.map(
            (x) => `<a class="src-item" href="${x.href}" target="_blank" rel="noopener">
              <b>${x.title}</b><span>${x.blurb}</span>
            </a>`
          ).join("")}
        </div>
        <p class="hint">探すのは「同じ地域・同じくらいの面積・近い築年」の成約価格です。売り出し中の価格は、売れなかった価格なので当てになりません。</p>
      </section>

      <section class="panel" aria-labelledby="h-est">
        <div class="panel-head">
          <h2 id="h-est">調べた数字から、想定価格を出す</h2>
          <p class="panel-sub">根拠の違う3つの出しかたがあります。2つ以上でやって近い値になれば、その辺りが実勢だと考えていい。</p>
        </div>
        <div class="row est-row">
          ${segment("estMethod", EST_METHODS, "当たりのつけかた")}
        </div>
        <div data-out="estPanel"></div>
        <div class="est-result">
          <span>想定価格<em>目安の計算値です</em></span>
          <b data-out="estValue">—</b>
        </div>
        <p class="legal-lead">この数値は入力された条件から機械的に計算した目安であり、不動産の鑑定評価でも査定でもありません。実際に売れる価格を示すものではありません。</p>
        <p class="hint">出るのは目安です。同じ地域でも、角地か、日当たりか、前面道路の幅か、リフォームの有無かで動きます。幅を持って考えてください。</p>
      </section>
    </div>

    <div class="screen" data-screen-panel="share">
      <button type="button" class="back-btn" data-back>← 戻る</button>
      <section class="cond-card" aria-labelledby="h-cond">
        <div class="cond-head">
          <span class="cond-badge">試算値</span>
          <span class="cond-date" data-out="condDate"></span>
        </div>
        <h2 id="h-cond" class="visually-hidden">この試算の条件</h2>
        <div class="cond-grid" data-out="condGrid"></div>
        <p class="cond-foot">実際の税額や費用は、税理士・税務署または不動産会社へご確認ください。</p>
      </section>

      <section class="panel share-panel" aria-labelledby="h-share">
        <div class="panel-head">
          <h2 id="h-share">共有</h2>
          <p class="panel-sub">家族や税理士に、この条件を送れます。査定の依頼にはなりません。</p>
        </div>
        <div class="share-actions">
          <button type="button" class="pill" data-share="native">LINEなどで共有</button>
          <button type="button" class="pill" data-share="image">画像を保存</button>
          <button type="button" class="pill ghost" data-share="text">条件をコピー</button>
        </div>
        <p class="share-status" data-out="shareStatus" aria-live="polite"></p>
      </section>
    </div>

    <div class="screen" data-screen-panel="settings">
      <button type="button" class="back-btn" data-back>← 戻る</button>
      <section class="panel" aria-labelledby="h-prefs">
        <div class="panel-head">
          <h2 id="h-prefs">表示</h2>
          <p class="panel-sub">配色はどれも、色覚特性のある人と白黒印刷で読み分けられる組み合わせにしてあります。</p>
        </div>
        <div class="prefs">
          <div class="pref-row">
            <span class="pref-label">テーマ</span>
            ${segment("theme", THEMES, "テーマ")}
          </div>
          <div class="pref-row">
            <span class="pref-label">グラフの配色</span>
            <div class="swatches" role="group" aria-label="グラフの配色">
              ${PALETTES.map(
                (pl) => `<button type="button" class="swatch" data-set="palette" data-value="${pl.id}">
                  <i aria-hidden="true">${pl.swatch.map((c) => `<b style="background:${c}"></b>`).join("")}</i>
                  ${pl.label}
                </button>`
              ).join("")}
            </div>
          </div>
        </div>
      </section>

      <footer class="legal">
        <p><b>本サービスの位置づけ</b>　入力された数値をもとに一般的な計算方法を当てはめて結果を表示する試算ツールです。税理士法に定める税務相談、弁護士法に定める法律事務、不動産の鑑定評価、宅地建物取引業法に定める媒介・代理のいずれも行いません。個別のご事情に対する税務・法律の判断は、税理士・税務署・弁護士などの専門家にご相談ください。お問い合わせをいただいても、個別の税額計算や特例の適用可否についてはお答えできません。</p>
        <p><b>個人情報について</b>　入力した内容は端末の中だけに保存され、当方のサーバーには送信しません。会員登録も、査定や買取の申し込みもありません。本サービスから営業のご連絡を差し上げることはありません。なお、広告の配信のためにCookieや広告識別子が使用されます。詳しくはプライバシーポリシーをご覧ください。</p>
        <p><b>免責事項</b>　本サービスの計算結果は、入力された条件に基づく試算です。実際の売却価格、成約の可否、税額、適用される特例、諸費用を保証するものではありません。正式な取扱いについては、税理士・税務署または不動産会社へご確認ください。</p>
        <p><b>計算の規約</b>　仲介手数料は宅地建物取引業法の報酬上限（速算式・消費税10%込み）で、実際の依頼額とは異なります。印紙税は不動産譲渡契約書の軽減税率（2027年3月31日まで）によります。建物の取得費は非事業用の減価償却（取得価額×0.9×償却率×経過年数、取得価額の95%が上限）を引いた額です。譲渡所得税は復興特別所得税（所得税額の2.1%、2037年まで）を含みます。</p>
        <p><b>前提</b>　抵当権抹消費用とローンの一括返済手数料は、手取りからは引きますが、税法上の譲渡費用には入れていません。3,000万円特別控除と10年超の軽減税率は、適用要件を満たすものとして計算します（前年・前々年に同じ特例を受けている場合などは使えません）。相続した空き家の特例、買換え特例、譲渡損失の損益通算・繰越控除には対応していません。住民税は売却の翌年に課税されるため、支払う時期が所得税とずれます。</p>
      </footer>

      <section class="support">
        <h2>制作者について</h2>
        <p>本サービスは、<b>1級ファイナンシャル・プランニング技能士</b>、および<b>宅地建物取引士資格試験合格者</b>が設計しています。</p>
        <p class="support-strong">ただし本サービスは税務相談・法律相談を行うものではありません。<b>個別のご相談はお受けしません。</b>ご自身の物件の価格、税額、特例の適用可否についてのお問い合わせには、お答えできません。税理士・税務署・弁護士・宅地建物取引業者など、それぞれの専門家にご相談ください。</p>
      </section>

      <section class="support">
        <h2>お問い合わせ</h2>
        <p>不具合のご報告、機能に関するご要望はこちらへお願いします。上記のとおり、個別のご相談にはお答えできません。</p>
        <p><a href="mailto:info@tethtechlabs.com">info@tethtechlabs.com</a></p>
        <p class="support-owner">提供：TethTechLabs</p>
      </section>

      <nav class="legal-links" aria-label="関連ページ">
        <a href="https://tethtechlabs.com/apps/jutaku-sale/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>
        <a href="https://tethtechlabs.com/apps/jutaku-sale/terms.html" target="_blank" rel="noopener">利用規約</a>
        <a href="https://tethtechlabs.com/apps/jutaku-sale/disclaimer.html" target="_blank" rel="noopener">免責事項</a>
      </nav>
    </div>
    </div>

    <nav class="steps-nav" data-steps-nav>
      <button type="button" class="step-back" data-step="-1">← 戻る</button>
      <p class="steps-dots" data-out="stepDots" aria-live="polite"></p>
      <button type="button" class="step-next" data-step="1" data-out="stepNext">次へ</button>
    </nav>

    <nav class="bottom-nav" data-bottom-nav>
      <div class="nav-main is-single">
        <button type="button" data-step="-1">← 条件を直す</button>
      </div>
      <button type="button" class="nav-icon" data-goto="costs">費用</button>
      <button type="button" class="nav-icon" data-goto="share">共有</button>
      <button type="button" class="nav-icon" data-goto="settings">設定</button>
    </nav>`;
}

const app = document.getElementById("app");
app.innerHTML = scaffold();

const out = {};
for (const node of app.querySelectorAll("[data-out]")) out[node.dataset.out] = node;

/* ------------------------------------------------------------ 画面遷移 */

let screen = "stage";
let lastMain = "stage";

/**
 * 手順の並び。相場の当たりは、まだ数字を持っていない人だけが通る。
 * 査定額をもらっている人にとっては、自分の数字がすでにあるので回り道になる。
 */
function flow() {
  const steps = S.stage === "guess" ? ["stage", "market", "sell", "buy", "case"] : ["stage", "sell", "buy", "case"];
  return [...steps, "result"];
}

const STEP_NEXT_LABEL = {
  market: "この価格で進む",
  case: "手取りを見る",
};

/** 手順の外にある画面（費用・共有・設定）。ここでは前後の移動を出さない。 */
const ASIDE = ["costs", "share", "settings"];

function setScreen(next) {
  if (!ASIDE.includes(screen)) lastMain = screen;
  screen = next;
  applyScreen();
  const scroller = app.querySelector("[data-screen-scroll]");
  if (scroller) scroller.scrollTo(0, 0);
}

/** 手順を1つ進める・戻す。相場を飛ばすかどうかは flow() が決める。 */
function goStep(delta) {
  const list = flow();
  const i = list.indexOf(screen);
  if (i < 0) {
    setScreen(lastMain);
    return;
  }
  const nextIndex = Math.min(list.length - 1, Math.max(0, i + delta));
  // 相場から進むときは、出した想定価格をそのまま売却価格に入れる。
  if (screen === "market" && delta > 0) {
    setKey("priceMan", Math.round(estimatedPriceYen() / 10_000));
  }
  setScreen(list[nextIndex]);
}

function applyScreen() {
  for (const el of app.querySelectorAll("[data-screen-panel]")) {
    el.hidden = el.dataset.screenPanel !== screen;
  }
  const list = flow();
  const i = list.indexOf(screen);
  const inFlow = i >= 0;

  // 数字を入れる前に答えを出さない。売る値段に触れる画面から先で出す。
  const hero = app.querySelector("#hero");
  if (hero) hero.hidden = !["sell", "buy", "case", "result"].includes(screen);

  const stepsNav = app.querySelector("[data-steps-nav]");
  if (stepsNav) stepsNav.hidden = !inFlow || screen === "result";

  // 相場は「まだ何も」の人には手順の一部、それ以外の人には寄り道。
  // 手順に入っていないときだけ、戻る口を出す。
  const marketInFlow = list.includes("market");
  const marketBack = app.querySelector("[data-market-back]");
  if (marketBack) marketBack.hidden = marketInFlow;
  const marketEntry = app.querySelector("[data-market-entry]");
  if (marketEntry) marketEntry.hidden = marketInFlow || S.stage === "contracted";
  const nav = app.querySelector("[data-bottom-nav]");
  if (nav) nav.hidden = screen !== "result";

  if (inFlow && screen !== "result") {
    const total = list.length - 1; // 結果は手順に数えない
    const dots = list
      .slice(0, total)
      .map((_, k) => `<i class="${k === i ? "is-on" : k < i ? "is-done" : ""}"></i>`)
      .join("");
    out.stepDots.innerHTML = `${dots}<span>${i + 1} / ${total}</span>`;
    out.stepNext.textContent = STEP_NEXT_LABEL[screen] || "次へ";
    app.querySelector("[data-step=\"-1\"]").disabled = i === 0;
  }

  for (const b of app.querySelectorAll("[data-goto]")) {
    b.setAttribute("aria-pressed", String(b.dataset.goto === screen));
  }
}

function applyResultTab() {
  for (const el of app.querySelectorAll("[data-tabpanel]")) {
    el.hidden = el.dataset.tabpanel !== S.resultTab;
  }
  for (const b of app.querySelectorAll("[data-tab]")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === S.resultTab));
  }
}

function applyPrefs() {
  const root = document.documentElement;
  if (S.theme === "light" || S.theme === "dark") root.dataset.theme = S.theme;
  else delete root.dataset.theme;
  root.dataset.palette = S.palette || "standard";
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  for (const m of metas) {
    if (S.theme === "system") m.content = m.media.includes("dark") ? "#0b0d11" : "#ffffff";
    else m.content = bg;
  }
}

function setStates() {
  for (const b of app.querySelectorAll("[data-set]")) {
    b.setAttribute("aria-pressed", String(String(S[b.dataset.set]) === b.dataset.value));
  }
  for (const b of app.querySelectorAll("[data-toggle]")) {
    b.setAttribute("aria-pressed", String(Boolean(S[b.dataset.toggle])));
  }
  for (const b of app.querySelectorAll("[data-preset]")) {
    b.setAttribute("aria-pressed", String(num(S[b.dataset.preset]) === num(b.dataset.value)));
  }
  for (const b of app.querySelectorAll("[data-step-for]")) {
    b.setAttribute("aria-pressed", String(num(S.priceStep) === num(b.dataset.value)));
  }
  // 3,000万円控除も10年超の軽減も、居住用でなければ選べない。
  for (const key of ["useDeduction", "useReduced10"]) {
    const btn = app.querySelector(`[data-toggle="${key}"]`);
    if (btn) btn.disabled = !S.isResidence;
  }
}

function syncSlider(key) {
  const input = app.querySelector(`#r-${key}`);
  const b = BOUNDS[key];
  const v = num(S[key]);
  if (key === "priceMan") input.step = String(num(S.priceStep));
  input.value = String(v);
  input.style.setProperty("--pct", `${((v - b.min) / (b.max - b.min)) * 100}%`);
  const target = app.querySelector(`[data-out="${key}"]`);
  if (target) target.textContent = v.toLocaleString("ja-JP");
}

/* ------------------------------------------------------------ 中身 */

function purchasePanelHtml() {
  if (!S.purchaseKnown) {
    const est = toYen(S.priceMan) * 0.05;
    return `<p class="hint">取得費は <b>売却価格の5%（${man(est)}）</b> として計算します。実際にはもっと高く買っているのが普通なので、譲渡益が大きく出て、税額も大きくなります。契約書が見つかれば結果は変わります。</p>`;
  }
  return `
    <div class="grid-inputs tight">
      ${field("purchaseLandMan", "土地の購入代金", { unit: "万円", step: "10" })}
      ${field("purchaseBuildingMan", "建物の購入代金", { unit: "万円", step: "10" })}
      ${field("purchaseCostMan", "購入時の諸費用", { unit: "万円", step: "10" })}
    </div>
    <div class="row">
      <span class="row-label">建物の構造</span>
      ${segment("structure", STRUCTURES, "建物の構造")}
    </div>
    <p class="hint" data-out="depHint"></p>`;
}

function extraRowsHtml() {
  const items = extrasCopy();
  const rows = items
    .map(
      (e, i) => `<div class="rp-row">
        <div class="rp-cell">
          <label class="mini-label" for="ex-l-${i}">項目</label>
          <input id="ex-l-${i}" type="text" data-extra-label="${i}" value="${esc(e.label ?? "")}" placeholder="測量費" />
        </div>
        <div class="rp-cell">
          <label class="mini-label" for="ex-m-${i}">金額（万円）</label>
          <input id="ex-m-${i}" type="number" inputmode="decimal" step="1" min="0" data-extra-man="${i}" value="${e.man === "" ? "" : num(e.man)}" />
        </div>
        <button type="button" class="rp-del" data-extra-del="${i}" aria-label="${esc(e.label || "この行")}を削除">✕</button>
        <div class="rp-cell" style="grid-column:1 / -1">
          <button type="button" class="chip-toggle" data-extra-ded="${i}" aria-pressed="${Boolean(e.deductible)}">譲渡費用にできる（税金の計算から引く）</button>
        </div>
      </div>`
    )
    .join("");

  const presets =
    items.length >= EXTRA_MAX
      ? ""
      : `<div class="presets">${EXTRA_PRESETS.map(
          (p, i) => `<button type="button" class="pill" data-extra-add="${i}">＋ ${p.label}</button>`
        ).join("")}<button type="button" class="pill ghost" data-extra-add="blank">＋ 自由入力</button></div>`;

  return `<div class="rp-rows">${rows || '<p class="rp-empty">追加の費用はありません。</p>'}</div>${presets}`;
}

function costsHtml(c) {
  const { items } = c.r.costs;
  const find = (id) => items.find((i) => i.id === id);
  const brokerage = find("brokerage");
  const stamp = find("stamp");
  const capNow = brokerageCap(c.input.priceYen, { lowPrice: S.brokerageLowPrice });

  const rows = items
    .map(
      (it) => `<tr>
        <th>${esc(it.label)}${it.deductible ? "" : "<small>税金の計算では譲渡費用にできません</small>"}</th>
        <td class="tnum">${yen(it.yen)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="cost-group">
      <div class="row">
        <span class="row-label">仲介手数料</span>
        ${segment("brokerageMode", [{ id: "auto", label: "上限で試算" }, { id: "manual", label: "手入力" }], "仲介手数料の出しかた")}
      </div>
      ${
        S.brokerageMode === "manual"
          ? `<div class="grid-inputs tight">${field("brokerageMan", "仲介手数料（税込）", { unit: "万円", step: "1" })}</div>
             <p class="hint">法定上限は ${man(capNow)}（税込）です。これを超える請求は受けられません。</p>`
          : `<p class="hint">売却価格 ${man(c.input.priceYen)} なら、法定上限は <b>${yen(capNow)}</b>（税込）。速算式は「価格×3%＋6万円」に消費税を足したものです。上限であって定価ではないので、値引き交渉の余地はあります。</p>
             <div class="row">${toggleChip("brokerageLowPrice", "800万円以下の物件で、33万円までの取り決めがある")}</div>`
      }
    </div>

    <div class="cost-group">
      <div class="row">
        <span class="row-label">印紙税（売買契約書）</span>
        ${segment("stampMode", [{ id: "auto", label: "自動" }, { id: "manual", label: "手入力" }], "印紙税の出しかた")}
      </div>
      ${
        S.stampMode === "manual"
          ? `<div class="grid-inputs tight">${field("stampMan", "印紙税", { unit: "万円", step: "0.1" })}</div>`
          : `<p class="hint">売却価格 ${man(c.input.priceYen)} の区分で <b>${yen(stamp.yen)}</b>。2027年3月31日までの軽減税率によります。</p>`
      }
    </div>

    <div class="cost-group">
      <span class="row-label">ローンを外すための費用</span>
      <div class="grid-inputs tight">
        ${field("releaseProperties", "抵当権抹消の不動産の数", { unit: "個", step: "1" })}
        ${field("releaseJudicialMan", "司法書士報酬", { unit: "万円", step: "0.5" })}
        ${field("prepayFeeMan", "一括返済の手数料", { unit: "万円", step: "0.1" })}
      </div>
      <p class="hint">登録免許税は不動産1個につき1,000円です。土地と建物なら2個で数えます。ここの費用は手取りからは引かれますが、税法上の譲渡費用には入りません。</p>
    </div>

    <div class="cost-group">
      <span class="row-label">その他の費用</span>
      ${extraRowsHtml()}
    </div>

    <table class="data-table costs">
      <tbody>${rows}
        <tr class="is-base"><th>費用の合計</th><td class="tnum"><b>${yen(c.r.costs.total)}</b></td></tr>
        <tr><th>うち譲渡費用になる分</th><td class="tnum">${yen(c.r.costs.deductible)}</td></tr>
      </tbody>
    </table>`;
}

function answerHtml(c) {
  const r = c.r;
  const short = r.net < 0;
  const minus = (v) => (v > 0 ? `−${man(v)}` : man(0));
  const flow = [
    ["売却価格", man(r.price)],
    ["諸費用", minus(r.costs.total)],
    ["ローン残債", minus(r.loan)],
    ["譲渡所得税", minus(r.tax.total)],
  ];

  const warn = short
    ? `<div class="residual-warn">
        <p class="residual-head">この価格では引き渡せません</p>
        <dl>
          <div><dt>不足額</dt><dd><b>${man(r.shortfall)}</b></dd></div>
          <div class="is-sum"><dt>必要な価格</dt><dd><b>${c.breakEven == null ? "—" : man(c.breakEven)}</b> 以上</dd></div>
        </dl>
        <p class="residual-note">売却代金でローンを完済できないと、抵当権が外れず引き渡しができません。差額を自己資金で用意するか、住み替えローンなど別の方法を金融機関に相談することになります。</p>
      </div>`
    : "";

  return `<section class="answer">
      <div class="ans-flow">
        ${flow
          .map(
            ([label, v], i) =>
              `<div class="ans-cell"><span>${label}</span><b>${v}</b></div>${
                i < flow.length - 1 ? '<div class="ans-arrow">↓</div>' : ""
              }`
          )
          .join("")}
      </div>
      <div class="ans-total">
        <span>${short ? "用意する現金" : "手元に残る額"}</span>
        <b class="${short ? "is-warn" : ""}">${short ? man(r.shortfall) : man(r.net)}</b>
      </div>
      <p class="legend-note">${
        short
          ? `売却代金では ${man(r.shortfall)} 足りません。`
          : `売却価格の ${percent(r.keepRatio)} が手元に残る計算です。`
      }${r.tax.total > 0 ? `このうち住民税 ${yen(r.tax.resident)} は売却の翌年に納めます。` : ""}</p>
      ${warn}
    </section>`;
}

function flowTableHtml(c) {
  const r = c.r;
  const rows = r.costs.items
    .map((it) => `<tr><th>　${esc(it.label)}</th><td class="tnum">−${yen(it.yen)}</td></tr>`)
    .join("");
  return `<table class="data-table costs">
      <tbody>
        <tr class="is-base"><th>売却価格</th><td class="tnum">${yen(r.price)}</td></tr>
        ${rows}
        <tr><th>ローン残債</th><td class="tnum">−${yen(r.loan)}</td></tr>
        <tr><th>譲渡所得税・住民税</th><td class="tnum">−${yen(r.tax.total)}</td></tr>
        <tr class="is-base"><th>${r.net < 0 ? "不足額" : "手取り"}</th><td class="tnum ${r.net < 0 ? "is-warn" : ""}"><b>${yen(r.net)}</b></td></tr>
      </tbody>
    </table>`;
}

function matrixHtml(c) {
  const rows = c.rows
    .map((row) => {
      const isNow = Math.abs(row.price - c.input.priceYen) < 1;
      return `<tr class="${isNow ? "is-picked" : ""}">
        <th>${manShort(row.price)}</th>
        <td class="tnum ${row.net < 0 ? "is-warn" : ""}">${manShort(row.net)}</td>
        <td class="tnum">${row.tax > 0 ? manShort(row.tax) : "—"}</td>
        <td class="tnum">${manShort(row.costs)}</td>
      </tr>`;
    })
    .join("");

  return `<div class="matrix-scroll">
      <table class="data-table">
        <thead><tr><th>売れた価格</th><th>手取り</th><th>うち税金</th><th>諸費用</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="legend-note">単位は万円。100万円下げて売ると、手取りは100万円より少し多く減ります。仲介手数料も価格に連動して下がるためです。</p>`;
}

function taxPanelHtml(c) {
  const r = c.r;
  const a = r.acquisition;
  const term = termOf(c.input.heldYears);
  const reduced = S.useReduced10 && canUseReduced10(c.input.heldYears, S.isResidence);

  const rateLabel = (b) =>
    `${((b.income + b.resident) * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
  const bands = r.tax.bands
    .map(
      (b) => `<tr>
        <th>${b.label}<small>${rateLabel(b)}</small></th>
        <td class="tnum">${yen(b.amount)}</td>
        <td class="tnum">${yen(b.amount * (b.income + b.resident))}</td>
      </tr>`
    )
    .join("");

  const acquisitionNote =
    a.method === "estimated"
      ? `<p class="hint">取得費は <b>概算取得費（売却価格の5%）</b> を使っています。${
          S.purchaseKnown
            ? "入れた実額よりこちらのほうが大きく、有利になるためです。"
            : "購入時の金額が分からないためです。契約書が見つかれば、税額はここから大きく下がる可能性があります。"
        }</p>`
      : `<p class="hint">建物は年数ぶん価値が減ったものとして扱います。この試算では減価償却費 <b>${yen(a.depreciation)}</b> を差し引いた額を取得費としています。</p>`;

  return `
    <p class="legal-lead">以下は、入力された数値をもとに一般的な計算方法を当てはめた<b>試算</b>です。特例の適用可否を判定するものではなく、税務相談にあたるものでもありません。実際の申告は税務署または税理士にご確認ください。</p>
    <table class="data-table costs">
      <tbody>
        <tr class="is-base"><th>譲渡価額（売却価格）</th><td class="tnum">${yen(r.price)}</td></tr>
        <tr><th>取得費<small>${a.method === "estimated" ? "概算取得費（5%）" : "土地＋償却後の建物＋購入時諸費用"}</small></th><td class="tnum">−${yen(a.total)}</td></tr>
        <tr><th>譲渡費用<small>仲介手数料・印紙税など</small></th><td class="tnum">−${yen(r.costs.deductible)}</td></tr>
        <tr class="is-base"><th>譲渡所得</th><td class="tnum">${yen(r.gross)}</td></tr>
        <tr><th>特別控除<small>${
          r.deductionCap > 0 ? "居住用財産の3,000万円特別控除" : "適用なし"
        }</small></th><td class="tnum">−${yen(r.deduction)}</td></tr>
        <tr class="is-base"><th>課税譲渡所得</th><td class="tnum">${yen(r.taxable)}</td></tr>
      </tbody>
    </table>
    ${acquisitionNote}

    <div class="chart-wrap">
      <p class="chart-title">税率の当てはめ${r.taxable > 0 ? ` — ${esc(r.tax.label)}` : ""}</p>
      <table class="data-table costs">
        <thead><tr><th>区分</th><th>対象の所得</th><th>税額</th></tr></thead>
        <tbody>${
          bands ||
          '<tr><th>課税される譲渡所得がありません</th><td class="tnum">¥0</td><td class="tnum">¥0</td></tr>'
        }
          <tr class="is-base"><th>税額の合計</th><td></td><td class="tnum"><b>${yen(r.tax.total)}</b></td></tr>
          <tr><th>　うち所得税・復興特別所得税</th><td></td><td class="tnum">${yen(r.tax.income)}</td></tr>
          <tr><th>　うち住民税<small>売却した年の翌年に納めます</small></th><td></td><td class="tnum">${yen(r.tax.resident)}</td></tr>
        </tbody>
      </table>
    </div>

    <p class="legend-note">1月1日基準の所有期間は ${c.input.heldYears.toFixed(1)}年。${
      reduced
        ? "10年を超えているため、この試算では6,000万円以下の部分に14.21%の軽減税率を当てています。"
        : term.id === "short"
          ? "5年以下のため、この試算では短期譲渡の39.63%を当てています。5年を超える場合の税率は20.315%です。"
          : "5年を超えているため、この試算では長期譲渡の20.315%を当てています。"
    }</p>
    ${
      c.taxStart != null
        ? `<p class="legend-note">売却価格が ${man(c.taxStart)} を超えたところから、譲渡所得税がかかりはじめます。</p>`
        : '<p class="legend-note">いまの条件では、価格を上げても譲渡所得税はかかりません。</p>'
    }`;
}

const STAGE_HINT = {
  guess: "査定はまだ頼まなくていい段階です。先に相場の当たりをつけて、幅で手取りを見てください。",
  quoted: "もらった査定額を売却価格に入れてください。その額で決まるとは限らないので、下振れも一緒に見ます。",
  listed: "いまの売り出し価格を入れてください。どこまで下げられるかの下限が出ます。",
  contracted: "契約した価格を入れてください。ここから効くのは税金と、申告に要る書類の準備だけです。",
};

/* --- 相場 --- */

function casesPanelHtml() {
  const state = casesState(S.casePref);
  const prefName = PREFECTURES.find((p) => p.code === S.casePref)?.name || "";

  const head = `<div class="grid-inputs tight">
      <label>都道府県
        <select data-select="casePref">
          ${PREFECTURES.map(
            (p) => `<option value="${p.code}"${p.code === S.casePref ? " selected" : ""}>${p.name}</option>`
          ).join("")}
        </select>
      </label>
      <label>市区町村
        <select data-select="caseCity"${state.status === "ready" ? "" : " disabled"}>
          ${
            state.status === "ready"
              ? cityList(state.data)
                  .map((c) => `<option value="${c.code}"${c.code === S.caseCity ? " selected" : ""}>${esc(c.name)}</option>`)
                  .join("")
              : '<option>—</option>'
          }
        </select>
      </label>
    </div>`;

  if (state.status === "loading") return `${head}<p class="hint">読み込んでいます…</p>`;
  if (state.status !== "ready") {
    return `${head}
      <p class="legal-lead">${prefName}の取引事例はまだ同梱されていません。㎡単価か固定資産税評価額から当たりをつけてください。事例は国土交通省「不動産情報ライブラリ」から取得し、アプリに同梱します（<code>scripts/fetch-cases.mjs</code>）。</p>`;
  }

  const kinds = availableKinds(state.data, S.caseCity);
  if (!kinds.length) {
    return `${head}<p class="legal-lead">この市区町村の事例は同梱されていません。別の市区町村を選ぶか、㎡単価から当たりをつけてください。</p>`;
  }

  const kindSeg = `<div class="row est-row">
      <span class="row-label">種類</span>
      <div class="seg small" role="group" aria-label="物件の種類">
        ${kinds.map((k) => `<button type="button" data-set="caseKind" data-value="${k.id}">${k.label}</button>`).join("")}
      </div>
    </div>`;

  const bucket = bucketOf(state.data, S.caseCity, S.caseKind);
  if (!bucket) return `${head}${kindSeg}<p class="hint">この種類の事例はありません。</p>`;

  const spread = spreadSummary(bucket);
  const cases = bucket.cases
    .map(
      (c, i) => `<button type="button" class="case-item${i === num(S.casePicked) ? " is-on" : ""}" data-case="${i}">
        <span class="case-place">${esc(c.d || "地区名なし")}<em>${esc(c.t || "")}</em></span>
        <span class="case-spec">${esc(caseLabel(c))}</span>
        <b class="case-unit">${unitPriceMan(c).toLocaleString("ja-JP")}<i>万円/㎡</i></b>
        <span class="case-total">総額 ${manShort(c.p)}</span>
      </button>`
    )
    .join("");

  return `${head}${kindSeg}
    <p class="hint">直近${esc(state.data.years || "")}年の取引から、安い順に並べています。同じ市区町村でも ${man(
      spread.low
    )}/㎡ から ${man(spread.high)}/㎡ まで開きがあります（中央値 ${man(spread.median)}/㎡、母数 ${spread.count.toLocaleString(
      "ja-JP"
    )}件）。自分の物件に近いものを選んでください。</p>
    <div class="case-list">${cases}</div>
    <p class="legal-lead">出典：${esc(state.data.source || "国土交通省　不動産情報ライブラリ")}（${esc(
      state.data.generated || ""
    )} 取得）<br />${esc(state.data.attribution || "")}<br />${esc(
      state.data.note || ""
    )}選んだ事例の㎡単価に、入力された面積を掛けています。個別の物件を評価したものではありません。<br />本サービスは TethTechLabs が開発・運営するものであり、国土交通省が提供・保証するものではありません。</p>`;
}

function estPanelHtml() {
  if (S.estMethod === "cases") {
    return `${casesPanelHtml()}
      <div class="row est-row">
        <span class="row-label">面積の単位</span>
        ${segment("areaUnit", [{ id: "sqm", label: "㎡" }, { id: "tsubo", label: "坪" }], "面積の単位")}
      </div>
      <div class="grid-inputs tight">
        ${field("areaSqm", "自分の物件の面積", { unit: S.areaUnit === "tsubo" ? "坪" : "㎡", step: "1" })}
        ${field("unitPriceMan", "当てはめる㎡単価", { unit: "万円/㎡", step: "1" })}
      </div>`;
  }
  if (S.estMethod === "assessed") {
    return `<div class="grid-inputs tight">
        ${field("assessedMan", "固定資産税評価額（土地＋建物）", { unit: "万円", step: "10" })}
      </div>
      <p class="hint">毎年春に届く固定資産税の納税通知書に書いてあります。評価額は時価のおおむね<b>7割</b>を目安に決められているので、0.7で割り戻します。評価は3年ごとの見直しなので、値動きの速い地域では実勢とずれます。</p>`;
  }
  if (S.estMethod === "rosenka") {
    return `<div class="grid-inputs tight">
        ${field("rosenkaMan", "相続税路線価による土地の評価額", { unit: "万円", step: "10" })}
      </div>
      <p class="hint">路線価（円/㎡）×面積で出した額を入れてください。路線価は時価のおおむね<b>8割</b>を目安に決められているので、0.8で割り戻します。これは土地だけの値なので、建物に価値が残っているなら別に足す必要があります。</p>`;
  }
  const area = S.areaUnit === "tsubo" ? tsuboToSqm(num(S.areaSqm)) : num(S.areaSqm);
  return `<div class="row est-row">
      <span class="row-label">面積の単位</span>
      ${segment("areaUnit", [{ id: "sqm", label: "㎡" }, { id: "tsubo", label: "坪" }], "面積の単位")}
    </div>
    <div class="grid-inputs tight">
      ${field("areaSqm", "面積", { unit: S.areaUnit === "tsubo" ? "坪" : "㎡", step: "1" })}
      ${field("unitPriceMan", "近隣の㎡単価", { unit: "万円/㎡", step: "1" })}
    </div>
    <p class="hint">${
      S.areaUnit === "tsubo"
        ? `${num(S.areaSqm)}坪 は ${area.toFixed(1)}㎡ です。単価は㎡あたりで入れてください。`
        : `坪単価しか分からないときは、坪単価÷3.31が㎡単価です。`
    }マンションは専有面積、戸建ては土地と建物で単価が違うので、事例と同じ数え方に揃えてください。</p>`;
}

/* --- 幅 --- */

const STAGE_BAND = {
  guess: {
    title: "この辺りかもしれない、という幅",
    sub: "まだ当たりが粗い段階なので、広めに振ってあります。まず幅で掴んでください。",
  },
  quoted: {
    title: "査定額どおりに決まるとは限らない",
    sub: "査定額を中心に、下振れと上振れを置いています。下がったときに持ち出しにならないかを先に見ます。",
  },
  listed: {
    title: "指値が入る前提で見る",
    sub: "売り出し価格から交渉で下がるのが普通です。どこまで下げられるかの下限も見ておきます。",
  },
  contracted: {
    title: "価格は決まっている",
    sub: "契約が済んでいるので、ここから動くのは税金だけです。",
  },
};

function bandHtml(c) {
  const copy = STAGE_BAND[S.stage] || STAGE_BAND.guess;
  if (S.stage === "contracted") {
    return `<p class="panel-note">${copy.sub}この価格での手取りは <b>${man(
      c.r.net
    )}</b> です。手取りを増やす余地は、取得費をいくらで出せるかと、使える特例があるかどうかに絞られます。</p>`;
  }
  const cells = c.scenarios
    .map((sc) => {
      const short = sc.r.net < 0;
      // 不足のときも数字そのもの（マイナス）を出す。「不足 149万」だと桁で折り返す。
      return `<div class="band-cell ${sc.id === "mid" ? "is-current" : ""}">
        <span>${sc.label}</span>
        <b class="band-price">${manShort(sc.price)}</b>
        <em class="${short ? "is-warn" : ""}">${manShort(sc.r.net)}</em>
        <i>${short ? "持ち出し" : "手取り"}</i>
      </div>`;
    })
    .join("");

  const spread = c.scenarios[2].r.net - c.scenarios[0].r.net;
  return `<div class="band">${cells}</div>
    <div class="grid-inputs tight">
      ${field("rangeDownPct", "下振れ", { unit: "%", step: "1" })}
      ${field("rangeUpPct", "上振れ", { unit: "%", step: "1" })}
    </div>
    <p class="legend-note">単位は万円。上段が売れた価格、下段がそのときの手取り。この幅の中で手取りは <b>${man(
      spread
    )}</b> 動きます。買取業者に売るなら、仲介の相場の6〜8割が目安です。</p>`;
}

/* --- 注意点 --- */

function notesHtml(c) {
  const sections = LEVELS.map((lv) => {
    const items = c.notes.filter((n) => n.level === lv.id);
    if (!items.length) return "";
    return `<section class="panel note-group is-${lv.id}" aria-labelledby="h-n-${lv.id}">
        <div class="panel-head">
          <h2 id="h-n-${lv.id}">${lv.label}<span class="note-count">${items.length}</span></h2>
        </div>
        ${items
          .map(
            (n) => `<article class="note">
              <h3>${n.title}</h3>
              <p>${n.body}</p>
            </article>`
          )
          .join("")}
      </section>`;
  }).join("");
  return sections;
}

function condGridHtml(c) {
  const pairs = [
    ["売却価格", man(c.input.priceYen)],
    ["ローン残債", man(c.input.loanBalanceYen)],
    ["所有期間（1月1日基準）", `${c.input.heldYears.toFixed(1)}年`],
    ["3,000万円控除", c.r.deductionCap > 0 ? "適用" : "なし"],
  ];
  return pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

function shareData(c) {
  const r = c.r;
  const short = r.net < 0;
  return {
    dateLabel: TODAY_LABEL,
    netLabel: short ? "用意する現金" : "手元に残る額",
    net: man(short ? r.shortfall : r.net),
    shortfall: short,
    breakEven: c.breakEven == null ? "" : man(c.breakEven),
    rows: [
      ["売却価格", man(r.price)],
      ["諸費用", man(r.costs.total)],
      ["ローン残債", man(r.loan)],
      ["譲渡所得税", man(r.tax.total)],
    ],
    disclaimer:
      "入力条件に基づく試算です。実際の成約価格・税額・費用を保証するものではありません。税務の取扱いは税理士または税務署へご確認ください。",
    url: APP_URL,
  };
}

/* ------------------------------------------------------------ 描画 */

const FOCUS_KEY_ATTRS = ["data-field", "data-extra-label", "data-extra-man"];

/**
 * innerHTML を丸ごと差し替える再描画は、入力中の欄も一緒に作り直してしまい
 * フォーカスが外れてスマホのキーボードが閉じる。差し替え前後で同じ欄を
 * data属性で見つけ直し、フォーカスとカーソル位置を戻す。
 */
function replacePreservingFocus(el, html) {
  const active = document.activeElement;
  if (!el.contains(active)) {
    el.innerHTML = html;
    return;
  }
  let selector = null;
  for (const attr of FOCUS_KEY_ATTRS) {
    if (active.hasAttribute(attr)) {
      selector = `[${attr}="${CSS.escape(active.getAttribute(attr))}"]`;
      break;
    }
  }
  let selStart = null;
  let selEnd = null;
  try {
    selStart = active.selectionStart;
    selEnd = active.selectionEnd;
  } catch {}
  el.innerHTML = html;
  const next = selector ? el.querySelector(selector) : null;
  if (next) {
    next.focus();
    if (selStart != null) {
      try {
        next.setSelectionRange(selStart, selEnd);
      } catch {}
    }
  }
}

function update() {
  const c = compute();
  current = c;
  const r = c.r;
  const short = r.net < 0;

  out.heroLabel.textContent = short ? "用意する現金" : "手元に残る額";
  out.heroNet.textContent = man(short ? r.shortfall : r.net);
  out.heroNet.classList.toggle("is-warn", short);
  out.heroBreak.textContent = c.breakEven == null ? "—" : man(c.breakEven);
  out.heroCosts.textContent = man(r.costs.total);
  out.heroLoan.textContent = man(r.loan);
  out.heroTax.textContent = man(r.tax.total);

  out.loanHint.textContent =
    r.loan > 0
      ? `売却価格が ${c.breakEven == null ? "—" : man(c.breakEven)} を下回ると、差額を現金で用意しないと引き渡せません。`
      : "残債がなければ、売却価格から費用と税金を引いた額がそのまま残ります。";

  const oy = ownedYears();
  const ty = taxYears();
  out.ownedLabel.textContent = `${oy.toFixed(1)}年`;
  out.taxYearsLabel.textContent = `${ty.toFixed(1)}年`;

  const crossesShort = oy > 5 && ty <= 5;
  const crossesLong = oy > 10 && ty <= 10;
  out.termHint.innerHTML = crossesShort
    ? "実際は5年を超えて持っていますが、<b>1月1日基準ではまだ5年以下</b>です。税率は39.63%のまま。売る年を翌年にずらすと20.315%になり、税額はおよそ半分になります。"
    : crossesLong
      ? "実際は10年を超えていますが、<b>1月1日基準ではまだ10年以下</b>です。翌年に売れば、6,000万円までの部分に14.21%の軽減税率が使えます。"
      : `税率の判定は ${ty.toFixed(1)}年 で行います。減価償却の経過年数は実際の ${oy.toFixed(1)}年 で数えます。`;

  out.taxHint.textContent = S.isResidence
    ? `譲渡益から最大 ${man(RESIDENTIAL_DEDUCTION)} を引けます。前年・前々年に同じ特例を受けている場合や、住まなくなって3年経った年の年末を過ぎた場合は使えません。`
    : "投資用・別荘・相続した空き家などは居住用の特例の対象外です。空き家の特例は要件が別にあるため、このツールでは扱っていません。";

  replacePreservingFocus(out.purchasePanel, purchasePanelHtml());
  const depHint = app.querySelector('[data-out="depHint"]');
  if (depHint) {
    depHint.innerHTML =
      r.acquisition.depreciation > 0
        ? `${oy.toFixed(1)}年ぶんの減価償却 <b>${yen(r.acquisition.depreciation)}</b> を引いた取得費は <b>${yen(r.acquisition.total)}</b> です。`
        : `取得費は <b>${yen(r.acquisition.total)}</b> です。`;
  }

  replacePreservingFocus(out.costs, costsHtml(c));
  ensureCases();
  replacePreservingFocus(out.estPanel, estPanelHtml());
  out.estValue.textContent = man(estimatedPriceYen());

  const bandCopy = STAGE_BAND[S.stage] || STAGE_BAND.guess;
  out.bandTitle.textContent = bandCopy.title;
  out.bandSub.textContent = bandCopy.sub;
  replacePreservingFocus(out.band, bandHtml(c));

  out.stageHint.textContent = STAGE_HINT[S.stage] || "";
  out.notes.innerHTML = notesHtml(c);
  const counts = countByLevel(c.notes);
  out.noteBadge.textContent = counts.danger > 0 ? String(counts.danger) : "";
  out.noteBadge.classList.toggle("is-danger", counts.danger > 0);

  out.answer.innerHTML = answerHtml(c);
  out.flowTable.innerHTML = flowTableHtml(c);
  out.matrix.innerHTML = matrixHtml(c);
  out.taxPanel.innerHTML = taxPanelHtml(c);

  const steps = [
    { label: "売却価格", value: r.price, type: "start" },
    { label: "諸費用", value: -r.costs.total, type: "minus" },
    { label: "残債", value: -r.loan, type: "minus" },
    { label: "税金", value: -r.tax.total, type: "minus" },
    { label: short ? "不足" : "手取り", value: r.net, type: "total" },
  ];
  out.waterfall.innerHTML = waterfallChart(steps);
  out.proceeds.innerHTML = proceedsChart(c.rows, { current: r.price, breakEven: c.breakEven });
  out.proceedsReadout.textContent = `いまは ${man(r.price)} で試算中。手元に残るのは ${man(r.net)}。`;

  out.condDate.textContent = `${TODAY_LABEL} 時点`;
  out.condGrid.innerHTML = condGridHtml(c);

  setStates();
  save();
}

function syncAll() {
  syncSlider("priceMan");
  syncSlider("loanMan");
  update();
}

/* ------------------------------------------------------------ 入力 */

function setKey(key, value) {
  const b = BOUNDS[key];
  let v = num(value);
  if (b) {
    const step = key === "priceMan" ? num(S.priceStep) : 10;
    v = clamp(Math.round(v / step) * step, b.min, b.max);
  }
  S[key] = v;
  syncAll();
}

app.addEventListener("input", (e) => {
  const range = e.target.closest(".range");
  if (range) {
    dragging = true;
    setKey(range.id.replace("r-", ""), range.value);
    return;
  }
  const f = e.target.closest("[data-field]");
  if (f) {
    S[f.dataset.field] = f.value === "" ? "" : num(f.value);
    update();
    return;
  }
  const label = e.target.closest("[data-extra-label]");
  if (label) {
    const items = extrasCopy();
    const i = Number(label.dataset.extraLabel);
    if (items[i]) items[i].label = label.value;
    S.extras = items;
    update();
    return;
  }
  const amount = e.target.closest("[data-extra-man]");
  if (amount) {
    const items = extrasCopy();
    const i = Number(amount.dataset.extraMan);
    if (items[i]) items[i].man = amount.value === "" ? "" : num(amount.value);
    S.extras = items;
    update();
  }
});

let dragging = false;

app.addEventListener("change", (e) => {
  if (e.target.closest(".range")) {
    dragging = false;
    update();
    return;
  }
  const select = e.target.closest("[data-select]");
  if (select) {
    S[select.dataset.select] = select.value;
    if (select.dataset.select === "casePref") {
      // 都道府県が変われば市区町村も種別も選び直しになる。
      S.caseCity = "";
      S.casePicked = -1;
    }
    if (select.dataset.select === "caseCity") S.casePicked = -1;
    const state = casesState(S.casePref);
    if (state.status === "ready") {
      const cities = cityList(state.data);
      if (!cities.some((c) => c.code === S.caseCity)) S.caseCity = cities[0]?.code || "";
      const kinds = availableKinds(state.data, S.caseCity);
      if (!kinds.some((k) => k.id === S.caseKind)) S.caseKind = kinds[0]?.id || "mansion";
    }
    update();
  }
});

/* ± ボタン。押しっぱなしで加速する。 */
let repeatTimer = null;
function startRepeat(fn) {
  fn();
  let delay = 340;
  const tick = () => {
    fn();
    delay = Math.max(28, delay * 0.7);
    repeatTimer = setTimeout(tick, delay);
  };
  repeatTimer = setTimeout(tick, delay);
}

function stopRepeat() {
  clearTimeout(repeatTimer);
  repeatTimer = null;
  if (dragging) {
    dragging = false;
    update();
  }
}
["pointerup", "pointercancel", "blur"].forEach((ev) => window.addEventListener(ev, stopRepeat, true));

app.addEventListener("pointerdown", (e) => {
  const nudge = e.target.closest("[data-nudge]");
  if (nudge) {
    const key = nudge.closest(".ctrl").dataset.key;
    const dir = Number(nudge.dataset.nudge);
    const step = key === "priceMan" ? num(S.priceStep) : 10;
    startRepeat(() => setKey(key, num(S[key]) + dir * step));
  }
});

app.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto]");
  if (goto) {
    setScreen(goto.dataset.goto);
    return;
  }
  if (e.target.closest("[data-back]")) {
    setScreen(lastMain);
    return;
  }
  const step = e.target.closest("[data-step]");
  if (step && !step.disabled) {
    // 結果から「条件を直す」を押したら、手順の最後（特例の画面）へ戻す。
    goStep(Number(step.dataset.step));
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    S.resultTab = tab.dataset.tab;
    applyResultTab();
    save();
    return;
  }
  const picked = e.target.closest("[data-case]");
  if (picked) {
    const i = Number(picked.dataset.case);
    const state = casesState(S.casePref);
    const bucket = state.status === "ready" ? bucketOf(state.data, S.caseCity, S.caseKind) : null;
    const c = bucket?.cases?.[i];
    if (c) {
      S.casePicked = i;
      // 選んだ事例の㎡単価を当てはめる。面積は利用者自身のものを使う。
      S.unitPriceMan = unitPriceMan(c);
      update();
    }
    return;
  }
  const set = e.target.closest("[data-set]");
  if (set) {
    S[set.dataset.set] = set.dataset.value;
    if (set.dataset.set === "caseKind") S.casePicked = -1;
    if (set.dataset.set === "theme" || set.dataset.set === "palette") applyPrefs();
    if (set.dataset.set === "stage") {
      // 段階が変われば、妥当な振れ幅も、通る手順そのものも変わる。
      const range = STAGE_RANGE[S.stage] || STAGE_RANGE.guess;
      S.rangeDownPct = range.down;
      S.rangeUpPct = range.up;
      applyScreen();
    }
    update();
    return;
  }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle && !toggle.disabled) {
    S[toggle.dataset.toggle] = !S[toggle.dataset.toggle];
    update();
    return;
  }
  const preset = e.target.closest("[data-preset]");
  if (preset) {
    setKey(preset.dataset.preset, preset.dataset.value);
    return;
  }
  const stepFor = e.target.closest("[data-step-for]");
  if (stepFor) {
    S.priceStep = num(stepFor.dataset.value);
    syncAll();
    return;
  }
  const add = e.target.closest("[data-extra-add]");
  if (add) {
    const items = extrasCopy();
    if (items.length < EXTRA_MAX) {
      const key = add.dataset.extraAdd;
      items.push(key === "blank" ? { label: "", man: "", deductible: false } : { ...EXTRA_PRESETS[Number(key)] });
      S.extras = items;
      update();
    }
    return;
  }
  const del = e.target.closest("[data-extra-del]");
  if (del) {
    const items = extrasCopy();
    items.splice(Number(del.dataset.extraDel), 1);
    S.extras = items;
    update();
    return;
  }
  const ded = e.target.closest("[data-extra-ded]");
  if (ded) {
    const items = extrasCopy();
    const i = Number(ded.dataset.extraDed);
    if (items[i]) items[i].deductible = !items[i].deductible;
    S.extras = items;
    update();
    return;
  }
  const share = e.target.closest("[data-share]");
  if (share) handleShare(share.dataset.share);
});

/* ------------------------------------------------------------ なぞって読む */

function scrub(svg, clientX) {
  if (!current) return;
  const rows = current.rows;
  const i = indexFromPointer(svg, clientX, rows.length);
  const row = rows[i];
  const line = svg.querySelector(".scrub-line");
  if (line) {
    const x = xForIndex(i, rows.length);
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.style.opacity = "1";
  }
  out.proceedsReadout.textContent = `${man(row.price)}で売れたら、手元に残るのは ${man(row.net)}${
    row.tax > 0 ? `（うち税金 ${man(row.tax)}）` : ""
  }`;
}

app.addEventListener("pointermove", (e) => {
  const svg = e.target.closest('[data-out="proceeds"] .chart');
  if (svg) scrub(svg, e.clientX);
});
app.addEventListener("pointerdown", (e) => {
  const svg = e.target.closest('[data-out="proceeds"] .chart');
  if (svg) scrub(svg, e.clientX);
});
app.addEventListener("pointerleave", () => {
  const line = out.proceeds.querySelector(".scrub-line");
  if (line) line.style.opacity = "0";
}, true);

/* ------------------------------------------------------------ 共有 */

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (k) => cs.getPropertyValue(k).trim();
  return {
    bg: g("--surface"),
    ink: g("--ink"),
    muted: g("--muted"),
    faint: g("--faint"),
    line: g("--line"),
    accent: g("--accent"),
    warm: g("--warm"),
  };
}

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * 共有ボタンの処理。画像は DOM のスクリーンショットではなく、
 * 必要な数字だけを Canvas に描き直したもの。誤解を招く要素は持ち込まない。
 */
async function handleShare(kind) {
  if (!current) return;
  const status = out.shareStatus;
  const data = shareData(current);
  const title = "住宅売却の手取り試算";

  if (kind === "text") {
    try {
      await navigator.clipboard.writeText(buildShareText(data));
      status.textContent = "条件をコピーしました。LINEなどに貼り付けられます。";
    } catch {
      status.textContent = "コピーに対応していない端末です。数字を手動で伝えてください。";
    }
    return;
  }

  const canvas = buildShareCanvas(data, themeColors());
  canvas.toBlob(async (blob) => {
    if (!blob) {
      status.textContent = "画像の作成に失敗しました。";
      return;
    }
    const filename = `住宅売却試算_${todayStamp()}.png`;

    if (kind === "native") {
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title, text: buildShareText(data) });
          status.textContent = "共有しました。";
          return;
        } catch {
          return; // ユーザーが共有をキャンセルしただけの場合が多い。何もしない。
        }
      }
      if (navigator.share) {
        try {
          await navigator.share({ title, text: buildShareText(data) });
          status.textContent = "共有しました。";
          return;
        } catch {
          return;
        }
      }
      try {
        await navigator.clipboard.writeText(buildShareText(data));
        status.textContent = "この端末は共有に対応していません。条件をコピーしました。";
      } catch {
        status.textContent = "この端末は共有に対応していません。";
      }
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status.textContent = "画像を保存しました。";
  }, "image/png");
}

/* ------------------------------------------------------------ 起動 */

applyPrefs();
applyScreen();
applyResultTab();
syncAll();

if (globalThis.Capacitor?.isNativePlatform?.()) {
  import("./ads-native.js")
    .then((m) => m.initNativeAds())
    .catch(() => {});
}
