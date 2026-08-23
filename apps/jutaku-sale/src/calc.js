/* ============================================================
   売却計算のコア。UIから切り離した純関数だけを置く。
   金額は円。所有期間は「譲渡した年の1月1日時点」で数える年。

   手取りと税金は、引ける費用の範囲が違う。
   ・手取り  … 実際に財布から出る費用をすべて引く
   ・譲渡費用 … 税法上「売るために直接かかった費用」だけ
   抵当権抹消やローンの一括返済手数料は前者に入り、後者には入らない。
   この差を混ぜると税額がずれるので、costs と taxCosts を分けて持つ。
   ============================================================ */

/* ------------------------------------------------------------
   1. 仲介手数料（宅建業法の上限）
   ------------------------------------------------------------ */

/**
 * 法定上限の仲介手数料。税抜の速算後に消費税を足す。
 * lowPrice: 800万円以下の物件で、あらかじめ合意した場合に使える
 *           上限 33万円（税込）の枠。2024年7月からの取扱い。
 */
export function brokerageCap(priceYen, { taxRate = 0.1, lowPrice = false } = {}) {
  const p = Math.max(0, priceYen);
  if (p <= 0) return 0;
  let base;
  if (p <= 2_000_000) base = p * 0.05;
  else if (p <= 4_000_000) base = p * 0.04 + 20_000;
  else base = p * 0.03 + 60_000;
  const withTax = base * (1 + taxRate);
  if (lowPrice && p <= 8_000_000) return Math.max(withTax, 330_000);
  return withTax;
}

/* ------------------------------------------------------------
   2. 印紙税（不動産譲渡契約書）
   ------------------------------------------------------------ */

// [契約金額の上限, 本則, 軽減]。軽減措置は2027年3月31日まで。
const STAMP_TABLE = [
  [10_000, 0, 0],
  [100_000, 200, 200],
  [500_000, 400, 200],
  [1_000_000, 1_000, 500],
  [5_000_000, 2_000, 1_000],
  [10_000_000, 10_000, 5_000],
  [50_000_000, 20_000, 10_000],
  [100_000_000, 60_000, 30_000],
  [500_000_000, 100_000, 60_000],
  [1_000_000_000, 200_000, 160_000],
  [5_000_000_000, 400_000, 320_000],
];
const STAMP_OVER = [600_000, 480_000];

export function stampDuty(priceYen, { reduced = true } = {}) {
  const p = Math.max(0, priceYen);
  const col = reduced ? 2 : 1;
  for (const row of STAMP_TABLE) {
    if (p <= row[0]) return row[col];
  }
  return STAMP_OVER[reduced ? 1 : 0];
}

/* ------------------------------------------------------------
   3. 建物の減価償却（非事業用）
   ------------------------------------------------------------ */

/** 非事業用の償却率。法定耐用年数の1.5倍に対応する率。 */
export const STRUCTURES = [
  { id: "wood", label: "木造", rate: 0.031, years: 33 },
  { id: "mortar", label: "木骨モルタル", rate: 0.034, years: 30 },
  { id: "steel3", label: "軽量鉄骨（3mm以下）", rate: 0.036, years: 28 },
  { id: "steel4", label: "軽量鉄骨（3〜4mm）", rate: 0.025, years: 40 },
  { id: "steelHeavy", label: "重量鉄骨（4mm超）", rate: 0.02, years: 51 },
  { id: "rc", label: "鉄筋コンクリート", rate: 0.015, years: 70 },
];

export function structureRate(id) {
  return (STRUCTURES.find((s) => s.id === id) || STRUCTURES[0]).rate;
}

/**
 * 建物の減価償却費。取得価額の95%が上限。
 * 経過年数は6ヶ月以上を1年に切り上げ、6ヶ月未満は切り捨てる。
 */
export function depreciation(buildingYen, structureId, elapsedYears) {
  const b = Math.max(0, buildingYen);
  if (b <= 0) return 0;
  const years = Math.max(0, Math.floor(elapsedYears + 0.5));
  const raw = b * 0.9 * structureRate(structureId) * years;
  return Math.min(raw, b * 0.95);
}

/* ------------------------------------------------------------
   4. 取得費
   ------------------------------------------------------------ */

/**
 * 取得費を返す。
 * known=false、または実額が譲渡価額の5%を下回るときは概算取得費（5%）を使える。
 * どちらを使ったかを method で返し、画面で理由を出せるようにする。
 */
export function acquisitionCost({
  priceYen,
  known = true,
  landYen = 0,
  buildingYen = 0,
  purchaseCostYen = 0,
  structure = "wood",
  elapsedYears = 0,
}) {
  const estimated = Math.max(0, priceYen) * 0.05;
  if (!known) {
    return { total: estimated, method: "estimated", depreciation: 0, actual: 0, estimated };
  }
  const dep = depreciation(buildingYen, structure, elapsedYears);
  const actual = Math.max(0, landYen) + Math.max(0, buildingYen - dep) + Math.max(0, purchaseCostYen);
  if (actual < estimated) {
    return { total: estimated, method: "estimated", depreciation: dep, actual, estimated };
  }
  return { total: actual, method: "actual", depreciation: dep, actual, estimated };
}

/* ------------------------------------------------------------
   5. 譲渡所得と税額
   ------------------------------------------------------------ */

export const RESIDENTIAL_DEDUCTION = 30_000_000;

/** 復興特別所得税（所得税額の2.1%）込みの率。2037年まで。 */
export const TERMS = {
  short: { id: "short", label: "短期（5年以下）", income: 0.3063, resident: 0.09 },
  long: { id: "long", label: "長期（5年超）", income: 0.15315, resident: 0.05 },
};

/** 10年超所有の居住用財産。6,000万円以下の部分が軽くなる。 */
export const REDUCED_10Y = {
  threshold: 60_000_000,
  low: { income: 0.1021, resident: 0.04 },
  high: { income: 0.15315, resident: 0.05 },
};

/** 所有期間から短期・長期を判定する。譲渡した年の1月1日時点で数える。 */
export function termOf(heldYears) {
  return heldYears > 5 ? TERMS.long : TERMS.short;
}

/** 10年超軽減税率が使えるか。居住用で、1月1日時点の所有が10年超。 */
export function canUseReduced10(heldYears, isResidence) {
  return Boolean(isResidence) && heldYears > 10;
}

/**
 * 課税譲渡所得から税額を出す。
 * bands は「いくらの部分に何%かかったか」。画面でそのまま並べられる形で返す。
 */
export function transferTax(taxableYen, { heldYears = 0, isResidence = false, useReduced10 = true } = {}) {
  const taxable = Math.max(0, taxableYen);
  const empty = { income: 0, resident: 0, total: 0, bands: [], label: "—" };
  if (taxable <= 0) return empty;

  if (useReduced10 && canUseReduced10(heldYears, isResidence)) {
    const low = Math.min(taxable, REDUCED_10Y.threshold);
    const high = Math.max(0, taxable - REDUCED_10Y.threshold);
    const bands = [
      { amount: low, income: REDUCED_10Y.low.income, resident: REDUCED_10Y.low.resident, label: "6,000万円以下の部分" },
    ];
    if (high > 0) {
      bands.push({
        amount: high,
        income: REDUCED_10Y.high.income,
        resident: REDUCED_10Y.high.resident,
        label: "6,000万円を超える部分",
      });
    }
    const income = bands.reduce((s, b) => s + b.amount * b.income, 0);
    const resident = bands.reduce((s, b) => s + b.amount * b.resident, 0);
    return { income, resident, total: income + resident, bands, label: "10年超所有の軽減税率" };
  }

  const t = termOf(heldYears);
  const income = taxable * t.income;
  const resident = taxable * t.resident;
  return {
    income,
    resident,
    total: income + resident,
    bands: [{ amount: taxable, income: t.income, resident: t.resident, label: t.label }],
    label: t.label,
  };
}

/* ------------------------------------------------------------
   6. 売却にかかる費用
   ------------------------------------------------------------ */

/**
 * 費用の一覧を返す。deductible が true のものだけが譲渡費用になる。
 * extras は [{ label, yen, deductible }]。
 */
export function sellingCosts({
  priceYen,
  brokerageMode = "auto",
  brokerageYen = 0,
  brokerageTaxRate = 0.1,
  brokerageLowPrice = false,
  stampMode = "auto",
  stampYen = 0,
  stampReduced = true,
  releaseProperties = 0,
  releaseJudicialYen = 0,
  prepayFeeYen = 0,
  extras = [],
}) {
  const items = [];

  const brokerage =
    brokerageMode === "manual"
      ? Math.max(0, brokerageYen)
      : brokerageCap(priceYen, { taxRate: brokerageTaxRate, lowPrice: brokerageLowPrice });
  items.push({ id: "brokerage", label: "仲介手数料", yen: brokerage, deductible: true });

  const stamp = stampMode === "manual" ? Math.max(0, stampYen) : stampDuty(priceYen, { reduced: stampReduced });
  items.push({ id: "stamp", label: "印紙税（売買契約書）", yen: stamp, deductible: true });

  const release = Math.max(0, releaseProperties) * 1_000 + Math.max(0, releaseJudicialYen);
  if (release > 0) {
    // 抵当権抹消は「売るための費用」ではなく所有者側の後始末とされ、譲渡費用にならない。
    items.push({ id: "release", label: "抵当権抹消（登録免許税＋司法書士）", yen: release, deductible: false });
  }

  if (prepayFeeYen > 0) {
    items.push({ id: "prepay", label: "ローン一括返済手数料", yen: prepayFeeYen, deductible: false });
  }

  for (const [i, ex] of extras.entries()) {
    const yen = Math.max(0, Number(ex?.yen) || 0);
    if (yen <= 0 && !ex?.label) continue;
    items.push({
      id: `extra-${i}`,
      label: ex?.label || "その他",
      yen,
      deductible: Boolean(ex?.deductible),
    });
  }

  const total = items.reduce((s, it) => s + it.yen, 0);
  const deductible = items.reduce((s, it) => s + (it.deductible ? it.yen : 0), 0);
  return { items, total, deductible };
}

/* ------------------------------------------------------------
   7. 手取りまで通す
   ------------------------------------------------------------ */

/**
 * 売却価格から手取りまでを一度に出す。
 * 返り値の net が、ローンを返して税金を払ったあとに手元に残る額。
 * マイナスなら、その額を用意しないと抵当権が外せない。
 */
export function simulate(input) {
  const price = Math.max(0, input.priceYen || 0);
  const loan = Math.max(0, input.loanBalanceYen || 0);

  const costs = sellingCosts({ ...input, priceYen: price });

  const acquisition = acquisitionCost({
    priceYen: price,
    known: input.purchaseKnown !== false,
    landYen: input.purchaseLandYen || 0,
    buildingYen: input.purchaseBuildingYen || 0,
    purchaseCostYen: input.purchaseCostYen || 0,
    structure: input.structure || "wood",
    elapsedYears: input.elapsedYears || 0,
  });

  // 譲渡所得。特別控除は所得を超えて引けない（引ききれない分は捨てる）。
  const gross = price - acquisition.total - costs.deductible;
  const deductionCap = input.useDeduction && input.isResidence ? RESIDENTIAL_DEDUCTION : 0;
  const deduction = Math.min(Math.max(0, gross), deductionCap);
  const taxable = gross - deduction;

  const tax = transferTax(taxable, {
    heldYears: input.heldYears || 0,
    isResidence: Boolean(input.isResidence),
    useReduced10: input.useReduced10 !== false,
  });

  const beforeTax = price - costs.total - loan;
  const net = beforeTax - tax.total;

  return {
    price,
    loan,
    costs,
    acquisition,
    gross,
    deduction,
    deductionCap,
    taxable,
    tax,
    beforeTax,
    net,
    /** 手取りがマイナスのとき、用意する必要のある現金。 */
    shortfall: net < 0 ? -net : 0,
    /** 売却価格に対して、手元に残る割合。 */
    keepRatio: price > 0 ? net / price : 0,
  };
}

/* ------------------------------------------------------------
   8. 分かれ目の価格
   ------------------------------------------------------------ */

/**
 * 手取りがちょうど0になる売却価格を二分法で求める。
 * 仲介手数料も印紙税も税額も価格で動くので、割り算では出ない。
 * この価格を下回ると、差額を現金で用意しないと引き渡せない。
 */
export function breakEvenPrice(input, { max = null, iterations = 60 } = {}) {
  const at = (p) => simulate({ ...input, priceYen: p }).net;
  if (at(0) >= 0) return 0;
  let hi = max || Math.max((input.priceYen || 0) * 3, (input.loanBalanceYen || 0) * 3, 100_000_000);
  let guard = 0;
  while (at(hi) < 0 && guard++ < 12) hi *= 2;
  if (at(hi) < 0) return null;
  let lo = 0;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** 税金がかかりはじめる売却価格。かからないなら null。 */
export function taxStartPrice(input, { iterations = 60 } = {}) {
  const at = (p) => simulate({ ...input, priceYen: p }).tax.total;
  let hi = Math.max((input.priceYen || 0) * 3, 100_000_000);
  let guard = 0;
  while (at(hi) <= 0 && guard++ < 12) hi *= 2;
  if (at(hi) <= 0) return null;
  if (at(0) > 0) return 0;
  let lo = 0;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * 売却価格を振ったときの手取り一覧。
 * 「いくらで売れたらいくら残るか」を一枚で見るための表。
 */
export function priceMatrix(input, prices) {
  return prices.map((p) => {
    const r = simulate({ ...input, priceYen: p });
    return {
      price: p,
      net: r.net,
      tax: r.tax.total,
      costs: r.costs.total,
      isCurrent: p === input.priceYen,
    };
  });
}

/* ------------------------------------------------------------
   9. 売却価格の当たりのつけかた

   成約価格は最後まで分からない。ここで出すのは1点の答えではなく、
   「どのあたりを中心に置いて考えるか」の目安。
   どの方法も根拠が違うので、2つ以上でやって近ければ確からしい。
   ------------------------------------------------------------ */

export const SQM_PER_TSUBO = 3.305785;

export const tsuboToSqm = (tsubo) => tsubo * SQM_PER_TSUBO;
export const sqmToTsubo = (sqm) => sqm / SQM_PER_TSUBO;

/** 近隣の成約事例の㎡単価から。いちばん実勢に近い。 */
export function priceFromUnit(areaSqm, unitPriceYenPerSqm) {
  return Math.max(0, areaSqm) * Math.max(0, unitPriceYenPerSqm);
}

/**
 * 固定資産税評価額から逆算する。評価額は時価のおおむね70%を目安に決められている。
 * 手元の納税通知書だけで出せるので、事例が見つからないときの当たりに使う。
 */
export function priceFromAssessed(assessedYen, ratio = 0.7) {
  return ratio > 0 ? Math.max(0, assessedYen) / ratio : 0;
}

/**
 * 相続税路線価から逆算する。路線価は時価のおおむね80%を目安に決められている。
 * こちらは土地の値。建物の価値は別に足す必要がある。
 */
export function priceFromRosenka(rosenkaYen, ratio = 0.8) {
  return ratio > 0 ? Math.max(0, rosenkaYen) / ratio : 0;
}

/**
 * 売り出してから決まるまでの幅。1点で置くと、その額で売れる前提の話になる。
 * 早く決めたいとき、時間をかけられるとき、それぞれの手取りを並べて見る。
 */
export function priceRange(centerYen, { upPercent = 8, downPercent = 12 } = {}) {
  const c = Math.max(0, centerYen);
  return {
    low: c * (1 - downPercent / 100),
    mid: c,
    high: c * (1 + upPercent / 100),
  };
}

/* ------------------------------------------------------------
   10. 表示
   ------------------------------------------------------------ */

export function yen(n) {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "−" : "";
  return `${sign}¥${Math.abs(rounded).toLocaleString("ja-JP")}`;
}

/** 大きな金額は万円で読む。1億以上は「億」を足す。 */
export function man(n, { decimals = 0 } = {}) {
  const v = n / 10_000;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 10_000) {
    const oku = Math.floor(abs / 10_000);
    const rest = Math.round(abs % 10_000);
    return `${sign}${oku}億${rest > 0 ? `${rest.toLocaleString("ja-JP")}万` : ""}円`;
  }
  const fixed = abs.toFixed(decimals);
  return `${sign}${Number(fixed).toLocaleString("ja-JP")}万円`;
}

/** 表の中など、幅が足りないところ用。「円」を落とす。 */
export function manShort(n) {
  return man(n).replace(/円$/, "");
}

export function percent(ratio, decimals = 1) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(decimals)}%`;
}
