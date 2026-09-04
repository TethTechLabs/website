import {
  simulate,
  breakEvenPrice,
  taxStartPrice,
  priceMatrix,
  brokerageCap,
  priceFromUnit,
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
import { sellingNotes, LEVELS, countByLevel } from "./notes.js";
import {
  PREFECTURES,
  KINDS as CASE_KINDS,
  casesState,
  indexState,
  loadCases,
  loadIndex,
  prefIsListed,
  cityList,
  bucketOf,
  availableKinds,
  caseLabel,
  unitPriceMan,
  unitPriceManLabel,
  spreadSummary,
  isThinSample,
} from "./cases.js";

const NOW = new Date();
const TODAY_LABEL = NOW.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });

const STORAGE_KEY = "sale-sim-v1";

/**
 * 共有テキストに載せる公開URL。受け取った人がここから試算に来られるようにする。
 * ストアアプリ版では location が capacitor:// などになるため、実行時ではなく定数で持つ。
 */
const APP_URL = "https://tethtechlabs.com/apps/jutaku-sale/";

const AREA_DEFAULTS = { mansion: 70, house: 110, land: 150 };

const defaults = {
  ver: 2,
  priceMan: "",
  priceStep: 50,
  loanMan: "",
  hasLoan: "",

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
  releaseJudicialMan: "",
  prepayFeeMan: "",
  extras: [],

  // 取得費。分かる／分からないは選ばせる。未選択のまま既定の購入代金を使わない。
  purchaseKnown: "",
  purchaseLandMan: "",
  purchaseBuildingMan: "",
  purchaseCostMan: "",
  structure: "",

  // 査定の状況。id は notes.js の STAGES と同じ。未選択から始める。
  stage: "",
  coOwned: "",
  inherited: "",

  // 相場の当たりのつけかた
  estMethod: "cases",
  casePref: "13",
  caseCity: "",
  caseKind: "mansion",
  casePicked: -1,
  areaUnit: "sqm",
  areaSqm: AREA_DEFAULTS.mansion,
  unitPriceMan: "",
  touched: {
    price: false,
    loan: false,
    purchaseKnown: false,
    area: false,
  },

  // 売り出してから決まるまでの幅
  rangeUpPct: 8,
  rangeDownPct: 12,

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

function asYesNo(v) {
  if (v === true || v === "yes") return "yes";
  if (v === false || v === "no") return "no";
  return "";
}

function isYes(v) {
  return asYesNo(v) === "yes";
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults, touched: { ...defaults.touched } };
    const saved = JSON.parse(raw);
    // 以前の版で保存したものは、すでに入力済みとして扱う。
    const legacy = saved.ver == null;
    const next = { ...defaults, ...saved, ver: 2 };
    next.hasLoan = asYesNo(saved.hasLoan !== undefined ? saved.hasLoan : legacy ? saved.loanMan > 0 : "");
    next.purchaseKnown = asYesNo(saved.purchaseKnown);
    next.coOwned = asYesNo(saved.coOwned);
    next.inherited = asYesNo(saved.inherited);
    next.touched = {
      ...defaults.touched,
      ...(saved.touched || {}),
    };
    if (legacy) {
      next.touched = { price: true, loan: true, purchaseKnown: true, area: true };
      if (!next.stage) next.stage = "guess";
      if (!next.hasLoan) next.hasLoan = num(next.loanMan) > 0 ? "yes" : "no";
      if (!next.purchaseKnown) next.purchaseKnown = saved.purchaseKnown === false ? "no" : "yes";
      if (!saved.structure) next.structure = "wood";
    }
    if (next.stage === "listed" || next.stage === "contracted") next.stage = "quoted";
    if (next.estMethod === "assessed" || next.estMethod === "rosenka") next.estMethod = "cases";
    return next;
  } catch {
    return { ...defaults, touched: { ...defaults.touched } };
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
  return priceFromUnit(area, toYen(S.unitPriceMan));
}

/** 事例データを読み、読み終わったら描き直す。市区町村が未選択なら先頭を入れる。 */
function ensureCases() {
  const idx = indexState();
  if (idx.status === "idle") {
    loadIndex(() => update());
    return;
  }
  if (idx.status === "loading") return;
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
  const hasLoan = isYes(S.hasLoan);
  const known = isYes(S.purchaseKnown);
  return {
    priceYen: toYen(S.priceMan),
    loanBalanceYen: hasLoan ? toYen(S.loanMan) : 0,

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

    purchaseKnown: known,
    purchaseLandYen: known ? toYen(S.purchaseLandMan) : 0,
    purchaseBuildingYen: known ? toYen(S.purchaseBuildingMan) : 0,
    purchaseCostYen: known ? toYen(S.purchaseCostMan) : 0,
    structure: S.structure,
    elapsedYears: ownedYears(),

    heldYears: taxYears(),
    isResidence: Boolean(S.isResidence),
    useDeduction: Boolean(S.useDeduction),
    useReduced10: Boolean(S.useReduced10),
    ...overrides,
  };
}

function purchaseIncomplete() {
  return isYes(S.purchaseKnown) && (S.purchaseLandMan === "" || S.purchaseBuildingMan === "" || !S.structure);
}

// ローンありなのに残高が未入力なら、売却価格のページから先へ進ませない。
function sellIncomplete() {
  return isYes(S.hasLoan) && (S.loanMan === "" || S.loanMan == null);
}

function inputsReady() {
  const t = S.touched || {};
  const priceOk = t.price && num(S.priceMan) > 0;
  const loanOk = t.loan && (isYes(S.hasLoan) ? S.loanMan !== "" : asYesNo(S.hasLoan) === "no");
  const known = asYesNo(S.purchaseKnown);
  const amountsOk =
    known === "no" ||
    (known === "yes" && S.purchaseLandMan !== "" && S.purchaseBuildingMan !== "" && S.structure);
  const costOk = t.purchaseKnown && known !== "" && amountsOk;
  return priceOk && loanOk && costOk;
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
      stage: S.stage || "guess",
      inherited: isYes(S.inherited),
      coOwned: isYes(S.coOwned),
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

function segment(key, options, aria, cls = "") {
  return `<div class="seg small${cls ? ` ${cls}` : ""}" role="group" aria-label="${aria}">
    ${options.map((o) => `<button type="button" data-set="${key}" data-value="${o.id}">${o.label}</button>`).join("")}
  </div>`;
}

/** 種別の線画。色は .seg の currentColor に乗せる。 */
const KIND_ICONS = {
  mansion:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="1"/><path d="M3 20h18"/><path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>',
  house:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5"/><path d="M6 10.5V20h12v-9.5"/><path d="M10 20v-5h4v5"/></svg>',
  land:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5 20 4v16L4 20.5z"/><path d="M4 13h16"/></svg>',
};

function kindSegHtml(kinds, aria = "物件の種類") {
  return `<div class="seg small kinds" role="group" aria-label="${aria}">
    ${kinds
      .map(
        (k) =>
          `<button type="button" data-set="caseKind" data-value="${k.id}">${KIND_ICONS[k.id] || ""}<span>${k.label}</span></button>`
      )
      .join("")}
  </div>`;
}

const AD_SLOT = "8443825124";
const AD_CLIENT = "ca-pub-9222260774149288";

function adSlotHtml(id) {
  return `<div class="ad-slot" data-ad-slot="${id}" aria-hidden="true"></div>`;
}

function fillAdSlots() {
  const panel = document.querySelector(`[data-screen-panel="${screen}"]`);
  if (!panel || panel.hidden) return;
  for (const slot of panel.querySelectorAll(".ad-slot:not(.ad-filled)")) {
    slot.classList.add("ad-filled");
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.dataset.adClient = AD_CLIENT;
    ins.dataset.adSlot = slot.dataset.adSlot;
    ins.dataset.adFormat = "auto";
    ins.dataset.fullWidthResponsive = "true";
    slot.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }
}

/* ------------------------------------------------------------ 画面 */

function scaffold() {
  return `
    <header class="hero" id="hero">
      <div class="hero-main">
        <p class="hero-label" data-out="heroLabel">手元に残る額（想定）</p>
        <p class="hero-value" data-out="heroNet">—</p>
      </div>
      <dl class="hero-stats">
        <div><dt>諸費用</dt><dd data-out="heroCosts">—</dd></div>
        <div><dt>ローン残高</dt><dd data-out="heroLoan">—</dd></div>
        <div><dt>譲渡所得税</dt><dd data-out="heroTax">—</dd></div>
      </dl>
    </header>

    <div class="screen-scroll" data-screen-scroll>
    <div class="screen" data-screen-panel="stage">
      <section class="panel" aria-labelledby="h-intro">
        <div class="panel-head">
          <h2 id="h-intro">不動産売却時のシミュレーション</h2>
          <p class="panel-sub">不動産の売却を考えている際のシミュレーションツールです。あくまで概算の試算であり、一般的な計算方法に基づくものです。詳細は必ず<a href="./disclaimer.html">免責事項</a>をご確認ください。</p>
        </div>
        <p class="product-stance">登録は不要です。入力した内容は端末の中だけに保存され、当方のサーバーには送りません。</p>
      </section>
      <section class="panel" aria-labelledby="h-prep">
        <div class="panel-head">
          <h2 id="h-prep">事前チェック</h2>
          <p class="panel-sub">今の状況を入力してください。</p>
        </div>

        <div class="check-block">
          <h3>所有権</h3>
          <div class="seg even" role="group" aria-label="所有権">
            <button type="button" data-set="coOwned" data-value="no">本人</button>
            <button type="button" data-set="coOwned" data-value="yes">共有名義</button>
          </div>
        </div>
        <div class="check-block">
          <h3>不動産の取得方法</h3>
          <div class="seg even" role="group" aria-label="不動産の取得方法">
            <button type="button" data-set="inherited" data-value="no">自身で購入</button>
            <button type="button" data-set="inherited" data-value="yes">相続・贈与</button>
          </div>
        </div>
        <div class="check-block">
          <h3>ローンの有無</h3>
          <div class="seg even" role="group" aria-label="ローンの有無">
            <button type="button" data-set="hasLoan" data-value="yes">あり</button>
            <button type="button" data-set="hasLoan" data-value="no">なし</button>
          </div>
        </div>
        <div class="check-block">
          <h3>不動産業者への査定依頼の有無</h3>
          <div class="seg even" role="group" aria-label="不動産業者への査定依頼の有無">
            <button type="button" data-set="stage" data-value="guess">査定はしていない</button>
            <button type="button" data-set="stage" data-value="quoted">査定済み</button>
          </div>
          <p class="hint" data-out="stageHint"></p>
        </div>
        <div class="check-block">
          <h3>用意するもの</h3>
          <p class="hint">あればより適切な試算ができます</p>
          <ul class="prep-list" data-out="prepList"></ul>
        </div>
      </section>
      ${adSlotHtml(AD_SLOT)}
    </div>

    <div class="screen" data-screen-panel="sell">
      <section class="panel" aria-labelledby="h-sell">
        <div class="panel-head">
          <h2 id="h-sell">売却価格とローン残高</h2>
          <p class="panel-sub">前のページで選んだ取引事例などを参考に売却価格を想定します。任意で金額を変えることもできます。</p>
        </div>
        <p class="field-error" data-out="sellError" hidden></p>
      </section>
      <section class="controls" aria-label="売却の条件">
        ${sliderCard({
          key: "priceMan",
          label: "売却価格（想定）",
          hint: "査定額や相場から",
          unit: "万円",
          scale: ["50万", "3億"],
          picker: stepPicker("priceMan", PRICE_STEPS, (v) => `${v}万`),
        })}
        <div class="ctrl" data-loan-box>
          <div class="ctrl-head">
            <span class="ctrl-label">ローン残高</span>
            <span class="ctrl-hint">売却予定時期の想定残高</span>
          </div>
          <div data-out="loanBox"></div>
        </div>
      </section>
      ${adSlotHtml(AD_SLOT)}
    </div>

    <div class="screen" data-screen-panel="basis">
      <section class="panel" aria-labelledby="h-buy">
        <div class="panel-head">
          <h2 id="h-buy">取得費</h2>
          <p class="panel-sub">不動産を購入した際の金額です。売買契約書が手元にあれば入れてください。分からないときは、売却価格の5%を取得費とみなして計算します。この差で税額は大きく変わります。</p>
        </div>
        <div class="check-block">
          <h3>購入時の金額</h3>
          <div class="seg even" role="group" aria-label="購入時の金額が分かるか">
            <button type="button" data-set="purchaseKnown" data-value="yes">わかる</button>
            <button type="button" data-set="purchaseKnown" data-value="no">わからない</button>
          </div>
        </div>
        <div data-out="purchasePanel"></div>
      </section>
      ${adSlotHtml(AD_SLOT)}
    </div>

    <div class="screen" data-screen-panel="tax">
      <section class="panel" aria-labelledby="h-when">
        <div class="panel-head">
          <h2 id="h-when">税金試算の条件</h2>
          <p class="panel-sub">税率の分かれ目は「売却した年の1月1日時点で何年所有していたか」で決まります。</p>
        </div>
        <h3>不動産の取得時期と売却時期</h3>
        <div class="grid-inputs tight">
          ${field("buyYear", "取得した年", { unit: "年", min: "1950" })}
          ${field("buyMonth", "取得した月", { unit: "月", min: "1" })}
          ${field("sellYear", "売却する年", { unit: "年", min: "1950" })}
          ${field("sellMonth", "売却する月", { unit: "月", min: "1" })}
        </div>
        <div class="minis">
          <div class="mini"><span>実際に所有していた期間</span><b data-out="ownedLabel">—</b></div>
          <div class="mini"><span class="mini-nowrap">税法上の所有期間<small>（1月1日基準）</small></span><b data-out="taxYearsLabel">—</b></div>
        </div>
        <p class="hint" data-out="termHint"></p>
      </section>

      <section class="panel" aria-labelledby="h-special">
        <div class="panel-head">
          <h2 id="h-special">税法上の特例</h2>
          <p class="panel-sub">居住していた住宅を売却する場合は、譲渡益から3,000万円まで引ける特例があります。適用には要件があるので、税務署などでご自身で確かめてください。</p>
        </div>
        <div class="special-stack">
          <div class="special-step">
            ${toggleChip("isResidence", "居住用財産に当たる")}
            <p class="hint">居住用財産とは、自分が住んでいる、または住まなくなってから3年以内の家屋とその敷地です。</p>
          </div>
          <div class="special-step is-dep">
            ${toggleChip("useDeduction", "3,000万円の特別控除を使う")}
          </div>
          <div class="special-step is-dep">
            ${toggleChip("useReduced10", "10年超の軽減税率を使う")}
          </div>
        </div>
        <p class="hint" data-out="taxHint"></p>
        <div class="row">
          <span class="row-label">当てはまるもの</span>
        </div>
        <div class="row">
          ${toggleChip("buyingNext", "売却後に住み替えて、新居でローンを組む")}
        </div>
        <p class="hint">住み替えは税額の計算を変えません。当てはまる場合に見落としやすい点を、注意点として出すために使います。</p>
      </section>
      ${adSlotHtml(AD_SLOT)}
    </div>

    <div class="screen" data-screen-panel="result">
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
          <p class="chart-title">売却価格ごとの手取り</p>
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
      </div>

      <!-- 税額を出す画面には広告を置かない。試算の数字と広告が隣り合うと、
           広告が結果と関係のあるものとして読めてしまう。 -->
      ${affiliateHtml()}
    </div>

    <div class="screen" data-screen-panel="costs">
      <section class="panel" aria-labelledby="h-cost">
        <div class="panel-head">
          <h2 id="h-cost">諸費用</h2>
          <p class="panel-sub">仲介手数料と印紙税は売却価格から自動で出します。実際の金額が決まったら、手入力に切り替えて上書きも可能です。</p>
        </div>
        <div data-out="costs"></div>
      </section>
      ${adSlotHtml(AD_SLOT)}
    </div>

    <div class="screen" data-screen-panel="market">
      <section class="panel" aria-labelledby="h-prop">
        <div class="panel-head">
          <h2 id="h-prop">物件の内容と相場の目安</h2>
          <p class="panel-sub">先に、自分の物件の種別・地域・面積を入れてください。事例と対比するための軸になります。</p>
        </div>
        <h3>物件の内容</h3>
        <div class="est-row kind-row">
          <span class="row-label">種類</span>
          ${kindSegHtml(CASE_KINDS)}
        </div>
        <div class="row est-row">
          <span class="row-label">面積の単位</span>
          ${segment("areaUnit", [{ id: "sqm", label: "㎡" }, { id: "tsubo", label: "坪" }], "面積の単位", "units")}
        </div>
        <div class="grid-inputs tight" data-out="areaField"></div>
      </section>

      <section class="panel" aria-labelledby="h-est">
        <div class="panel-head">
          <h2 id="h-est">相場の目安</h2>
          <p class="panel-sub">データ化している国土交通省の取引価格情報を基に、簡易に相場の目安を把握できます。</p>
        </div>
        <div class="row est-row">
          ${segment("estMethod", EST_METHODS, "当たりのつけかた", "even")}
        </div>
        <div data-out="estPanel"></div>
        <div class="est-result">
          <span>想定価格<em>目安の計算値です</em></span>
          <b data-out="estValue">—</b>
        </div>
        <p class="legal-lead">この数値は入力された条件から機械的に計算した目安であり、不動産の鑑定評価でも査定でもありません。実際に売れる価格を示すものではありません。</p>
      </section>

      <section class="panel ref-panel" aria-labelledby="h-ref">
        <div class="panel-head">
          <h2 id="h-ref">参考（自分で見て戻る）</h2>
          <p class="panel-sub">事例が足りないときだけ。見てきた数字は上の㎡単価に入れてください。</p>
        </div>
        <a class="src-item" href="http://www.contract.reins.or.jp/" target="_blank" rel="noopener">
          <b>レインズ・マーケット・インフォメーション</b>
          <span>成約は多いですが、このアプリには入っていません。自分で見て、㎡単価に戻してください。</span>
        </a>
        <a class="src-item" href="https://www.chikamap.jp/" target="_blank" rel="noopener">
          <b>全国地価マップ</b>
          <span>路線価と固定資産税評価額を地図で引けます。このアプリの試算には使いません。</span>
        </a>
      </section>
      ${adSlotHtml(AD_SLOT)}
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
          <p class="panel-sub">ご家族への共有もできます。</p>
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
        <p><b>前提</b>　抵当権抹消費用とローンの一括返済手数料は、手取りからは引きますが、税法上の譲渡費用には入れていません。3,000万円特別控除と10年超の軽減税率は、適用要件を満たすものとして計算します（前年・前々年に同じ特例を受けている場合など、実際には適用できないことがあります）。相続した空き家の特例、買換え特例、譲渡損失の損益通算・繰越控除には対応していません。住民税は売却の翌年に課税されるため、支払う時期が所得税とずれます。</p>
      </footer>

      <section class="support">
        <h2>制作者について</h2>
        <p>本サービスは、<b>1級ファイナンシャル・プランニング技能士</b>、および<b>宅地建物取引士資格試験合格者</b>が設計しています。</p>
        <p class="support-strong">ただし本サービスは税務相談・法律相談を行うものではありません。<b>個別のご相談はお受けしません。</b>ご自身の物件の価格、税額、特例の適用可否についてのお問い合わせには、お答えできません。税理士・税務署・弁護士・宅地建物取引業者など、それぞれの専門家にご相談ください。</p>
      </section>

      <section class="support">
        <h2>お問い合わせ</h2>
        <p>不具合のご報告、機能に関するご要望はこちらへお願いします。上記のとおり、個別のご相談にはお答えできません。</p>
        <p><a href="mailto:jutaku-sale@tethtechlabs.com">jutaku-sale@tethtechlabs.com</a></p>
        <p class="support-owner">提供：TethTechLabs</p>
      </section>

      <nav class="legal-links" aria-label="関連ページ">
        <a href="./privacy.html">プライバシーポリシー</a>
        <a href="./terms.html">利用規約</a>
        <a href="./disclaimer.html">免責事項</a>
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
  return ["stage", "market", "sell", "costs", "basis", "tax", "result"];
}

const STEP_NEXT_LABEL = {
  market: "この価格で進む",
  tax: "手取りを見る",
};

const STEP_TITLES = {
  stage: "事前チェック",
  market: "物件の内容と相場の目安",
  sell: "売却価格とローン残高",
  costs: "諸費用",
  basis: "取得費",
  tax: "税金試算の条件",
};

/** 手順の外にある画面（共有・設定）。ここでは前後の移動を出さない。 */
const ASIDE = ["share", "settings"];

function setScreen(next) {
  if (!ASIDE.includes(screen)) lastMain = screen;
  screen = next;
  applyScreen();
  const scroller = app.querySelector("[data-screen-scroll]");
  if (scroller) scroller.scrollTo(0, 0);
}

/** 手順を1つ進める・戻す。相場を飛ばすかどうかは flow() が決める。 */
let animateHero = false;
let heroAnimId = null;

// 手取りの数字を0から目標へ1秒ほどで回す。結果ページに着いたときだけ。
function rollHeroNet(toYen) {
  const el = out.heroNet;
  if (heroAnimId) cancelAnimationFrame(heroAnimId);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { el.textContent = man(toYen); return; }
  const dur = 900, t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = man(Math.round(toYen * e));
    if (p < 1) heroAnimId = requestAnimationFrame(step);
    else el.textContent = man(toYen);
  };
  heroAnimId = requestAnimationFrame(step);
}

function goStep(delta) {
  const list = flow();
  const i = list.indexOf(screen);
  if (i < 0) {
    setScreen(lastMain);
    return;
  }
  const nextIndex = Math.min(list.length - 1, Math.max(0, i + delta));
  if (screen === "basis" && delta > 0 && purchaseIncomplete()) return;
  if (screen === "sell" && delta > 0 && sellIncomplete()) {
    if (out.sellError) {
      out.sellError.textContent = "ローンありを選んでいます。ローン残高を入力してください。";
      out.sellError.hidden = false;
    }
    return;
  }
  // 相場から進むときは、出した想定価格をそのまま売却価格に入れる。
  // S に代入するだけでは、スライダーの位置と表示が既定値のまま取り残される。
  // setKey を通すと、刻みへの丸め・上下限・touched・再描画までまとめて済む。
  if (screen === "market" && delta > 0) {
    const est = estimatedPriceYen();
    if (est > 0) setKey("priceMan", Math.round(est / 10_000));
  }
  if (list[nextIndex] === "result" && screen !== "result") animateHero = true;
  setScreen(list[nextIndex]);
  update();
}

function applyScreen() {
  for (const el of app.querySelectorAll("[data-screen-panel]")) {
    el.hidden = el.dataset.screenPanel !== screen;
  }
  const list = flow();
  const i = list.indexOf(screen);
  const inFlow = i >= 0;

  // 税額を出す画面ではバナーを引っ込める（方針: 税額の中と隣に広告を置かない）。
  // 出しっぱなしにすると、手取りや税額のすぐ下に広告が並び、広告が試算の結果と
  // 関係あるものとして読めてしまう。モジュールは一度読めばキャッシュされる。
  if (globalThis.Capacitor?.isNativePlatform?.()) {
    import("./ads-native.js")
      .then((m) => m.setBannerVisible(screen !== "result"))
      .catch(() => {});
  }

  // AdSense: DOM に <ins> を挿入して push する。scaffold 時点では空 div だけ
  // 置いておき、画面が表示されてレイアウトが確定してから挿入する。
  // scaffold 内に <ins> を書くと、AdSense スクリプトが初期化時に DOM を触り
  // レイアウトが壊れる。
  setTimeout(fillAdSlots, 100);

  // 画面が変わったら pick は閉じる。外側スクロールのロックを持ち越さない。
  for (const key of Object.keys(pickOpen)) {
    pickOpen[key] = false;
    pickQuery[key] = "";
  }
  syncPickLock();

  // 数字を入れる前に答えを出さない。売る値段に触れる画面から先で出す。
  const hero = app.querySelector("#hero");
  if (hero) hero.hidden = screen !== "result" || !inputsReady();

  const stepsNav = app.querySelector("[data-steps-nav]");
  if (stepsNav) stepsNav.hidden = !inFlow || screen === "result";

  const nav = app.querySelector("[data-bottom-nav]");
  if (nav) nav.hidden = screen !== "result";

  if (inFlow && screen !== "result") {
    const total = list.length - 1; // 結果は手順に数えない
    const title = STEP_TITLES[screen] || "";
    const dots = list
      .slice(0, total)
      .map((_, k) => `<i class="${k === i ? "is-on" : k < i ? "is-done" : "is-todo"}"></i>`)
      .join("");
    out.stepDots.innerHTML = `<span class="steps-now">${i + 1} / ${total}　${esc(title)}</span><span class="steps-marks" aria-hidden="true">${dots}</span>`;
    out.stepNext.textContent = STEP_NEXT_LABEL[screen] || "次へ";
    out.stepNext.disabled = screen === "basis" && purchaseIncomplete();
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

/* ------------------------------------------------------------ 中身 */

function purchasePanelHtml() {
  if (asYesNo(S.purchaseKnown) === "") {
    return `<p class="hint">金額が分かるか、分からないかを選んでください。選ぶまで、購入代金の仮定は使いません。</p>`;
  }
  if (!isYes(S.purchaseKnown)) {
    return `<p class="hint">取得費は売却価格の5%として計算します。実際にはより高い価格で購入していることが多く、譲渡益が大きく出て、税額も大きくなります。契約書が見つかれば結果は変わります。</p>`;
  }
  return `
    <div class="grid-inputs tight">
      ${field("purchaseLandMan", "土地の購入代金", { unit: "万円", step: "1" })}
      ${field("purchaseBuildingMan", "建物の購入代金", { unit: "万円", step: "1" })}
      ${field("purchaseCostMan", "購入時の諸費用", { unit: "万円", step: "1" })}
    </div>
    <div class="est-row kind-row">
      <span class="row-label">建物の構造</span>
      ${segment("structure", STRUCTURES, "建物の構造", "structs")}
    </div>
    <p class="hint">減価償却に使うので、必ず選んでください。</p>
    <p class="hint" data-out="depHint"></p>`;
}

function loanBoxHtml() {
  if (asYesNo(S.hasLoan) === "") {
    return `<p class="hint">事前チェックでローンの有無を選んでください。</p>`;
  }
  if (!isYes(S.hasLoan)) return "";
  return `${field("loanMan", "ローン残高", { unit: "万円", step: "1" })}`;
}

function prepListHtml() {
  const items = ["登記識別情報（権利証）または登記事項証明書"];
  if (isYes(S.inherited)) items.push("遺産分割協議書など、相続の経緯が分かる書類");
  if (isYes(S.hasLoan)) items.push("ローン残高証明書");
  if (asYesNo(S.purchaseKnown) !== "no") items.push("購入時の売買契約書、領収書");
  items.push("固定資産税の納税通知書");
  if (S.stage === "quoted") items.push("査定書、媒介契約書");
  return items.map((t) => `<li>${esc(t)}</li>`).join("");
}

function extraRowsHtml() {
  const items = extrasCopy();
  const presets =
    items.length >= EXTRA_MAX
      ? ""
      : `<div class="presets">${EXTRA_PRESETS.map(
          (p, i) => `<button type="button" class="pill" data-extra-add="${i}">＋ ${p.label}</button>`
        ).join("")}<button type="button" class="pill ghost" data-extra-add="blank">＋ その他費用を追加</button></div>`;

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
      </div>`
    )
    .join("");

  const hasBlank = items.some((e) => !EXTRA_PRESETS.some((p) => p.label === e.label));
  const note = hasBlank
    ? `<p class="hint">自由入力の費用は、税金の計算では譲渡費用にしていません。</p>`
    : "";

  return `${presets}<div class="rp-rows">${rows}</div>${note}`;
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
        <td class="tnum">${man(it.yen)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="cost-group">
      <div class="row">
        <span class="row-label">仲介手数料</span>
        ${segment("brokerageMode", [{ id: "auto", label: "法定上限で試算" }, { id: "manual", label: "手入力" }], "仲介手数料の出しかた", "even")}
      </div>
      ${
        S.brokerageMode === "manual"
          ? `<div class="grid-inputs tight">${field("brokerageMan", "仲介手数料（税込）", { unit: "万円", step: "1" })}</div>
             <p class="hint">法定上限は ${man(capNow)}（税込）です。これを超える請求は受けられません。</p>`
          : `<p class="hint">売却価格 ${num(S.priceMan) ? man(c.input.priceYen) : "—"} なら、法定上限は <b>${man(capNow)}</b>（税込）。速算式は「価格×3%＋6万円」に消費税を足したものです。報酬額は業者によって異なります。</p>`
      }
    </div>

    <div class="cost-group">
      <div class="row">
        <span class="row-label">印紙税（売買契約書）</span>
        ${segment("stampMode", [{ id: "auto", label: "自動" }, { id: "manual", label: "手入力" }], "印紙税の出しかた", "even")}
      </div>
      ${
        S.stampMode === "manual"
          ? `<div class="grid-inputs tight">${field("stampMan", "印紙税", { unit: "万円", step: "0.1" })}</div>`
          : `<p class="hint">売却価格 ${num(S.priceMan) ? man(c.input.priceYen) : "—"} の区分で <b>${man(stamp.yen)}</b>。2027年3月31日までの軽減税率によります。</p>`
      }
    </div>

    <div class="cost-group">
      <span class="row-label">ローン関連にかかる費用</span>
      <div class="grid-inputs tight">
        ${field("releaseJudicialMan", "登録免許税と司法書士報酬", { unit: "万円", step: "0.1" })}
        ${field("prepayFeeMan", "一括返済の手数料", { unit: "万円", step: "0.1" })}
      </div>
      <p class="hint">登録免許税は不動産1個につき1,000円です。土地と建物なら2個で数えます。金額が分からなければ空欄のままで進めます。ここの費用は手取りからは引かれますが、税法上の譲渡費用には入りません。</p>
    </div>

    <div class="cost-group">
      <span class="row-label">その他の費用</span>
      ${extraRowsHtml()}
    </div>

    <table class="data-table costs">
      <tbody>${rows}
        <tr class="is-base"><th>費用の合計</th><td class="tnum"><b>${man(c.r.costs.total)}</b></td></tr>
        <tr><th>うち譲渡費用になる分</th><td class="tnum">${man(c.r.costs.deductible)}</td></tr>
      </tbody>
    </table>`;
}

function answerHtml(c) {
  const r = c.r;
  const short = r.net < 0;

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
      <div class="ans-total">
        <span>${short ? "用意する現金" : "手元に残る額"}</span>
        <b class="${short ? "is-warn" : ""}">${short ? man(r.shortfall) : man(r.net)}</b>
      </div>
      <p class="legend-note">${
        short
          ? `売却代金では ${man(r.shortfall)} 足りません。`
          : `売却価格の ${percent(r.keepRatio)} が手元に残る計算です。`
      }${r.tax.total > 0 ? `このうち住民税 ${man(r.tax.resident)} は売却の翌年に納めます。` : ""}</p>
      ${warn}
    </section>`;
}

function flowTableHtml(c) {
  const r = c.r;
  const rows = r.costs.items
    .map((it) => `<tr><th>　${esc(it.label)}</th><td class="tnum">−${man(it.yen)}</td></tr>`)
    .join("");
  return `<table class="data-table costs">
      <tbody>
        <tr class="is-base"><th>売却価格</th><td class="tnum">${man(r.price)}</td></tr>
        ${rows}
        <tr><th>ローン残高</th><td class="tnum">−${man(r.loan)}</td></tr>
        <tr><th>譲渡所得税・住民税</th><td class="tnum">−${man(r.tax.total)}</td></tr>
        <tr class="is-base"><th>${r.net < 0 ? "不足額" : "手取り"}</th><td class="tnum ${r.net < 0 ? "is-warn" : ""}"><b>${man(r.net)}</b></td></tr>
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
        <thead><tr><th>売却価格</th><th>手取り</th><th>うち税金</th><th>諸費用</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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
        <td class="tnum">${man(b.amount)}</td>
        <td class="tnum">${man(b.amount * (b.income + b.resident))}</td>
      </tr>`
    )
    .join("");

  const acquisitionNote =
    a.method === "estimated"
      ? `<p class="hint">取得費は <b>概算取得費（売却価格の5%）</b> を使っています。${
          isYes(S.purchaseKnown)
            ? "入れた実額よりこちらのほうが大きく、有利になるためです。"
            : "購入時の金額が分からないためです。契約書が見つかれば、税額はここから大きく下がる可能性があります。"
        }</p>`
      : `<p class="hint">建物は年数ぶん価値が減ったものとして扱います。この試算では減価償却費 <b>${man(a.depreciation)}</b> を差し引いた額を取得費としています。</p>`;

  return `
    <p class="legal-lead">以下は、入力された数値をもとに一般的な計算方法を当てはめた<b>試算</b>です。特例の適用可否を判定するものではなく、税務相談にあたるものでもありません。実際の申告は税務署または税理士にご確認ください。</p>
    <table class="data-table costs">
      <tbody>
        <tr class="is-base"><th>譲渡価額（売却価格）</th><td class="tnum">${man(r.price)}</td></tr>
        <tr><th>取得費<small>${a.method === "estimated" ? "概算取得費（5%）" : "土地＋償却後の建物＋購入時諸費用"}</small></th><td class="tnum">−${man(a.total)}</td></tr>
        <tr><th>譲渡費用<small>仲介手数料・印紙税など</small></th><td class="tnum">−${man(r.costs.deductible)}</td></tr>
        <tr class="is-base"><th>譲渡所得</th><td class="tnum">${man(r.gross)}</td></tr>
        <tr><th>特別控除<small>${
          r.deductionCap > 0 ? "居住用財産の3,000万円特別控除" : "適用なし"
        }</small></th><td class="tnum">−${man(r.deduction)}</td></tr>
        <tr class="is-base"><th>課税譲渡所得</th><td class="tnum">${man(r.taxable)}</td></tr>
      </tbody>
    </table>
    ${acquisitionNote}

    <div class="chart-wrap">
      <p class="chart-title">税率の当てはめ${r.taxable > 0 ? ` — ${esc(r.tax.label)}` : ""}</p>
      <table class="data-table costs">
        <thead><tr><th>区分</th><th>対象の所得</th><th>税額</th></tr></thead>
        <tbody>${
          bands ||
          '<tr><th>課税される譲渡所得がありません</th><td class="tnum">0万円</td><td class="tnum">0万円</td></tr>'
        }
          <tr class="is-base"><th>税額の合計</th><td></td><td class="tnum"><b>${man(r.tax.total)}</b></td></tr>
          <tr><th>　うち所得税・復興特別所得税</th><td></td><td class="tnum">${man(r.tax.income)}</td></tr>
          <tr><th>　うち住民税<small>売却した年の翌年に納めます</small></th><td></td><td class="tnum">${man(r.tax.resident)}</td></tr>
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

/**
 * 政令市の区は市名で <optgroup> にまとめる。大阪市の次が堺市、そのあと豊中市、
 * という並びでも、グループが変わるタイミングで開閉する。
 */
function cityOptionsHtml(data, selected) {
  const chunks = [];
  let open = "";
  for (const c of cityList(data)) {
    const g = c.group || "";
    if (g !== open) {
      if (open) chunks.push("</optgroup>");
      if (g) chunks.push(`<optgroup label="${esc(g)}">`);
      open = g;
    }
    chunks.push(
      `<option value="${c.code}"${c.code === selected ? " selected" : ""}>${esc(c.name)}</option>`
    );
  }
  if (open) chunks.push("</optgroup>");
  return chunks.join("") || "<option>—</option>";
}

const pickQuery = { casePref: "", caseCity: "" };
const pickOpen = { casePref: false, caseCity: false };
let bandTuneOpen = false;

function prefPickItems() {
  const idx = indexState();
  const indexReady = idx.status === "ready";
  return PREFECTURES.map((p) => {
    const listed = indexReady && prefIsListed(idx.data, p.code);
    const mark = indexReady && !listed ? "（未収録）" : "";
    return { value: p.code, label: `${p.name}${mark}`, group: "" };
  });
}

function cityPickItems(data) {
  return cityList(data).map((c) => ({ value: c.code, label: c.name, group: c.group || "" }));
}

function pickItemsOf(key) {
  if (key === "casePref") return prefPickItems();
  const st = casesState(S.casePref);
  return st.status === "ready" ? cityPickItems(st.data) : [];
}

function pickFilter(items, q, selectedLabel) {
  const t = String(q || "").trim();
  if (!t || t === selectedLabel) return items;
  return items.filter((it) => it.label.includes(t) || (it.group && it.group.includes(t)));
}

function pickListHtml(items, selected, q) {
  const current = items.find((it) => it.value === selected);
  const shown = pickFilter(items, q, current?.label || "");
  if (!shown.length) return `<p class="pick-empty">該当なし</p>`;
  const rows = [];
  let open = "";
  for (const it of shown) {
    const g = it.group || "";
    if (g && g !== open) {
      rows.push(`<li class="pick-group">${esc(g)}</li>`);
      open = g;
    } else if (!g) open = "";
    rows.push(
      `<li><button type="button" class="pick-opt${it.value === selected ? " is-on" : ""}" data-pick-opt data-value="${esc(
        it.value
      )}">${esc(it.label)}</button></li>`
    );
  }
  return `<ul class="pick-list">${rows.join("")}</ul>`;
}

function pickSelectInner(key, items, selected, disabled) {
  if (key === "caseCity") {
    if (disabled) return "<option>—</option>";
    const st = casesState(S.casePref);
    return st.status === "ready" ? cityOptionsHtml(st.data, selected) : "<option>—</option>";
  }
  return items
    .map((it) => `<option value="${esc(it.value)}"${it.value === selected ? " selected" : ""}>${esc(it.label)}</option>`)
    .join("");
}

function pickControlHtml({ key, caption, items, selected, disabled, placeholder }) {
  const current = items.find((it) => it.value === selected);
  const open = pickOpen[key] && !disabled;
  const q = open ? pickQuery[key] : "";
  const inputValue = open ? pickQuery[key] : current?.label || "";
  return `<div class="pick${disabled ? " is-off" : ""}" data-pick-box="${key}">
    <label>${caption}
      <input type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false"
        data-pick-q="${key}" value="${esc(inputValue)}" placeholder="${esc(placeholder)}"
        ${disabled ? " disabled" : ""} aria-expanded="${open}" aria-autocomplete="list" />
    </label>
    <select data-select="${key}" class="visually-hidden" tabindex="-1"${disabled ? " disabled" : ""}>${pickSelectInner(
      key,
      items,
      selected,
      disabled
    )}</select>
    <div data-pick-host>${open ? pickListHtml(items, selected, q) : ""}</div>
  </div>`;
}

function syncPickLock() {
  // iOS Safari routes touches to the outermost scrollable ancestor first.
  // When a pick-list is open, lock the outer scroll so iOS sends touches
  // to the inner list instead. Remove the lock when all lists are closed.
  const scroll = app.querySelector("[data-screen-scroll]");
  if (scroll) scroll.classList.toggle("pick-locked", Object.values(pickOpen).some(Boolean));
}

function refreshPickList(key) {
  const box = app.querySelector(`[data-pick-box="${key}"]`);
  const host = box?.querySelector("[data-pick-host]");
  if (!host) return;
  host.innerHTML = pickOpen[key] ? pickListHtml(pickItemsOf(key), S[key], pickQuery[key]) : "";
  const input = box.querySelector("[data-pick-q]");
  if (input) input.setAttribute("aria-expanded", String(Boolean(pickOpen[key])));
  syncPickLock();
}

function applyPickValue(key, value) {
  const select = app.querySelector(`[data-select="${key}"]`);
  if (!select) return;
  pickOpen[key] = false;
  pickQuery[key] = "";
  syncPickLock();
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function casesPanelHtml() {
  const state = casesState(S.casePref);
  const idx = indexState();
  const prefName = PREFECTURES.find((p) => p.code === S.casePref)?.name || "";

  const prefItems = prefPickItems();
  const cityReady = state.status === "ready";
  const cityItems = cityReady ? cityPickItems(state.data) : [];
  const head = `<div class="grid-inputs tight pick-grid">
      ${pickControlHtml({
        key: "casePref",
        caption: "都道府県",
        items: prefItems,
        selected: S.casePref,
        disabled: false,
        placeholder: "名前で絞る",
      })}
      ${pickControlHtml({
        key: "caseCity",
        caption: "市区町村",
        items: cityItems,
        selected: S.caseCity,
        disabled: !cityReady,
        placeholder: cityReady ? "名前で絞る" : "—",
      })}
    </div>`;

  if (state.status === "loading" || idx.status === "loading") return `${head}<p class="hint">読み込んでいます…</p>`;
  if (state.status !== "ready") {
    return `${head}
      <p class="legal-lead">${prefName}の取引事例はまだ収録していません。㎡単価から当たりをつけてください。</p>`;
  }

  const kinds = availableKinds(state.data, S.caseCity);
  if (!kinds.length) {
    return `${head}<p class="legal-lead">この市区町村の事例は収録していません。別の市区町村を選ぶか、㎡単価から当たりをつけてください。</p>`;
  }

  // 種別は上の「物件の内容」で選んでいる。ここにもう一組置くと、同じ値を
  // 書き換える操作が1画面に2つ並ぶ。しかも収録のある種別だけに絞られるため、
  // 選択肢の数が上と食い違って別物に見える。
  const kindLabel = CASE_KINDS.find((k) => k.id === S.caseKind)?.label || "";
  const bucket = bucketOf(state.data, S.caseCity, S.caseKind);
  if (!bucket) {
    const others = kinds.map((k) => k.label).join("・");
    return `${head}<p class="legal-lead">この市区町村に${kindLabel}の事例は収録していません。${
      others ? `収録があるのは${others}です。上の「物件の内容」で種別を変えるか、` : ""
    }別の市区町村を選んでください。</p>`;
  }

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

  // 母数が薄い地域は、選んだ1件で想定価格が大きく動く。読み飛ばされると
  // 判断を誤るので枠で囲う。言いたいのは「これが総数ではない」の一点なので、
  // 見出しでそれだけを言う。件数を否定する書き方にすると、出ている事例が
  // 別の地域のものだと読めてしまう。
  const n = spread.count.toLocaleString("ja-JP");
  const thinNote = isThinSample(bucket)
    ? `<div class="case-thin">
        <p class="case-thin-head">この地域の取引は、これだけではありません</p>
        <p>ここに出ている${n}件は、国土交通省が<b>公表している</b>事例です。元のデータは買主へのアンケートに回答があった取引だけを集めたもので、回答は任意（回収率は全国でおおむね3割）。<b>実際に売買された件数の総数ではありません。</b></p>
        <p>公表事例が${n}件だと、どれを選ぶかで想定価格が大きく動きます。近隣の市区町村や、㎡単価からの当たりと見比べてください。</p>
      </div>`
    : "";

  return `${head}
    <p class="hint">直近${esc(state.data.years || "")}年の取引から、安い順に並べています。同じ市区町村でも ${unitPriceManLabel(
      spread.low
    )}/㎡ から ${unitPriceManLabel(spread.high)}/㎡ まで開きがあります（中央値 ${unitPriceManLabel(
      spread.median
    )}/㎡、公表事例 ${spread.count.toLocaleString("ja-JP")}件）。自分の物件に近いものを選んでください。</p>
    ${thinNote}
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
      <div class="grid-inputs tight">
        ${field("unitPriceMan", "当てはめる㎡単価", { unit: "万円/㎡", step: "any" })}
      </div>`;
  }
  const area = S.areaUnit === "tsubo" ? tsuboToSqm(num(S.areaSqm)) : num(S.areaSqm);
  return `<p class="hint">ご自身で把握している場合は、㎡単価を使った試算も可能です。</p>
    <div class="grid-inputs tight">
      ${field("unitPriceMan", "近隣の㎡単価", { unit: "万円/㎡", step: "any" })}
    </div>
    <p class="hint">${
      S.areaUnit === "tsubo"
        ? `${num(S.areaSqm)}坪 は ${area.toFixed(1)}㎡ です。単価は㎡あたりで入れてください。`
        : `レインズで見た成約の㎡単価を入れてください。坪単価しか分からないときは、坪単価÷3.31が㎡単価です。`
    }</p>`;
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
    <details class="band-tune" data-band-tune${bandTuneOpen ? " open" : ""}>
      <summary>幅の調整（下振れ ${esc(String(S.rangeDownPct))}% / 上振れ ${esc(String(S.rangeUpPct))}%）</summary>
      <div class="grid-inputs tight">
        ${field("rangeDownPct", "下振れ", { unit: "%", step: "1" })}
        ${field("rangeUpPct", "上振れ", { unit: "%", step: "1" })}
      </div>
    </details>
    <p class="legend-note">単位は万円。上段が売却価格、下段がそのときの手取り。この幅の中で手取りは <b>${man(
      spread
    )}</b> 動きます。</p>`;
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
              <div class="note-body">${n.body}</div>
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
    ["ローン残高", man(c.input.loanBalanceYen)],
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
      ["ローン残高", man(r.loan)],
      ["譲渡所得税", man(r.tax.total)],
    ],
    disclaimer:
      "入力条件に基づく試算です。実際の成約価格・税額・費用を保証するものではありません。税務の取扱いは税理士または税務署へご確認ください。",
    url: APP_URL,
  };
}

/* ------------------------------------------------------------ 描画 */

const FOCUS_KEY_ATTRS = ["data-field", "data-extra-label", "data-extra-man", "data-pick-q"];

/**
 * innerHTML を丸ごと差し替える再描画は、入力中の欄も一緒に作り直してしまい
 * フォーカスが外れてスマホのキーボードが閉じる。差し替え前後で同じ欄を
 * data属性で見つけ直し、フォーカスとカーソル位置を戻す。
 */
function replacePreservingFocus(el, html) {
  const active = document.activeElement;
  // 入力中の数値欄は作り直さない。type=number の差し替えで2桁目から欠ける。
  if (
    el.contains(active) &&
    active.matches &&
    active.matches("[data-field], [data-extra-label], [data-extra-man]")
  ) {
    return;
  }
  // 選択が終わって閉じている pick の検索欄には、フォーカスを戻さない。
  // 戻すと focusin がリストを開き直し、外側スクロールがロックされたまま
  // ページが動かなくなる（syncPickLock を参照）。
  if (
    el.contains(active) &&
    active.matches &&
    active.matches("[data-pick-q]") &&
    !pickOpen[active.dataset.pickQ]
  ) {
    el.innerHTML = html;
    syncPickLock();
    return;
  }
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
  const ready = inputsReady();

  out.heroLabel.textContent = short ? "用意する現金（想定）" : "手元に残る額（想定）";
  out.heroNet.classList.toggle("is-warn", ready && short);
  if (!ready) {
    out.heroNet.textContent = "—";
  } else if (animateHero) {
    animateHero = false;
    rollHeroNet(short ? r.shortfall : r.net);
  } else {
    out.heroNet.textContent = man(short ? r.shortfall : r.net);
  }
  out.heroCosts.textContent = ready ? man(r.costs.total) : "—";
  out.heroLoan.textContent = ready ? man(r.loan) : "—";
  out.heroTax.textContent = ready ? man(r.tax.total) : "—";

  const loanBox = app.querySelector("[data-loan-box]");
  if (loanBox) loanBox.hidden = asYesNo(S.hasLoan) === "no";
  if (out.sellError && !sellIncomplete()) out.sellError.hidden = true;
  if (out.loanBox) replacePreservingFocus(out.loanBox, loanBoxHtml());

  if (out.prepList) out.prepList.innerHTML = prepListHtml();

  const oy = ownedYears();
  const ty = taxYears();
  out.ownedLabel.textContent = `${oy.toFixed(1)}年`;
  out.taxYearsLabel.textContent = `${ty.toFixed(1)}年`;

  const crossesShort = oy > 5 && ty <= 5;
  const crossesLong = oy > 10 && ty <= 10;
  out.termHint.innerHTML = crossesShort
    ? "実際は5年を超えて持っていますが、<b>1月1日基準ではまだ5年以下</b>です。この場合は短期譲渡の区分で、税率は39.63%。5年を超える区分の税率は20.315%です。判定は契約日ではなく引き渡し日によります。どの区分になるかは税務署または税理士にご確認ください。"
    : crossesLong
      ? "実際は10年を超えていますが、<b>1月1日基準ではまだ10年以下</b>です。翌年に売却すれば、6,000万円までの部分に14.21%の軽減税率が使えます。"
      : `税率の判定は ${ty.toFixed(1)}年 で行います。減価償却の経過年数は実際の ${oy.toFixed(1)}年 で数えます。`;

  out.taxHint.textContent = S.isResidence
    ? `譲渡益から最大 ${man(RESIDENTIAL_DEDUCTION)} を差し引ける特例があります。前年・前々年に同じ特例を受けている場合や、住まなくなって3年を経過した年の年末を過ぎた場合など、使えない場合があります。要件に当てはまるかは税務署または税理士にご確認ください。`
    : "投資用・別荘・相続した空き家などは居住用の特例の対象外です。空き家の特例は要件が別にあるため、このツールでは扱っていません。";

  replacePreservingFocus(out.purchasePanel, purchasePanelHtml());
  const depHint = app.querySelector('[data-out="depHint"]');
  if (depHint) {
    const hasAmounts = isYes(S.purchaseKnown) && (S.purchaseLandMan !== "" || S.purchaseBuildingMan !== "");
    depHint.innerHTML = !hasAmounts
      ? ""
      : r.acquisition.depreciation > 0
        ? `${oy.toFixed(1)}年ぶんの減価償却 <b>${man(r.acquisition.depreciation)}</b> を引いた取得費は <b>${man(r.acquisition.total)}</b> です。`
        : `取得費は <b>${man(r.acquisition.total)}</b> です。`;
  }

  replacePreservingFocus(out.costs, costsHtml(c));
  ensureCases();
  replacePreservingFocus(out.estPanel, estPanelHtml());
  if (out.areaField) {
    replacePreservingFocus(
      out.areaField,
      field("areaSqm", "自分の物件の面積", { unit: S.areaUnit === "tsubo" ? "坪" : "㎡", step: "1" }),
    );
  }
  out.estValue.textContent = man(estimatedPriceYen());

  out.stageHint.textContent = STAGE_HINT[S.stage] || "";
  if (ready) {
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
      { label: "残高", value: -r.loan, type: "minus" },
      { label: "税金", value: -r.tax.total, type: "minus" },
      { label: short ? "不足" : "手取り", value: r.net, type: "total" },
    ];
    out.waterfall.innerHTML = waterfallChart(steps);
    out.proceeds.innerHTML = proceedsChart(c.rows, { current: r.price, breakEven: c.breakEven });
    out.proceedsReadout.textContent = `いまは ${man(r.price)} で試算中。手元に残るのは ${man(r.net)}。`;
  } else {
    const miss = `<p class="legal-lead">売却価格・ローン・取得費の入り方がまだ揃っていません。数字は、入れた項目が揃ってから出します。</p>`;
    out.notes.innerHTML = miss;
    out.noteBadge.textContent = "";
    out.answer.innerHTML = miss;
    out.flowTable.innerHTML = "";
    out.matrix.innerHTML = "";
    out.taxPanel.innerHTML = miss;
    out.waterfall.innerHTML = "";
    out.proceeds.innerHTML = "";
    out.proceedsReadout.textContent = "";
  }

  out.condDate.textContent = `${TODAY_LABEL} 時点`;
  out.condGrid.innerHTML = condGridHtml(c);

  setStates();
  if (out.stepNext && screen === "basis") out.stepNext.disabled = purchaseIncomplete();
  save();
}

function syncSlider(key) {
  const input = app.querySelector(`#r-${key}`);
  if (!input) return;
  const b = BOUNDS[key];
  const v = num(S[key]) || (key === "priceMan" ? 3500 : 0);
  if (key === "priceMan") input.step = String(num(S.priceStep));
  input.value = String(v);
  input.style.setProperty("--pct", `${((v - b.min) / (b.max - b.min)) * 100}%`);
  const target = app.querySelector(`[data-out="${key}"]`);
  if (target) {
    target.textContent = key === "priceMan" && !S.touched.price ? "—" : v.toLocaleString("ja-JP");
  }
}

function syncAll() {
  syncSlider("priceMan");
  update();
}

function setKey(key, value) {
  const b = BOUNDS[key];
  let v = num(value);
  if (b) {
    const step = key === "priceMan" ? num(S.priceStep) : 10;
    v = clamp(Math.round(v / step) * step, b.min, b.max);
  }
  S[key] = v;
  if (key === "priceMan") S.touched.price = true;
  if (key === "loanMan") S.touched.loan = true;
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
    const key = f.dataset.field;
    S[key] = f.value === "" ? "" : num(f.value);
    if (key === "loanMan") S.touched.loan = true;
    if (key === "priceMan") S.touched.price = true;
    if (key === "areaSqm") S.touched.area = true;
    update();
    return;
  }
  const pq = e.target.closest("[data-pick-q]");
  if (pq) {
    const key = pq.dataset.pickQ;
    pickQuery[key] = pq.value;
    pickOpen[key] = true;
    refreshPickList(key);
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
  if (e.target.closest("[data-field], [data-extra-label], [data-extra-man]")) {
    update();
    applyScreen();
    return;
  }
  const select = e.target.closest("[data-select]");
  if (select) {
    S[select.dataset.select] = select.value;
    if (select.dataset.select === "casePref") {
      // 都道府県が変われば市区町村も種別も選び直しになる。
      S.caseCity = "";
      S.casePicked = -1;
      pickOpen.caseCity = false;
      pickQuery.caseCity = "";
    }
    if (select.dataset.select === "caseCity") S.casePicked = -1;
    pickOpen[select.dataset.select] = false;
    pickQuery[select.dataset.select] = "";
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
  const pickOpt = e.target.closest("[data-pick-opt]");
  if (pickOpt) {
    e.preventDefault();
    const box = pickOpt.closest("[data-pick-box]");
    if (box) applyPickValue(box.dataset.pickBox, pickOpt.dataset.value);
    return;
  }
  const nudge = e.target.closest("[data-nudge]");
  if (nudge) {
    const key = nudge.closest(".ctrl").dataset.key;
    const dir = Number(nudge.dataset.nudge);
    const step = key === "priceMan" ? num(S.priceStep) : 10;
    startRepeat(() => setKey(key, num(S[key]) + dir * step));
  }
});

app.addEventListener("focusin", (e) => {
  const pq = e.target.closest("[data-pick-q]");
  if (!pq || pq.disabled) return;
  const key = pq.dataset.pickQ;
  pickOpen[key] = true;
  refreshPickList(key);
  pq.select();
});

app.addEventListener("focusout", (e) => {
  const box = e.target.closest("[data-pick-box]");
  if (!box) return;
  const key = box.dataset.pickBox;
  // relatedTarget は「次にフォーカスが移る先」。requestAnimationFrame で
  // activeElement を見に行くと、バックグラウンドのタブや省電力で rAF が
  // 止まったときに閉じる処理ごと止まり、外側スクロールがロックされたまま
  // ページが動かなくなる。同期的に判定する。
  if (box.contains(e.relatedTarget)) return;
  if (!pickOpen[key]) return;
  pickOpen[key] = false;
  pickQuery[key] = "";
  const input = box.querySelector("[data-pick-q]");
  const select = box.querySelector("[data-select]");
  if (input) input.value = select?.selectedOptions[0]?.textContent || "";
  refreshPickList(key);
});

app.addEventListener("keydown", (e) => {
  const pq = e.target.closest("[data-pick-q]");
  if (!pq) return;
  if (e.key === "Enter") {
    e.preventDefault();
    const first = pq.closest("[data-pick-box]")?.querySelector("[data-pick-opt]");
    if (first) applyPickValue(pq.dataset.pickQ, first.dataset.value);
  }
  if (e.key === "Escape") {
    pickOpen[pq.dataset.pickQ] = false;
    pickQuery[pq.dataset.pickQ] = "";
    pq.blur();
  }
});

app.addEventListener("toggle", (e) => {
  const d = e.target.closest("[data-band-tune]");
  if (d) bandTuneOpen = d.open;
}, true);

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
    const key = set.dataset.set;
    const value = set.dataset.value;
    S[key] = value;
    if (key === "caseKind") {
      S.casePicked = -1;
      if (!S.touched.area) {
        const def = AREA_DEFAULTS[value];
        if (def) S.areaSqm = S.areaUnit === "tsubo" ? Math.round((def / 3.3058) * 10) / 10 : def;
      }
    }
    if (key === "hasLoan") {
      if (value === "no") {
        S.loanMan = 0;
        S.touched.loan = true;
      } else {
        S.loanMan = S.loanMan === 0 ? "" : S.loanMan;
        S.touched.loan = S.loanMan !== "" && S.loanMan != null;
      }
    }
    if (key === "purchaseKnown") S.touched.purchaseKnown = true;
    if (key === "structure" || key === "purchaseKnown") applyScreen();
    if (key === "theme" || key === "palette") applyPrefs();
    if (key === "stage") {
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
  out.proceedsReadout.textContent = `${man(row.price)}で売却した場合、手元に残るのは ${man(row.net)}${
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
