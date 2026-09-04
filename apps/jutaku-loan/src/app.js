import {
  amortize,
  toYearly,
  flatRate,
  stepPath,
  ratePathSteps,
  paymentSteps,
  monthlyPayment,
  bonusPayment,
  monthlySurplus,
  yen,
  man,
  manShort,
  percent,
} from "./calc.js";
import {
  amortizationChart,
  paymentStepChart,
  indexFromPointer,
  xForBar,
  xForIndex,
} from "./charts.js";
import { buildShareCanvas, buildShareText } from "./share.js";
import { affiliateHtml, shownAffiliateNetworks } from "./affiliates.js";

const TODAY_LABEL = new Date().toLocaleDateString("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const STORAGE_KEY = "loan-sim-v4";

/**
 * 共有テキストに載せる公開URL。受け取った人がここから試算に来られるようにする。
 * ストアアプリ版では location が capacitor:// などになるため、実行時ではなく定数で持つ。
 */
const APP_URL = "https://tethtechlabs.com/apps/jutaku-loan/";

const defaults = {
  principalMan: 3000,
  years: 35,
  rate: 0.775,
  bonusPct: 0,
  bonusMan: 0,
  bonusMode: "pct",
  principalStep: 100,
  rateStep: 0.005,
  method: "equal-payment",
  fiveYearRule: true,
  cap125: true,
  ratePoints: [{ year: 5, delta: 0.5 }],
  budgetMan: 9,
  bonusBudgetMan: 0,
  matrixAxis: "principal",
  incomeMan: 0,
  takeHomeMan: 0,
  livingMan: 0,
  otherMan: 0,
  bonusIncomeMan: 0,
  propertyMan: 3500,
  fireMan: 20,
  ownFundsMan: "",
  contractItems: [{ label: "収入印紙", man: 0 }],
  depositMan: "",
  loanStampMan: "",
  brokerageMan: "",
  registrationMan: "",
  financeFeeMan: "",
  settlementExtra: [],
  rateType: "variable",
  resultTab: "matrix",
  matrixOffsetP: 0,
  matrixOffsetY: 0,
  theme: "system",
  palette: "standard",
};

const RATE_TYPES = [
  { id: "variable", label: "変動" },
  { id: "fixed", label: "固定" },
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
  principalMan: { min: 1, max: 20000 },
  years: { min: 1, max: 50 },
  rate: { min: 0.1, max: 5 },
};

const PRINCIPAL_STEPS = [1, 10, 50, 100];
const RATE_STEPS = [0.005, 0.01, 0.05, 0.1];
const BONUS_MAX_PCT = 50;
const POINT_MAX = 4;
const POINT_YEAR = { min: 1, max: 40, step: 1 };
const POINT_DELTA = { min: -1, max: 3, step: 0.1 };
/** 上で置いた変更ポイントが想定そのものなので、強弱の梯子は持たない。 */
const SCALES = [
  { scale: 0, label: "横ばい" },
  { scale: 1, label: "この想定" },
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
// num() はこの下で定義されるので、ここでは素の Number() で判定する。
let bonusOpen = Number(S.bonusPct) > 0 || Number(S.bonusMan) > 0;

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(S)), 250);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const toYen = (m) => num(m) * 10_000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000;
const trim = (v) => String(Number(v.toFixed(3)));

const stepOf = (key) =>
  key === "principalMan" ? num(S.principalStep) : key === "rate" ? num(S.rateStep) : 1;

/**
 * 借入額を、毎月返済分とボーナス返済分に割る。
 * 割合で決める場合と、金額をそのまま入れる場合の両方を受ける。
 * どちらでも上限は元金の50%（目安）。
 */
function splitPrincipal() {
  const total = toYen(S.principalMan);
  const cap = Math.round((total * BONUS_MAX_PCT) / 100);
  const bonus =
    S.bonusMode === "yen"
      ? clamp(toYen(S.bonusMan), 0, cap)
      : Math.round((total * clamp(num(S.bonusPct), 0, BONUS_MAX_PCT)) / 100);
  return { total, bonus, cap, monthly: total - bonus, pct: total > 0 ? (bonus / total) * 100 : 0 };
}

/* ------------------------------------------------------------ 計算 */

function points() {
  return Array.isArray(S.ratePoints) ? S.ratePoints : [];
}

/** 編集用に、時間順に並べた複製を返す。表示順と添字を一致させる。 */
function sortedPoints() {
  return points()
    .map((p) => ({ year: num(p.year), delta: num(p.delta) }))
    .sort((a, b) => a.year - b.year);
}

/** 契約時の諸費用（可変リスト）を編集用に複製する。 */
function contractItemsCopy() {
  const list = Array.isArray(S.contractItems) && S.contractItems.length ? S.contractItems : defaults.contractItems;
  return list.map((it) => ({ label: it.label ?? "", man: it.man ?? "" }));
}

/** 決済時のその他項目（可変リスト）を編集用に複製する。 */
function settlementExtraCopy() {
  const list = Array.isArray(S.settlementExtra) ? S.settlementExtra : [];
  return list.map((it) => ({ label: it.label ?? "", man: it.man ?? "" }));
}

function runScenario(scale) {
  const { total, bonus } = splitPrincipal();
  return amortize({
    principalYen: total,
    months: Math.round(S.years * 12),
    ratePath: scale === 0 ? flatRate(S.rate) : stepPath(S.rate, points(), scale),
    bonusPrincipalYen: bonus,
    method: S.method,
    fiveYearRule: S.method === "equal-payment" && S.fiveYearRule,
    cap125: S.method === "equal-payment" && S.fiveYearRule && S.cap125,
  });
}

function compute() {
  const base = runScenario(0);
  const branches = SCALES.map((sc) => ({
    ...sc,
    steps: ratePathSteps(S.rate, points(), sc.scale),
    run: sc.scale === 0 ? base : runScenario(sc.scale),
  }));
  const yearly = toYearly(base.rows);
  const split = splitPrincipal();

  const monthly = base.startPayment;
  const bonusEach = base.startBonusPayment;
  const income = toYen(S.incomeMan);
  const dti =
    income > 0 ? (monthly * 12 + bonusEach * 2 + toYen(S.otherMan) * 12) / income : null;
  const takeHome = toYen(S.takeHomeMan);
  const surplus = takeHome > 0 ? monthlySurplus(takeHome, monthly, toYen(S.livingMan)) : null;
  const ceiling = takeHome > 0 ? takeHome - toYen(S.livingMan) : null;

  return { base, branches, yearly, split, monthly, bonusEach, dti, surplus, ceiling };
}

const CONTRACT_ITEM_MAX = 3;
const SETTLEMENT_EXTRA_MAX = 3;

/** 諸費用は銀行・契約形態で実額が違うので、全項目を手入力にする。数値は参考の目安として置くだけ。 */
function costsBreakdown() {
  const propertyYen = toYen(S.propertyMan);

  const rawContract = Array.isArray(S.contractItems) && S.contractItems.length ? S.contractItems : defaults.contractItems;
  const contractItems = rawContract.map((it) => ({
    label: it.label || "",
    man: it.man ?? "",
    yen: toYen(it.man),
  }));
  const contractTotal = contractItems.reduce((a, i) => a + i.yen, 0);

  const settlementDefs = [
    { key: "loanStamp", label: "印紙税（金銭消費貸借契約書）", field: "loanStampMan" },
    { key: "brokerage", label: "仲介手数料", field: "brokerageMan" },
    { key: "registration", label: "登記費用（登録免許税・司法書士報酬）", field: "registrationMan" },
    { key: "financeFee", label: "融資関連手数料（事務手数料・保証料など）", field: "financeFeeMan" },
    { key: "fire", label: "火災保険・地震保険", field: "fireMan" },
  ];
  const settlementItems = settlementDefs.map((i) => ({ ...i, yen: toYen(S[i.field]) }));

  const rawExtra = Array.isArray(S.settlementExtra) ? S.settlementExtra : [];
  const settlementExtra = rawExtra.map((it) => ({
    label: it.label || "",
    man: it.man ?? "",
    yen: toYen(it.man),
  }));

  const settlementTotal =
    settlementItems.reduce((a, i) => a + i.yen, 0) + settlementExtra.reduce((a, i) => a + i.yen, 0);

  const fees = contractTotal + settlementTotal;
  const ownFunds = toYen(S.ownFundsMan);
  const depositYen = toYen(S.depositMan);
  const requiredLoan = Math.max(0, propertyYen + fees - ownFunds - depositYen);

  return {
    propertyYen,
    contractItems,
    contractTotal,
    settlementItems,
    settlementExtra,
    settlementTotal,
    fees,
    ownFunds,
    depositYen,
    requiredLoan,
  };
}

const picked = () => current.branches.find((b) => b.scale === 1) || current.branches[0];

/** 条件カードと共有（画像・テキスト）が共通で使うデータ。数字は一箇所にまとめる。 */
function shareData(c) {
  const rateTypeLabel = RATE_TYPES.find((t) => t.id === S.rateType)?.label || "変動";
  const methodLabel = S.method === "equal-payment" ? "元利均等" : "元金均等";
  const rows = [
    ["借入額", `${num(S.principalMan).toLocaleString("ja-JP")}万円`],
    ["期間", `${S.years}年`],
    ["金利", `${trim(num(S.rate))}%（${rateTypeLabel}）`],
    ["返済方式", methodLabel],
    ["ボーナス返済", c.split.bonus > 0 ? `${manShort(c.split.bonus)}（年2回）` : "なし"],
  ];
  return {
    dateLabel: TODAY_LABEL,
    rateTypeLabel,
    methodLabel,
    monthly: yen(c.monthly),
    bonus: c.bonusEach > 0 ? yen(c.bonusEach) : "",
    total: manShort(c.base.totalPaid),
    rows,
    disclaimer: "入力条件にもとづく試算値です。実際の返済額・適用金利・審査結果を保証するものではありません。",
    url: APP_URL,
  };
}

function riseSummary() {
  const pts = points();
  if (!pts.length) return "未設定";
  return [...pts]
    .sort((a, b) => a.year - b.year)
    .map((p) => `${p.year}年後${p.delta >= 0 ? "+" : "−"}${Math.abs(p.delta).toFixed(1)}%`)
    .join("、");
}

/* ------------------------------------------------------------ 部品 */

function stepPicker(key, steps, fmt) {
  return `<div class="steps" role="group" aria-label="刻み">
    <span>刻み</span>
    ${steps
      .map(
        (v) =>
          `<button type="button" class="tick" data-step-for="${key}" data-value="${v}">${fmt(v)}</button>`
      )
      .join("")}
  </div>`;
}

function sliderCard({ key, label, hint, unit, decimals = 0, presets = [], scale = null, extra = "", picker = "" }) {
  const b = BOUNDS[key];
  return `
    <div class="ctrl" data-key="${key}">
      <div class="ctrl-head">
        <label class="ctrl-label" for="r-${key}">${label}</label>
        ${hint ? `<span class="ctrl-hint">${hint}</span>` : ""}
      </div>
      <div class="ctrl-value">
        <button type="button" class="step" data-nudge="-1" aria-label="${label}を減らす">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <output class="ctrl-num" for="r-${key}">
          <b data-out="${key}">${num(S[key]).toFixed(decimals)}</b><span>${unit}</span>
        </output>
        <button type="button" class="step" data-nudge="1" aria-label="${label}を増やす">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${scale ? `<div class="ctrl-scale"><span>${scale[0]}</span><span>${scale[1]}</span></div>` : ""}
      <input class="range" id="r-${key}" type="range"
             min="${b.min}" max="${b.max}" step="${stepOf(key)}" value="${S[key]}"
             aria-label="${label}" />
      ${picker}
      ${
        presets.length
          ? `<div class="presets">${presets
              .map(
                (p) =>
                  `<button type="button" class="pill" data-preset="${key}" data-value="${p.value}">${p.label}</button>`
              )
              .join("")}</div>`
          : ""
      }
      ${extra}
    </div>`;
}

/**
 * 広告の差し込み位置。実タグが決まるまでは何も描かない。
 *
 * 「広告枠（準備中）」と書いた空箱を出していたが、AdSense も AdMob も
 * この要素を埋めないため、利用者にはただの未完成な箱に見える。
 * App Store はプレースホルダーの残ったアプリを審査で落とす（2.1）。
 * 実タグを入れる段階で、この関数の中身だけ戻せばよい。
 */
function adSlotHtml(id) {
  return `<div class="ad-slot is-empty" data-ad-slot="${id}" aria-hidden="true"></div>`;
}

function scaffold() {
  return `
    <header class="hero" id="hero">
      <div class="hero-main">
        <p class="hero-label">毎月の返済</p>
        <p class="hero-value" data-out="heroMonthly">—</p>
      </div>
      <div class="hero-bonus">
        <p class="hero-label">ボーナス月（年2回）</p>
        <p class="hero-value2" data-out="heroBonus">—</p>
      </div>
      <dl class="hero-stats">
        <div><dt>総返済</dt><dd data-out="heroTotal">—</dd></div>
        <div><dt>うち利息</dt><dd data-out="heroInterest">—</dd></div>
        <div><dt>利息の割合</dt><dd data-out="heroShare">—</dd></div>
      </dl>
    </header>

    <button type="button" class="back-btn" data-back hidden>← 戻る</button>

    <div class="screen-scroll" data-screen-scroll>
    <div class="screen" data-screen-panel="input">
    <button type="button" class="costs-entry" data-goto="costs">物件価格から計算する</button>
    <section class="controls" aria-label="借入条件">
      <div class="ctrl-head ctrl-head-stack">
        <span class="ctrl-label">借入条件</span>
        <span class="ctrl-req">（借入予定額、返済期間、金利は必ず入力）</span>
      </div>
      ${sliderCard({
        key: "principalMan",
        label: "借入予定額",
        hint: "",
        unit: "万円",
        scale: ["1万", "2億"],
        picker: stepPicker("principalMan", PRINCIPAL_STEPS, (v) => `${v}万`),
        extra: `
          <div class="bonus">
            <button type="button" class="bonus-toggle" data-bonus-toggle aria-expanded="false" aria-controls="bonus-panel">
              <span>ボーナス返済（50%上限を目安）</span>
              <b data-out="bonusSummary">なし</b>
            </button>
            <div class="bonus-panel" data-out="bonusPanel" id="bonus-panel" hidden>
              <div class="bonus-head">
                <div class="seg small" role="group" aria-label="指定のしかた">
                  <button type="button" data-set="bonusMode" data-value="pct">割合</button>
                  <button type="button" data-set="bonusMode" data-value="yen">金額</button>
                </div>
              </div>
              <div data-out="bonusBody"></div>
              <p class="split" data-out="split"></p>
            </div>
          </div>`,
      })}
      <div class="controls-pair">
      ${sliderCard({
        key: "years",
        label: "返済期間",
        hint: "完済まで",
        unit: "年",
        presets: [
          { value: 25, label: "25年" },
          { value: 30, label: "30年" },
          { value: 35, label: "35年" },
          { value: 40, label: "40年" },
        ],
      })}
      ${sliderCard({
        key: "rate",
        label: "金利",
        hint: "借入金利",
        unit: "%",
        decimals: 3,
        picker: stepPicker("rate", RATE_STEPS, (v) => `${v}`),
        extra: `
          <div class="rate-extra">
            <div class="rate-type">
              <span class="mini-label">金利タイプ</span>
              <div class="seg small" role="group" aria-label="金利タイプ">
                ${RATE_TYPES.map(
                  (t) => `<button type="button" data-set="rateType" data-value="${t.id}">${t.label}</button>`
                ).join("")}
              </div>
            </div>
            <div class="rate-type">
              <span class="mini-label">返済方式</span>
              <div class="seg small" role="group" aria-label="返済方式">
                <button type="button" data-set="method" data-value="equal-payment">元利均等</button>
                <button type="button" data-set="method" data-value="equal-principal">元金均等</button>
              </div>
            </div>
          </div>`,
      })}
      </div>
    </section>

    <section class="ctrl" aria-label="家計情報">
      <div class="ctrl-head">
        <span class="ctrl-label">家計情報（任意）</span>
        <span class="ctrl-hint">収入合算時は合計</span>
      </div>
      <div class="grid-inputs">
        <label>税込年収（万円）<input type="number" inputmode="decimal" data-field="incomeMan" value="${S.incomeMan || ""}" placeholder="600"/></label>
        <label>手取り月額（万円）<input type="number" inputmode="decimal" data-field="takeHomeMan" value="${S.takeHomeMan || ""}" placeholder="38"/></label>
        <label>賞与手取り（万円）<input type="number" inputmode="decimal" data-field="bonusIncomeMan" value="${S.bonusIncomeMan || ""}" placeholder="0"/></label>
        <label>生活費（月・万円）<input type="number" inputmode="decimal" data-field="livingMan" value="${S.livingMan || ""}" placeholder="18"/></label>
        <label>他の借入返済額（月・万円）<input type="number" inputmode="decimal" data-field="otherMan" value="${S.otherMan || ""}" placeholder="0"/></label>
      </div>
      <div class="household" data-out="household"></div>
    </section>
    <button type="button" class="result-entry" data-goto="result">結果で内訳を見る</button>

    </div>

    <div class="screen" data-screen-panel="result">
      <div class="tabbar" role="tablist" aria-label="結果の見方">
        <button type="button" role="tab" data-tab="matrix" aria-controls="tabpanel-matrix">マトリクス</button>
        <button type="button" role="tab" data-tab="chart" aria-controls="tabpanel-chart">残高推移</button>
        <button type="button" role="tab" data-tab="scenario" aria-controls="tabpanel-scenario">金利予測</button>
      </div>

      <div id="tabpanel-matrix" role="tabpanel" data-tabpanel="matrix">
    <section class="panel" aria-labelledby="h-matrix">
      <div class="panel-head">
        <h2 id="h-matrix">支払いに充当する金額を入力</h2>
      </div>
      <div class="afford-inputs">
        <div class="budget">
          <span>毎月</span>
          <button type="button" class="step tiny" data-budget="-1" aria-label="毎月の上限を下げる">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
          </button>
          <b data-out="budget">—</b>
          <button type="button" class="step tiny" data-budget="1" aria-label="毎月の上限を上げる">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div class="budget" data-out="bonusBudgetRow">
          <span>ボーナス（年2回）</span>
          <button type="button" class="step tiny" data-bonus-budget="-1" aria-label="ボーナスの上限を下げる">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
          </button>
          <b data-out="bonusBudget">—</b>
          <button type="button" class="step tiny" data-bonus-budget="1" aria-label="ボーナスの上限を上げる">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
      <p class="afford-note">ボーナスに毎月分は含まない。</p>

      <div class="matrix-bar">
        <div class="seg small" role="group" aria-label="縦軸">
          <button type="button" data-set="matrixAxis" data-value="principal">縦は借入額</button>
          <button type="button" data-set="matrixAxis" data-value="years">縦は期間</button>
        </div>
        <div class="pan" role="group" aria-label="表示範囲">
          <button type="button" class="step tiny" data-pan="-1" aria-label="表示範囲を上へ">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
          <button type="button" class="step tiny" data-pan="1" aria-label="表示範囲を下へ">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </button>
        </div>
      </div>
      <div class="matrix-scroll" data-out="matrix"></div>
      <p class="legend">
        <span><i class="sw ok"></i>上限内</span>
        <span><i class="sw over"></i>上限を超える</span>
        <span class="legend-note">枠は今の条件</span>
      </p>
    </section>
      </div>

      <div id="tabpanel-chart" role="tabpanel" data-tabpanel="chart">
    <section class="panel" aria-labelledby="h-break">
      <div class="panel-head">
        <h2 id="h-break">借入金額の残高推移</h2>
      </div>
      <p class="scrub-hint" data-out="scrubHint">← ドラッグで年ごとの内訳 →</p>
      <div class="chart-wrap" data-chart="amort" data-out="chartAmort"></div>
      <div class="readout" data-out="readBreakdown"></div>
      <p class="legend">
        <span><i class="sw balance"></i>借入残高</span>
        <span><i class="sw principal"></i>元金部分</span>
        <span><i class="sw interest"></i>利息部分</span>
      </p>
    </section>
      </div>

      <div id="tabpanel-scenario" role="tabpanel" data-tabpanel="scenario">
    <section class="panel" aria-labelledby="h-branch">
      <div class="panel-head">
        <h2 id="h-branch">金利の変動リスクを確認しよう</h2>
      </div>
      <div class="rate-path">
        <div class="rp-head">
          <span>金利の想定</span>
          <em>当初 <b data-out="rpBase">—</b>（変更ポイントは時間順に積み上がる）</em>
        </div>
        <div class="rp-rows" data-out="rpRows"></div>
        <button type="button" class="rp-add" data-add-point>＋ 変更ポイントを追加</button>
        <p class="rp-summary" data-out="rpSummary"></p>
      </div>

      <div class="answer" data-out="answer"></div>

      <div class="rules-row">
        <span class="pref-label">ルール</span>
        <button type="button" class="chip-toggle" data-toggle="fiveYearRule">5年ルール</button>
        <button type="button" class="chip-toggle" data-toggle="cap125">125%</button>
        <button type="button" class="help-btn" data-help aria-expanded="false" aria-controls="rules-help">?</button>
      </div>
      <div class="help-body" id="rules-help" hidden>
        <p><b>5年ルール</b>　金利が動いても、毎月の返済額は5年ごとの見直しまで変えない。その間、増えた利息のぶんだけ元金の減りが遅れる。多くの民間の変動金利にある扱い。</p>
        <p><b>125%ルール</b>　見直しで上がるのは、前回の返済額の1.25倍まで。抑えた分は免除されず、後ろの回に送られる。</p>
      </div>

      <div class="chart-wrap" data-chart="payment" data-out="chartPayment"></div>
      <p class="legend">
        <span><i class="sw base"></i>金利が動かない場合</span>
        <span><i class="sw scenario"></i>この想定</span>
        <span><i class="sw diff"></i>その差</span>
      </p>
    </section>
      </div>

      ${adSlotHtml("result-banner")}
      ${affiliateHtml()}
    </div>

    <div class="screen" data-screen-panel="costs">
      <section class="panel" aria-labelledby="h-cost">
        <div class="panel-head">
          <h2 id="h-cost">住宅購入・借入にかかる諸費用</h2>
        </div>
        <div data-out="costs"></div>
        <button type="button" class="cost-apply" data-apply-required-loan>この額を借入予定額に使う</button>
      </section>
    </div>

    <div class="screen" data-screen-panel="share">
      <section class="cond-card" aria-labelledby="h-cond">
        <div class="cond-head">
          <span class="cond-badge">試算</span>
          <span class="cond-date" data-out="condDate"></span>
        </div>
        <h2 id="h-cond" class="visually-hidden">この試算の条件</h2>
        <div class="cond-grid" data-out="condGrid"></div>
        <p class="cond-foot">実際の条件は金融機関または専門家へご確認ください。</p>
      </section>

      <section class="panel share-panel" aria-labelledby="h-share">
        <div class="panel-head">
          <h2 id="h-share">共有</h2>
          <p class="panel-sub">家族や不動産会社に、この条件を送れる。個別の交渉や審査には使えない。</p>
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
      <section class="panel" aria-labelledby="h-prefs">
      <div class="panel-head">
        <h2 id="h-prefs">表示</h2>
        <p class="panel-sub">配色はどれも、色覚特性のある人と白黒印刷で読み分けられる組み合わせにしてある。</p>
      </div>
      <div class="prefs">
        <div class="pref-row">
          <span class="pref-label">テーマ</span>
          <div class="seg small" role="group" aria-label="テーマ">
            ${THEMES.map(
              (t) => `<button type="button" data-set="theme" data-value="${t.id}">${t.label}</button>`
            ).join("")}
          </div>
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
      <p><b>免責事項</b>　本サービスの計算結果は、入力された条件に基づく試算です。実際の返済額、適用金利、諸費用、審査結果、税制上の効果などを保証するものではありません。正式な条件については、金融機関または専門家へご確認ください。</p>
      <p><b>計算の規約</b>　毎月の返済額は年金現価式で求め、<b>円未満切り上げ</b>で固定します。各回の利息は残高×年利÷12の<b>円未満切り捨て</b>です。切り上げの積み重ねは<b>最終回で精算</b>します。ただし125%ルールで返済額の増加を抑えた場合は、抑えた分が完済期日に残債として残ります。ボーナス併用分は元金を分けて、年2回・半年複利で別に組みます。</p>
      <p><b>前提</b>　5年ルールと125%ルールは、商品によって有無が違います。諸費用は入力された金額をそのまま合計するだけで、税額や手数料の自動計算は行いません。いずれも概算であり、確定額ではありません。</p>
      <p>本画面は入力値にもとづく試算であり、融資の約束でも審査の合否でもありません。金利の将来水準を予測するものではありません。税務・契約の判断、特定商品の勧誘・取次は行いません。</p>
      </footer>

      <section class="support">
        <h2>お問い合わせ</h2>
        <p>不具合のご報告、ご要望はこちらへお願いします。</p>
        <p><a href="mailto:info@tethtechlabs.com">info@tethtechlabs.com</a></p>
        <p class="support-owner">提供：TethTechLabs</p>
      </section>

      <nav class="legal-links" aria-label="関連ページ">
        <a href="https://tethtechlabs.com/apps/jutaku-loan/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>
        <a href="https://tethtechlabs.com/apps/jutaku-loan/terms.html" target="_blank" rel="noopener">利用規約</a>
        <a href="https://tethtechlabs.com/apps/jutaku-loan/disclaimer.html" target="_blank" rel="noopener">免責事項</a>
      </nav>
    </div>
    </div>

    <nav class="bottom-nav" data-bottom-nav>
      <div class="nav-main">
        <button type="button" data-goto="input">入力</button>
        <button type="button" data-goto="result">結果</button>
      </div>
      <button type="button" class="nav-icon" data-goto="costs">諸費用</button>
      <button type="button" class="nav-icon" data-goto="share">共有</button>
      <button type="button" class="nav-icon" data-goto="settings">設定</button>
    </nav>
    <div class="ad-dock" data-ad-dock aria-hidden="true"></div>`;
}

/* ------------------------------------------------------------ 描画 */

const app = document.getElementById("app");
app.innerHTML = scaffold();

const out = {};
for (const node of app.querySelectorAll("[data-out]")) out[node.dataset.out] = node;

/* ------------------------------------------------------------ 画面遷移 */

let screen = "input";
let lastMain = "input"; // 共有・設定から戻る先

function setScreen(next) {
  if (screen === "input" || screen === "result") lastMain = screen;
  screen = next;
  applyScreen();
  const scroller = app.querySelector("[data-screen-scroll]");
  if (scroller) scroller.scrollTo(0, 0);
}

function applyScreen() {
  for (const el of app.querySelectorAll("[data-screen-panel]")) {
    el.hidden = el.dataset.screenPanel !== screen;
  }
  const isMain = screen === "input" || screen === "result";
  app.classList.toggle("is-sub", !isMain);
  const hero = app.querySelector("#hero");
  if (hero) hero.hidden = !isMain;
  const nav = app.querySelector("[data-bottom-nav]");
  if (nav) nav.hidden = !isMain;
  const back = app.querySelector("[data-back]");
  if (back) back.hidden = isMain;
  for (const b of app.querySelectorAll("[data-goto]")) {
    b.setAttribute("aria-pressed", String(b.dataset.goto === screen));
  }
}

/**
 * ストアアプリ版でAdMobの全画面広告を挟むための差し込み点。
 * Web版（AdSense）では呼ばない。一覧表（マトリクス）タブを、
 * 結果画面に来て以降・別タブから切り替えて開いたときだけ、1セッション1回で呼ぶ。
 */
let matrixInterstitialShown = false;
function maybeShowMatrixInterstitial() {
  if (!globalThis.Capacitor?.isNativePlatform?.()) return;
  import("./ads-native.js")
    .then((m) => m.showMatrixInterstitial())
    .catch(() => {});
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
  // ブラウザのUI色。端末に合わせる場合は media 付きの指定にまかせる。
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
    const key = b.dataset.stepFor === "rate" ? "rateStep" : "principalStep";
    b.setAttribute("aria-pressed", String(num(S[key]) === num(b.dataset.value)));
  }
  const noRules = S.method !== "equal-payment" || S.rateType !== "variable";
  app.querySelector('[data-toggle="fiveYearRule"]').disabled = noRules;
  app.querySelector('[data-toggle="cap125"]').disabled = noRules || !S.fiveYearRule;
}

function syncSlider(key, decimals) {
  const input = app.querySelector(`#r-${key}`);
  const b = BOUNDS[key];
  const v = num(S[key]);
  input.step = String(stepOf(key));
  input.value = String(v);
  input.style.setProperty("--pct", `${((v - b.min) / (b.max - b.min)) * 100}%`);
  const target = app.querySelector(`[data-out="${key}"]`);
  if (target) {
    target.textContent = v.toLocaleString("ja-JP", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

/* --- マトリクス --- */

function matrixHtml() {
  const rateStep = Math.max(0.05, num(S.rateStep) * 5 >= 0.25 ? num(S.rateStep) * 5 : 0.25);
  const rates = [-2, -1, 0, 1, 2].map((k) =>
    clamp(round3(S.rate + k * rateStep), BOUNDS.rate.min, BOUNDS.rate.max)
  );
  const byPrincipal = S.matrixAxis === "principal";
  const rowStep = Math.max(50, num(S.principalStep) * 10);
  const offset = num(byPrincipal ? S.matrixOffsetP : S.matrixOffsetY);
  const rawRows = byPrincipal
    ? [-3, -2, -1, 0, 1, 2, 3].map((k) =>
        clamp(S.principalMan + (k + offset) * rowStep, BOUNDS.principalMan.min, BOUNDS.principalMan.max)
      )
    : [-2, -1, 0, 1, 2].map((k) => clamp(S.years + (k + offset) * 5, BOUNDS.years.min, BOUNDS.years.max));
  // 上限・下限近くではパンしても値が重なる。重複行は畳む。
  const rows = [...new Set(rawRows)];

  const budget = toYen(S.budgetMan);
  const bonusBudget = toYen(S.bonusBudgetMan);
  const pct = clamp(num(S.bonusPct), 0, BONUS_MAX_PCT);

  // 毎月分とボーナス分を分けて計算し、それぞれの上限と比べる。
  // 借りたい額のボーナス設定と同じ考え方（毎月にボーナス分は含まない）。
  const cellValue = (rowVal, rate) => {
    const total = byPrincipal ? toYen(rowVal) : toYen(S.principalMan);
    const years = byPrincipal ? S.years : rowVal;
    const months = Math.round(years * 12);
    const bonusPart = Math.round((total * pct) / 100);
    const monthlyPart = total - bonusPart;
    const monthlyPay = Math.ceil(monthlyPayment(monthlyPart, rate, months));
    const bonusPay = bonusPart > 0 ? Math.ceil(bonusPayment(bonusPart, rate, years)) : 0;
    return { monthlyPay, bonusPay };
  };

  const all = rows.flatMap((r) => rates.map((rt) => cellValue(r, rt).monthlyPay));
  const lo = Math.min(...all);
  const hi = Math.max(...all);

  const head = `<tr><th scope="col" class="corner">${byPrincipal ? "借入額" : "期間"} \\ 金利</th>${rates
    .map((rt) => `<th scope="col">${trim(rt)}%</th>`)
    .join("")}</tr>`;

  const body = rows
    .map((rowVal) => {
      const cells = rates
        .map((rt) => {
          const { monthlyPay, bonusPay } = cellValue(rowVal, rt);
          const over = (budget > 0 && monthlyPay > budget) || (bonusBudget > 0 && bonusPay > bonusBudget);
          const heat = hi > lo ? (monthlyPay - lo) / (hi - lo) : 0;
          const now = Math.abs(rt - S.rate) < 1e-9 && (byPrincipal ? rowVal === S.principalMan : rowVal === S.years);
          const bonusNote = bonusPay > 0 ? `・ボーナス月${yen(bonusPay)}` : "";
          return `<td>
            <button type="button" class="cell ${over ? "is-over" : "is-ok"} ${now ? "is-current" : ""}"
              style="--heat:${heat.toFixed(3)}"
              data-cell="${byPrincipal ? "principalMan" : "years"}" data-row="${rowVal}" data-rate="${rt}"
              aria-label="${byPrincipal ? `借入${rowVal}万円` : `期間${rowVal}年`}・金利${trim(rt)}%なら毎月${yen(monthlyPay)}${bonusNote}${now ? "。今の条件" : ""}">
              <b>${(monthlyPay / 10_000).toFixed(1)}<span>万</span></b>
            </button></td>`;
        })
        .join("");
      return `<tr><th scope="row">${byPrincipal ? `${rowVal.toLocaleString("ja-JP")}万` : `${rowVal}年`}</th>${cells}</tr>`;
    })
    .join("");

  return `<table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/* --- ボーナスの指定 --- */

function bonusBodyHtml(c) {
  const sp = c.split;
  if (S.bonusMode === "yen") {
    return `<div class="bonus-yen">
      <button type="button" class="step tiny" data-bonus-yen="-1" aria-label="ボーナス分を減らす">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
      </button>
      <input type="number" inputmode="decimal" data-field="bonusMan" value="${S.bonusMan || ""}" placeholder="0" aria-label="ボーナス返済にまわす金額（万円）"/>
      <span>万円</span>
      <button type="button" class="step tiny" data-bonus-yen="1" aria-label="ボーナス分を増やす">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <em>元金の ${sp.pct.toFixed(1)}%（上限 ${manShort(sp.cap)}）</em>
    </div>`;
  }
  return `<div class="presets tight">
      ${[0, 10, 20, 30, 40, 50]
        .map(
          (v) => `<button type="button" class="pill sm" data-preset="bonusPct" data-value="${v}">${v}%</button>`
        )
        .join("")}
    </div>`;
}

/* --- 金利パスの編集 --- */

function ratePointsHtml() {
  const list = points();
  if (!list.length) {
    return `<p class="rp-empty">変更ポイントがない状態。ずっと ${trim(num(S.rate))}% のままで見ている。</p>`;
  }
  const steps = ratePathSteps(S.rate, list, 1);
  const sorted = [...list].sort((a, b) => a.year - b.year);
  return sorted
    .map((pt, i) => {
      const st = steps[i];
      const sign = pt.delta >= 0 ? "+" : "−";
      return `<div class="rp-row">
        <div class="rp-cell">
          <span class="rp-tag">いつ</span>
          <div class="rp-stepper">
            <button type="button" class="step tiny" data-pt="${i}" data-fld="year" data-dir="-1" aria-label="時期を早める">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
            </button>
            <b>${pt.year}年後</b>
            <button type="button" class="step tiny" data-pt="${i}" data-fld="year" data-dir="1" aria-label="時期を遅らせる">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
        <div class="rp-cell">
          <span class="rp-tag">動く幅</span>
          <div class="rp-stepper">
            <button type="button" class="step tiny" data-pt="${i}" data-fld="delta" data-dir="-1" aria-label="動く幅を小さく">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
            </button>
            <b class="${pt.delta < 0 ? "is-down" : ""}">${sign}${Math.abs(pt.delta).toFixed(1)}%</b>
            <button type="button" class="step tiny" data-pt="${i}" data-fld="delta" data-dir="1" aria-label="動く幅を大きく">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
        <div class="rp-result"><span>金利は</span><b>${trim(st.rate)}%</b></div>
        <button type="button" class="rp-del" data-del-pt="${i}" aria-label="${pt.year}年後の変更を削除">×</button>
      </div>`;
    })
    .join("");
}

/** どんな条件で計算しているかを、必ず文にして出す。 */
function rateSummaryHtml(c) {
  const steps = picked().steps;
  if (!steps.length) return `いまの想定：<b>${trim(num(S.rate))}%</b> のまま動かない。`;
  const chain = steps
    .map(
      (st) =>
        `<span class="rp-arrow">→</span><span class="rp-when">${st.year}年後</span> ${
          st.delta >= 0 ? "+" : "−"
        }${Math.abs(st.delta).toFixed(1)} <b>${trim(st.rate)}%</b>`
    )
    .join(" ");
  return `いまの想定：当初 <b>${trim(num(S.rate))}%</b> ${chain}`;
}

/* --- 上がったらいくらか、という答え --- */

function answerHtml(c) {
  const b = picked();
  const now = c.monthly;
  const after = b.run.peakMonthlyPay;
  const diff = after - now;
  const changes = paymentSteps(b.run.rows).slice(1);
  // 「いつ最大に達するか」を書く。末尾の微修正ではなく、最大額に届いた時点。
  const toPeak = changes.find((ch) => Math.abs(ch.pay - after) < 100) || changes[changes.length - 1];
  const whenLabel = toPeak == null ? "変わらない" : `${Math.floor((toPeak.month - 1) / 12) + 1}年目に`;
  const finalRate = b.steps.length ? b.steps[b.steps.length - 1].rate : num(S.rate);

  const ladder = changes.length
    ? `<ol class="ans-steps">
        <li><span>いま</span><b>${yen(now)}</b></li>
        ${changes
          .map(
            (ch) =>
              `<li><span>${Math.floor((ch.month - 1) / 12) + 1}年目</span><b>${yen(ch.pay)}</b></li>`
          )
          .join("")}
      </ol>`
    : "";

  return `
    <div class="ans-flow">
      <div class="ans-cell">
        <span>いま（${trim(num(S.rate))}%）</span>
        <b>${yen(now)}</b>
        <small>毎月</small>
      </div>
      <div class="ans-arrow" aria-hidden="true">
        <svg viewBox="0 0 40 24"><path d="M2 12h34M28 4l8 8-8 8"/></svg>
        <em>${whenLabel}</em>
      </div>
      <div class="ans-cell is-after">
        <span>最終的に ${trim(finalRate)}% なら</span>
        <b>${yen(after)}</b>
        <small>毎月　<i>${diff >= 0 ? "+" : "−"}${yen(Math.abs(diff))}</i></small>
      </div>
    </div>
    ${ladder}
    <dl class="ans-total">
      <div>
        <dt>総返済</dt>
        <dd>${manShort(c.base.totalPaid)} → <b>${manShort(b.run.totalPaid)}</b> <i>+${manShort(b.run.totalPaid - c.base.totalPaid)}</i></dd>
      </div>
      ${
        c.bonusEach > 0
          ? `<div>
        <dt>ボーナス月</dt>
        <dd>${yen(c.bonusEach)} → <b>${yen(b.run.peakBonusPay)}</b> <i>+${yen(b.run.peakBonusPay - c.bonusEach)}</i></dd>
      </div>`
          : ""
      }
    </dl>
    ${residualHtml(b.run)}`;
}

/**
 * 125%ルールで返済額の増加を抑えると、抑えた分が完済期日に残債として残る。
 * 総返済は「返した額」なのでこの残債を含まない。含まないまま出すと
 * 負担を小さく見せてしまうので、残るときだけ別建てで足して見せる。
 */
function residualHtml(run) {
  if (!(run.residual > 10_000)) return "";
  return `
    <div class="residual-warn">
      <p class="residual-head">125%ルールが適用され、完済期日に債務が残ります</p>
      <dl>
        <div>
          <dt>完済期日の残債</dt>
          <dd><b>${manShort(run.residual)}</b></dd>
        </div>
        <div>
          <dt>総返済（返済分）</dt>
          <dd>${manShort(run.totalPaid)}</dd>
        </div>
        <div class="is-sum">
          <dt>実質の負担</dt>
          <dd><b>${manShort(run.totalPaid + run.residual)}</b></dd>
        </div>
      </dl>
      <p class="residual-note">返済額の増加を抑えた分が、完済期日にまとめて残ります。</p>
    </div>`;
}


/* --- 諸費用・家計 --- */

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
    const filename = `住宅ローン試算_${todayStamp()}.png`;

    if (kind === "native") {
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "住宅ローン試算", text: buildShareText(data) });
          status.textContent = "共有しました。";
          return;
        } catch {
          return; // ユーザーが共有をキャンセルしただけの場合が多い。何もしない。
        }
      }
      if (navigator.share) {
        try {
          await navigator.share({ title: "住宅ローン試算", text: buildShareText(data) });
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

    // kind === "image"
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

/** 項目キー→state のフィールド名。手入力で上書きできる項目だけここに持つ。 */
function costHintCell(field, value, label) {
  return `<input type="text" inputmode="decimal" class="cell-input" data-field="${field}"
    value="${value === "" || value == null ? "" : value}"
    placeholder="0"
    aria-label="${label}（万円）"/><span class="unit">万円</span>`;
}

function costsHtml(costs) {
  const contractRows = costs.contractItems
    .map(
      (item, i) => `<div class="contract-row">
        <input type="text" class="contract-label" data-contract-label="${i}" value="${item.label}" placeholder="項目名"/>
        <input type="text" inputmode="decimal" class="cell-input" data-contract-man="${i}"
          value="${item.man === "" || item.man == null ? "" : item.man}"
          placeholder="0"
          aria-label="${item.label || "項目"}（万円）"/>
        <span class="unit">万円</span>
        ${costs.contractItems.length > 1 ? `<button type="button" class="row-del" data-del-contract="${i}" aria-label="この項目を削除">×</button>` : '<span class="row-del-space"></span>'}
      </div>`
    )
    .join("");

  const settlementRows = costs.settlementItems
    .map(
      (i) => `<tr>
        <th scope="row">${i.label}</th>
        <td class="amount">${costHintCell(i.field, S[i.field], i.label)}</td>
      </tr>`
    )
    .join("");

  const settlementExtraRows = costs.settlementExtra
    .map(
      (item, i) => `<div class="contract-row">
        <input type="text" class="contract-label" data-settlement-label="${i}" value="${item.label}" placeholder="項目名"/>
        <input type="text" inputmode="decimal" class="cell-input" data-settlement-man="${i}"
          value="${item.man === "" || item.man == null ? "" : item.man}"
          placeholder="0"
          aria-label="${item.label || "項目"}（万円）"/>
        <span class="unit">万円</span>
        <button type="button" class="row-del" data-del-settlement="${i}" aria-label="この項目を削除">×</button>
      </div>`
    )
    .join("");

  return `
    <dl class="cost-tiers">
      <div>
        <dt>物件価格</dt>
        <dd><input type="text" inputmode="decimal" data-field="propertyMan" value="${S.propertyMan || ""}" placeholder="3500"/><span class="unit">万円</span></dd>
      </div>
      <div class="is-computed">
        <dt>諸費用</dt>
        <dd><b>${man(costs.fees, { decimals: 1 })}</b></dd>
      </div>
      <div>
        <dt>自己資金</dt>
        <dd><input type="text" inputmode="decimal" data-field="ownFundsMan" value="${S.ownFundsMan || ""}" placeholder="0"/><span class="unit">万円</span></dd>
      </div>
    </dl>
    <p class="cost-required"><span>必要な借入額</span><b>${man(costs.requiredLoan, { decimals: 1 })}</b></p>

    <div class="cost-group boxed">
      <h3>契約時の諸費用（請負・売買）</h3>
      <table class="data-table costs"><tbody>
        <tr><th scope="row">手付金（物件価格に充当・要借入額から差し引く）</th><td class="amount">${costHintCell("depositMan", S.depositMan, "手付金")}</td></tr>
      </tbody></table>
      <div class="contract-items">${contractRows}</div>
      <button type="button" class="rp-add" data-add-contract-item ${costs.contractItems.length >= CONTRACT_ITEM_MAX ? "disabled" : ""}>＋ その他を追加</button>
    </div>

    <div class="cost-group boxed">
      <h3>決済時の諸費用</h3>
      <table class="data-table costs"><tbody>${settlementRows}</tbody></table>
      <div class="contract-items">${settlementExtraRows}</div>
      <button type="button" class="rp-add" data-add-settlement-item ${costs.settlementExtra.length >= SETTLEMENT_EXTRA_MAX ? "disabled" : ""}>＋ その他を追加</button>
      <p class="panel-note">グレーの数字は目安。銀行・契約形態で実額が変わるので、わかっている金額をそのまま入れる。</p>
    </div>`;
}

function householdHtml(c) {
  if (c.dti == null && c.surplus == null) {
    return `<p class="hint">家計情報を入れると、返済負担率や収支が確認できます。</p>`;
  }
  const items = [];
  if (c.dti != null) {
    const over = c.dti > 0.35;
    items.push(
      `<div class="mini ${over ? "is-warn" : ""}"><span>返済負担率</span><b>${percent(c.dti)}</b><small>${over ? "35%を超えている" : "35%以内"}。審査の合否ではない</small></div>`
    );
  }
  if (c.surplus != null) {
    const thin = c.surplus < 50_000;
    items.push(
      `<div class="mini ${thin ? "is-warn" : ""}"><span>毎月の残り</span><b>${yen(c.surplus)}</b><small>手取り − ローン − 生活費</small></div>`
    );
  }
  return `<div class="minis">${items.join("")}</div>`;
}

function readoutHtml(c, i) {
  const y = c.yearly[Math.min(i, c.yearly.length - 1)];
  if (!y) return "";
  const share = y.payment > 0 ? y.interest / y.payment : 0;
  return `<b>${y.year}年目</b>
    <span class="principal">元金 ${yen(y.principal)}</span>
    <span class="interest">利息 ${yen(y.interest)}（${percent(share)}）</span>
    <span>残高 ${man(y.balance)}</span>`;
}

/* --- 全体更新 --- */

let current = null;
let dragging = false;

const FOCUS_KEY_ATTRS = [
  "data-field",
  "data-contract-man",
  "data-contract-label",
  "data-settlement-man",
  "data-settlement-label",
];

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
  const costs = costsBreakdown();

  out.condDate.textContent = `${TODAY_LABEL} 時点`;
  {
    const d = shareData(c);
    const rows = [
      ...d.rows,
      ["諸費用", yen(costs.fees)],
      ["団信・税・保険料", "一部概算"],
      ["金利上昇の試算", riseSummary()],
      ["総額（ローン＋諸費用）", manShort(c.base.totalPaid + costs.fees)],
    ];
    out.condGrid.innerHTML = rows
      .map(([label, value]) => `<div class="cond-item"><span>${label}</span><b>${value}</b></div>`)
      .join("");
  }

  out.heroMonthly.textContent = yen(c.monthly);
  out.heroBonus.textContent = c.bonusEach > 0 ? `＋${yen(c.bonusEach)}` : "なし";
  out.heroBonus.classList.toggle("is-none", !(c.bonusEach > 0));
  out.heroTotal.textContent = manShort(c.base.totalPaid);
  out.heroInterest.textContent = manShort(c.base.totalInterest);
  out.heroShare.textContent = percent(c.base.totalPaid > 0 ? c.base.totalInterest / c.base.totalPaid : null);

  out.bonusBody.innerHTML = bonusBodyHtml(c);
  out.split.innerHTML =
    c.split.bonus > 0
      ? `毎月分 <b>${manShort(c.split.monthly)}</b>　／　ボーナス分 <b>${manShort(c.split.bonus)}</b>`
      : "";
  out.bonusSummary.textContent = c.split.bonus > 0 ? manShort(c.split.bonus) : "なし";
  out.bonusPanel.hidden = !bonusOpen;
  app.querySelector("[data-bonus-toggle]").setAttribute("aria-expanded", String(bonusOpen));

  out.budget.textContent = `${num(S.budgetMan).toFixed(1)}万`;
  out.bonusBudget.textContent = `${num(S.bonusBudgetMan).toFixed(1)}万`;
  out.bonusBudgetRow.hidden = !(c.split.bonus > 0);
  out.matrix.innerHTML = matrixHtml();

  out.chartAmort.innerHTML = amortizationChart(c.yearly, c.split.total);
  out.readBreakdown.innerHTML = readoutHtml(c, 0);

  out.rpBase.textContent = `${trim(num(S.rate))}%`;
  out.rpRows.innerHTML = ratePointsHtml();
  out.rpSummary.innerHTML = rateSummaryHtml(c);
  out.answer.innerHTML = answerHtml(c);

  const pick = picked();
  const baseSeries = c.yearly.map((y) => y.monthlyPay);
  const pickSeries = toYearly(pick.run.rows).map((y) => y.monthlyPay);
  const changes = paymentSteps(pick.run.rows).slice(1);
  // 段が出そろう年 + 少しの余韻まで描く。残りの横ばいは切る。
  const lastChangeYear = changes.length ? Math.floor((changes[changes.length - 1].month - 1) / 12) + 1 : 0;
  const lastMarkYear = pick.steps.length ? pick.steps[pick.steps.length - 1].year : 0;
  const focusYears = clamp(Math.max(lastChangeYear, lastMarkYear) + 4, 8, S.years);
  out.chartPayment.innerHTML = paymentStepChart(baseSeries, pickSeries, {
    marks: pick.steps.map((st) => ({ year: st.year, label: `${trim(st.rate)}%` })),
    stepLabels: changes.map((ch) => ({
      year: Math.floor((ch.month - 1) / 12),
      pay: ch.pay,
      text: `${(ch.pay / 10_000).toFixed(1)}万`,
    })),
    ceiling: c.ceiling,
    focusYears,
    totalYears: S.years,
  });
  replacePreservingFocus(out.costs, costsHtml(costs));
  out.household.innerHTML = householdHtml(c);

  for (const w of app.querySelectorAll(".chart-wrap")) w.classList.toggle("no-anim", dragging);

  applyPrefs();
  setStates();
  applyResultTab();
  save();
}

/* ------------------------------------------------------------ 操作 */

function snap(v, step) {
  return step > 0 ? Math.round(v / step) * step : v;
}

function setKey(key, value) {
  const b = BOUNDS[key];
  let v = num(value);
  if (b) v = clamp(v, b.min, b.max);
  if (key === "rate") v = round3(v);
  // min=1のスライダーをドラッグすると、ブラウザ側の刻みは min+n*step で
  // 計算されるため、100万刻みでも1万円分ずれることがある。刻みへ再整列する。
  if (key === "principalMan") v = clamp(snap(v, stepOf(key)), b.min, b.max);
  S[key] = v;
  if (key === "principalMan") S.matrixOffsetP = 0;
  if (key === "years") S.matrixOffsetY = 0;
  syncAll();
}

function syncAll() {
  syncSlider("principalMan", 0);
  syncSlider("years", 0);
  syncSlider("rate", 3);
  update();
}

app.addEventListener("input", (e) => {
  const range = e.target.closest(".range");
  if (range) {
    dragging = true;
    setKey(range.id.replace("r-", ""), range.value);
    return;
  }
  const field = e.target.closest("[data-field]");
  if (field) {
    S[field.dataset.field] = field.value === "" ? 0 : num(field.value);
    update();
    return;
  }
  const contractLabel = e.target.closest("[data-contract-label]");
  if (contractLabel) {
    const items = contractItemsCopy();
    const i = Number(contractLabel.dataset.contractLabel);
    if (items[i]) items[i].label = contractLabel.value;
    S.contractItems = items;
    update();
    return;
  }
  const contractMan = e.target.closest("[data-contract-man]");
  if (contractMan) {
    const items = contractItemsCopy();
    const i = Number(contractMan.dataset.contractMan);
    if (items[i]) items[i].man = contractMan.value === "" ? "" : num(contractMan.value);
    S.contractItems = items;
    update();
    return;
  }
  const settlementLabel = e.target.closest("[data-settlement-label]");
  if (settlementLabel) {
    const items = settlementExtraCopy();
    const i = Number(settlementLabel.dataset.settlementLabel);
    if (items[i]) items[i].label = settlementLabel.value;
    S.settlementExtra = items;
    update();
    return;
  }
  const settlementMan = e.target.closest("[data-settlement-man]");
  if (settlementMan) {
    const items = settlementExtraCopy();
    const i = Number(settlementMan.dataset.settlementMan);
    if (items[i]) items[i].man = settlementMan.value === "" ? "" : num(settlementMan.value);
    S.settlementExtra = items;
    update();
  }
});

app.addEventListener("change", (e) => {
  if (e.target.closest(".range")) {
    dragging = false;
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
let matrixDrag = null;

function stopRepeat() {
  clearTimeout(repeatTimer);
  repeatTimer = null;
  matrixDrag = null;
  if (dragging) {
    dragging = false;
    update();
  }
}
// 指を離す場所がアプリの外でも必ず止める。window で受ける。
["pointerup", "pointercancel", "blur"].forEach((ev) =>
  window.addEventListener(ev, stopRepeat, true)
);

app.addEventListener("pointerdown", (e) => {
  const nudge = e.target.closest("[data-nudge]");
  if (nudge) {
    const key = nudge.closest(".ctrl").dataset.key;
    const dir = Number(nudge.dataset.nudge);
    dragging = true;
    startRepeat(() => setKey(key, num(S[key]) + dir * stepOf(key)));
    return;
  }
  const pt = e.target.closest("[data-pt]");
  if (pt) {
    const i = Number(pt.dataset.pt);
    const fld = pt.dataset.fld;
    const dir = Number(pt.dataset.dir);
    dragging = true;
    startRepeat(() => {
      const list = sortedPoints();
      const target = list[i];
      if (!target) return;
      if (fld === "year") {
        target.year = clamp(target.year + dir * POINT_YEAR.step, POINT_YEAR.min, POINT_YEAR.max);
      } else {
        target.delta = round3(clamp(target.delta + dir * POINT_DELTA.step, POINT_DELTA.min, POINT_DELTA.max));
      }
      S.ratePoints = list;
      update();
    });
    return;
  }
  const by = e.target.closest("[data-bonus-yen]");
  if (by) {
    const dir = Number(by.dataset.bonusYen);
    const grid = num(S.bonusMan) >= 500 ? 50 : 10;
    dragging = true;
    startRepeat(() => {
      const cap = splitPrincipal().cap / 10_000;
      S.bonusMan = clamp(round3(num(S.bonusMan) + dir * grid), 0, cap);
      update();
    });
    return;
  }
  const pan = e.target.closest("[data-pan]");
  if (pan) {
    const dir = Number(pan.dataset.pan);
    dragging = true;
    startRepeat(() => {
      const key = S.matrixAxis === "principal" ? "matrixOffsetP" : "matrixOffsetY";
      S[key] = clamp(num(S[key]) + dir, -40, 40);
      update();
    });
    return;
  }
  const bonusBudget = e.target.closest("[data-bonus-budget]");
  if (bonusBudget) {
    const dir = Number(bonusBudget.dataset.bonusBudget);
    dragging = true;
    startRepeat(() => {
      S.bonusBudgetMan = Math.max(0, round3(num(S.bonusBudgetMan) + dir * 0.5));
      update();
    });
    return;
  }
  const budget = e.target.closest("[data-budget]");
  if (budget) {
    const dir = Number(budget.dataset.budget);
    dragging = true;
    startRepeat(() => {
      S.budgetMan = Math.max(0, round3(num(S.budgetMan) + dir * 0.1));
      update();
    });
    return;
  }
  // マトリクスの行見出しを縦にドラッグして、表示範囲をスワイプで動かす。
  const rowHandle = e.target.closest(".matrix tbody th");
  if (rowHandle) {
    matrixDrag = {
      startY: e.clientY,
      key: S.matrixAxis === "principal" ? "matrixOffsetP" : "matrixOffsetY",
      moved: 0,
    };
  }
});

app.addEventListener("click", (e) => {
  const stepFor = e.target.closest("[data-step-for]");
  if (stepFor) {
    const key = stepFor.dataset.stepFor;
    const v = num(stepFor.dataset.value);
    if (key === "rate") {
      S.rateStep = v;
      S.rate = clamp(round3(snap(S.rate, v)), BOUNDS.rate.min, BOUNDS.rate.max);
    } else {
      S.principalStep = v;
      S.principalMan = clamp(snap(S.principalMan, v), BOUNDS.principalMan.min, BOUNDS.principalMan.max);
    }
    syncAll();
    return;
  }
  if (e.target.closest("[data-add-point]")) {
    const list = sortedPoints();
    if (list.length < POINT_MAX) {
      const lastYear = list.length ? list[list.length - 1].year : 0;
      list.push({ year: clamp(lastYear + 5, POINT_YEAR.min, POINT_YEAR.max), delta: 0.5 });
      S.ratePoints = list;
      update();
    }
    return;
  }
  const delPt = e.target.closest("[data-del-pt]");
  if (delPt) {
    const list = sortedPoints();
    list.splice(Number(delPt.dataset.delPt), 1);
    S.ratePoints = list;
    update();
    return;
  }
  if (e.target.closest("[data-add-contract-item]")) {
    const items = contractItemsCopy();
    if (items.length < CONTRACT_ITEM_MAX) {
      items.push({ label: "", man: "" });
      S.contractItems = items;
      update();
    }
    return;
  }
  const delContract = e.target.closest("[data-del-contract]");
  if (delContract) {
    const items = contractItemsCopy();
    items.splice(Number(delContract.dataset.delContract), 1);
    S.contractItems = items;
    update();
    return;
  }
  if (e.target.closest("[data-add-settlement-item]")) {
    const items = settlementExtraCopy();
    if (items.length < SETTLEMENT_EXTRA_MAX) {
      items.push({ label: "", man: "" });
      S.settlementExtra = items;
      update();
    }
    return;
  }
  const delSettlement = e.target.closest("[data-del-settlement]");
  if (delSettlement) {
    const items = settlementExtraCopy();
    items.splice(Number(delSettlement.dataset.delSettlement), 1);
    S.settlementExtra = items;
    update();
    return;
  }
  const help = e.target.closest("[data-help]");
  if (help) {
    const body = document.getElementById("rules-help");
    const open = body.hidden;
    body.hidden = !open;
    help.setAttribute("aria-expanded", String(open));
    return;
  }
  if (e.target.closest("[data-bonus-toggle]")) {
    bonusOpen = !bonusOpen;
    update();
    return;
  }
  const preset = e.target.closest("[data-preset]");
  if (preset) {
    const key = preset.dataset.preset;
    if (key === "bonusPct") {
      S.bonusPct = clamp(num(preset.dataset.value), 0, BONUS_MAX_PCT);
      S.bonusMode = "pct";
      update();
    } else {
      setKey(key, preset.dataset.value);
    }
    return;
  }
  const set = e.target.closest("[data-set]");
  if (set) {
    const key = set.dataset.set;
    const raw = set.dataset.value;
    S[key] = Number.isNaN(Number(raw)) ? raw : Number(raw);
    if (key === "rateType") {
      // 固定・フラット35は5年ルール／125%ルールの対象外（変動特有の商品性）。
      S.fiveYearRule = S.rateType === "variable";
      S.cap125 = S.fiveYearRule;
    }
    if (key === "matrixAxis") {
      S.matrixOffsetP = 0;
      S.matrixOffsetY = 0;
    }
    update();
    return;
  }
  const shareBtn = e.target.closest("[data-share]");
  if (shareBtn) {
    handleShare(shareBtn.dataset.share);
    return;
  }
  const goto = e.target.closest("[data-goto]");
  if (goto) {
    setScreen(goto.dataset.goto);
    return;
  }
  if (e.target.closest("[data-back]")) {
    setScreen(lastMain);
    return;
  }
  if (e.target.closest("[data-apply-required-loan]")) {
    const required = Math.round(costsBreakdown().requiredLoan / 10_000);
    const b = BOUNDS.principalMan;
    S.principalMan = clamp(required, b.min, b.max);
    S.matrixOffsetP = 0;
    syncAll();
    setScreen("input");
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    const next = tab.dataset.tab;
    if (next === "matrix" && S.resultTab !== "matrix" && !matrixInterstitialShown) {
      matrixInterstitialShown = true;
      maybeShowMatrixInterstitial();
    }
    S.resultTab = next;
    applyResultTab();
    save();
    return;
  }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle && !toggle.disabled) {
    S[toggle.dataset.toggle] = !S[toggle.dataset.toggle];
    update();
    return;
  }
  const cell = e.target.closest("[data-cell]");
  if (cell) {
    S[cell.dataset.cell] = num(cell.dataset.row);
    S.rate = round3(num(cell.dataset.rate));
    S.matrixOffsetP = 0;
    S.matrixOffsetY = 0;
    syncAll();
    app.querySelector("[data-screen-scroll]")?.scrollTo({ top: 0, behavior: "smooth" });
  }
});

/* グラフのスクラブ */
const MATRIX_ROW_PX = 44;

app.addEventListener("pointermove", (e) => {
  if (matrixDrag) {
    const dy = e.clientY - matrixDrag.startY;
    // 下へドラッグ＝小さい値の方を見る、という向きに合わせる。
    const steps = -Math.trunc(dy / MATRIX_ROW_PX) - matrixDrag.moved;
    if (steps !== 0) {
      S[matrixDrag.key] = clamp(num(S[matrixDrag.key]) + steps, -40, 40);
      matrixDrag.moved += steps;
      update();
    }
    return;
  }
  const wrap = e.target.closest(".chart-wrap");
  if (!wrap || !current) return;
  const svg = wrap.querySelector("svg");
  if (!svg) return;
  const count = current.yearly.length;
  const i = indexFromPointer(svg, e.clientX, count);
  const line = svg.querySelector(".scrub-line");
  if (line) {
    const x = wrap.dataset.chart === "amort" ? xForBar(i, count) : xForIndex(i, count);
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.style.opacity = "1";
  }
  if (wrap.dataset.chart === "amort") {
    out.readBreakdown.innerHTML = readoutHtml(current, i);
    out.scrubHint?.classList.add("is-done");
  }
});


/* 予算の初期値は今の月々に合わせる */
if (!localStorage.getItem(STORAGE_KEY)) {
  const first = monthlyPayment(toYen(S.principalMan), S.rate, S.years * 12);
  S.budgetMan = Math.ceil(first / 10_000 / 0.5) * 0.5;
}

applyScreen();
syncAll();

if (globalThis.Capacitor?.isNativePlatform?.()) {
  import("./ads-native.js")
    .then((m) => m.initNativeAds())
    .catch(() => {});
} else {
  import("./monetization.js")
    .then((m) => {
      const mon = m.createMonetization({ propertyId: "jutaku-loan" });
      mon.pageView({ placement: "auto" });
      for (const network of shownAffiliateNetworks()) {
        mon.affiliateView({ network, placement: "result" });
      }
    })
    .catch(() => {});
}
