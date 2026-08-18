/* ============================================================
   返済計算のコア。UIから切り離し、テストできる純関数だけを置く。
   金額は円、金利は年利パーセント、期間は月数で扱う。
   ============================================================ */

/** 年利（%）と月数から、元利均等の毎月返済額を返す。 */
export function monthlyPayment(principalYen, annualRatePercent, months) {
  if (!(principalYen > 0) || !(months > 0)) return 0;
  const r = annualRatePercent / 100 / 12;
  if (Math.abs(r) < 1e-12) return principalYen / months;
  const factor = (1 + r) ** months;
  return (principalYen * r * factor) / (factor - 1);
}

/** ボーナス併用部分の1回あたり返済額。年2回・半年複利で解く。 */
export function bonusPayment(principalYen, annualRatePercent, years) {
  if (!(principalYen > 0) || !(years > 0)) return 0;
  const r = annualRatePercent / 100 / 2;
  const periods = Math.round(years * 2);
  if (periods <= 0) return 0;
  if (Math.abs(r) < 1e-12) return principalYen / periods;
  const factor = (1 + r) ** periods;
  return (principalYen * r * factor) / (factor - 1);
}

export function monthlySurplus(takeHomeYen, housingMonthlyYen, livingYen) {
  return takeHomeYen - housingMonthlyYen - livingYen;
}

/* ============================================================
   金利の道すじ。月インデックスを受けて、その月の年利（%）を返す。
   ============================================================ */

/** ずっと同じ金利。 */
export function flatRate(percent) {
  return () => percent;
}

/**
 * 変更ポイントを複数置いた金利の道すじ。
 * points = [{ year, delta }]。delta は「当初金利からの加算」ではなく
 * 「その時点でさらに動く幅」で、時間順に積み上がる。
 * 3年後 +0.5、5年後 +0.7 なら、5年後以降は base + 1.2 になる。
 * scale はシナリオの強弱（0.5倍、2倍など）をまとめてかけるため。
 */
export function stepPath(basePercent, points, scale = 1) {
  const sorted = [...points]
    .filter((p) => p && p.year > 0)
    .sort((a, b) => a.year - b.year)
    .map((p) => ({ month: Math.round(p.year * 12), delta: p.delta * scale }));
  return (m) => {
    let r = basePercent;
    for (const p of sorted) {
      if (m >= p.month) r += p.delta;
    }
    return Math.max(0, r);
  };
}

/** 表示用。各変更ポイントで金利がいくらになるかを順に返す。 */
export function ratePathSteps(basePercent, points, scale = 1) {
  const sorted = [...points].filter((p) => p && p.year > 0).sort((a, b) => a.year - b.year);
  let r = basePercent;
  return sorted.map((p) => {
    const delta = p.delta * scale;
    r = Math.max(0, r + delta);
    return { year: p.year, delta, rate: Math.round(r * 1000) / 1000 };
  });
}

/**
 * 償却表から、毎月返済額が変わった時点だけを抜き出す。最終回の精算は除く。
 * 見直しでは端数だけの改定も起きるので、minDelta 未満の動きは段として扱わない。
 */
export function paymentSteps(rows, minDelta = 100) {
  const out = [];
  let prev = null;
  for (let i = 0; i < rows.length - 1; i++) {
    const pay = rows[i].monthlyPay;
    if (prev == null || Math.abs(pay - prev) >= minDelta) {
      out.push({ month: rows[i].month, pay });
      prev = pay;
    }
  }
  return out;
}

/* ============================================================
   償却。ここに 5年ルール・125%ルール・未払利息・ボーナス併用が入る。
   ============================================================ */

/**
 * 月次の償却表を返す。
 * ratePath(m) がその月の年利（%）を返す。
 * fiveYearRule: 返済額の見直しを reviewMonths ごとに限る（多くの民間変動）。
 * cap125: 見直し時の増額を前回の1.25倍までに抑える。
 * 返済しきれなかった元金と未払利息は residual として最後に残る。
 */
export function amortize({
  principalYen,
  months,
  ratePath,
  bonusPrincipalYen = 0,
  method = "equal-payment",
  fiveYearRule = false,
  cap125 = false,
  reviewMonths = 60,
  rounding = "yen",
}) {
  const total = Math.max(0, principalYen);
  const bonusStart = Math.max(0, Math.min(total, bonusPrincipalYen));
  const monthlyStart = total - bonusStart;
  const n = Math.max(1, Math.round(months));
  const years = n / 12;

  // 銀行の規約に合わせる。返済額は円未満切り上げで固定し、利息は円未満切り捨て、
  // 端数は最終回で精算する。rounding:"exact" で理論値のまま計算する。
  const yenMode = rounding === "yen";
  const roundPay = (v) => (yenMode ? Math.ceil(v - 1e-9) : v);
  const roundInterest = (v) => (yenMode ? Math.floor(v + 1e-9) : v);

  let mBal = monthlyStart;
  let bBal = bonusStart;
  let unpaid = 0;

  let pay = roundPay(monthlyPayment(monthlyStart, ratePath(0), n));
  let bPay = roundPay(bonusPayment(bonusStart, ratePath(0), years));
  const startBonusPay = bPay;
  const flatPrincipal = yenMode ? Math.ceil(monthlyStart / n) : monthlyStart / n;

  const rows = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let peakPayment = 0;
  let peakMonthlyPay = 0;
  let peakBonusPay = 0;
  let maxUnpaid = 0;
  let firstRevisionMonth = null;
  let cappedAt = null;

  for (let m = 0; m < n; m++) {
    const rate = ratePath(m);
    const rMonth = rate / 100 / 12;
    const remaining = n - m;

    /* --- 返済額の見直し --- */
    if (m > 0 && method === "equal-payment") {
      const rateChanged = rate !== ratePath(m - 1);
      const atReview = m % reviewMonths === 0;
      if (fiveYearRule ? atReview : rateChanged) {
        let next = monthlyPayment(mBal + unpaid, rate, remaining);
        if (cap125 && next > pay * 1.25) {
          next = pay * 1.25;
          if (cappedAt == null) cappedAt = m;
        }
        next = roundPay(next);
        if (Math.abs(next - pay) > 1) {
          pay = next;
          if (firstRevisionMonth == null) firstRevisionMonth = m;
        }
      }
      if (bBal > 0 && (fiveYearRule ? m % reviewMonths === 0 : rateChanged)) {
        bPay = roundPay(bonusPayment(bBal, rate, remaining / 12));
      }
    }

    /* --- 毎月部分 --- */
    const interest = roundInterest(mBal * rMonth);
    const due = interest + unpaid;
    let payment;
    if (method === "equal-principal") {
      payment = Math.min(flatPrincipal, mBal) + due;
    } else {
      payment = pay;
    }
    if (payment > mBal + due) payment = mBal + due;
    if (payment < 0) payment = 0;
    const toInterest = Math.min(payment, due);
    const toPrincipal = payment - toInterest;
    unpaid = due - toInterest;
    mBal = Math.max(0, mBal - toPrincipal);

    /* --- ボーナス部分（6ヶ月ごと・半年複利） --- */
    let bInterest = 0;
    let bPayment = 0;
    let bToPrincipal = 0;
    if (bBal > 0 && (m + 1) % 6 === 0) {
      bInterest = roundInterest(bBal * (rate / 100 / 2));
      bPayment = Math.min(bPay, bBal + bInterest);
      bToPrincipal = bPayment - bInterest;
      bBal = Math.max(0, bBal - bToPrincipal);
    }

    const rowInterest = interest + bInterest;
    const rowPrincipal = toPrincipal + bToPrincipal;
    const rowPayment = payment + bPayment;

    totalInterest += rowInterest;
    totalPaid += rowPayment;
    peakPayment = Math.max(peakPayment, rowPayment);
    peakMonthlyPay = Math.max(peakMonthlyPay, payment);
    if (bPayment > 0) peakBonusPay = Math.max(peakBonusPay, bPayment);
    maxUnpaid = Math.max(maxUnpaid, unpaid);

    rows.push({
      month: m + 1,
      rate,
      payment: rowPayment,
      monthlyPay: payment,
      bonusPay: bPayment,
      interest: rowInterest,
      principal: rowPrincipal,
      balance: mBal + bBal,
      unpaidInterest: unpaid,
    });
  }

  const residual = mBal + bBal + unpaid;
  const lastRow = rows[rows.length - 1];

  return {
    rows,
    startPayment: rows[0] ? rows[0].monthlyPay : 0,
    startBonusPayment: bonusStart > 0 ? startBonusPay : 0,
    finalPayment: lastRow ? lastRow.payment : 0,
    peakPayment,
    peakMonthlyPay,
    peakBonusPay,
    totalPaid,
    totalInterest,
    maxUnpaid,
    residual,
    firstRevisionMonth,
    cappedAt,
  };
}

/** 償却表を年単位にまとめる。グラフ用。 */
export function toYearly(rows) {
  const out = [];
  for (const row of rows) {
    const y = Math.floor((row.month - 1) / 12);
    if (!out[y]) {
      out[y] = {
        year: y + 1,
        interest: 0,
        principal: 0,
        payment: 0,
        monthlyPay: 0,
        bonusPay: 0,
        balance: 0,
        rate: row.rate,
      };
    }
    out[y].interest += row.interest;
    out[y].principal += row.principal;
    out[y].payment += row.payment;
    // 約定額は合計ではなく、その年に適用されている額。
    out[y].monthlyPay = Math.max(out[y].monthlyPay, row.monthlyPay);
    out[y].bonusPay = Math.max(out[y].bonusPay, row.bonusPay);
    out[y].balance = row.balance;
    out[y].rate = row.rate;
  }
  return out;
}

/* ============================================================
   表示
   ============================================================ */

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

export function percent(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}
