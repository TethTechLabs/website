/* ============================================================
   SVG のグラフ。色は CSS 変数で受けるので、テーマ切替に追従する。
   すべて viewBox で描き、幅は CSS 側で伸縮させる。
   ============================================================ */

const W = 720;
const PAD = { l: 70, r: 14, t: 14, b: 26 };

function niceCeil(v) {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) {
    if (v <= base * step) return base * step;
  }
  return base * 10;
}

/** 目盛の刻みが丸い数になるように上限を決める。 */
function niceMax(v, ticks) {
  return niceCeil(v / ticks) * ticks;
}

/** 目盛の刻みが細かいときは小数を出す。同じラベルが並ぶのを避ける。 */
function manLabelStep(v, step) {
  const m = v / 10_000;
  const d = step >= 10_000 ? 0 : step >= 1_000 ? 1 : 2;
  return `${m.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d })}万`;
}

function manLabel(v) {
  const m = v / 10_000;
  if (m >= 10_000) return `${(m / 10_000).toFixed(m % 10_000 === 0 ? 0 : 1)}億`;
  if (m >= 1000) return `${Math.round(m).toLocaleString("ja-JP")}万`;
  if (m >= 1) return `${Math.round(m)}万`;
  return "0";
}

/**
 * 目盛。index i が「i + offset 年目」を指す。
 * offset 1 は年次集計（1年目から）、offset 0 は残高（契約時から）。
 */
function axis(h, maxY, count, { ticks = 4, offset = 1 } = {}) {
  const plotW = W - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  let g = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (maxY / ticks) * i;
    const y = PAD.t + plotH - (v / maxY) * plotH;
    g += `<line class="grid" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
    g += `<text class="ax-y" x="${PAD.l - 8}" y="${(y + 4).toFixed(1)}">${manLabel(v)}</text>`;
  }
  const last = count - 1 + offset;
  const span = last - offset;
  const stride = span > 24 ? 10 : span > 12 ? 5 : span > 4 ? 2 : 1;
  const marks = [];
  for (let yr = offset; yr <= last; yr += stride) marks.push(yr);
  if (marks[marks.length - 1] !== last) marks.push(last);
  for (const yr of marks) {
    const x = PAD.l + ((yr - offset) / Math.max(1, count - 1)) * plotW;
    g += `<text class="ax-x" x="${x.toFixed(1)}" y="${h - 8}">${yr}年</text>`;
  }
  return g;
}

function xAt(i, count, plotW) {
  return PAD.l + (count <= 1 ? 0 : (i / (count - 1)) * plotW);
}

/* ------------------------------------------------------------
   1. 償却の全体像。x軸を共有した2段。
      上段: 残高が元金から0まで減っていく。
      下段: その年に払い込んだ元金と利息の積み上げ棒。
      2軸1枚にすると、線と棒の交点に意味がないのに意味があるように
      見えてしまう。段を分ければ同じ情報を嘘なしで出せる。
   ------------------------------------------------------------ */
export function amortizationChart(yearly, principalYen, { height = 340 } = {}) {
  const years = yearly.length;
  if (!years) return "";

  const gap = 28;
  const h = height;
  const plotW = W - PAD.l - PAD.r;
  const bodyH = h - PAD.t - PAD.b - gap;
  const h1 = Math.round(bodyH * 0.55);
  const h2 = bodyH - h1;
  const top1 = PAD.t;
  const top2 = PAD.t + h1 + gap;

  const unit = plotW / years;
  const xAtYear = (k) => PAD.l + k * unit; // k = 0(契約時) .. years
  const barW = Math.min(22, Math.max(3, unit * 0.66));

  /* --- 上段: 残高 --- */
  const balance = [principalYen, ...yearly.map((y) => y.balance)];
  const maxBal = niceMax(principalYen * 1.04, 4);
  const y1 = (v) => top1 + h1 - (v / maxBal) * h1;
  const balPts = balance.map((v, i) => `${xAtYear(i).toFixed(1)},${y1(v).toFixed(1)}`);
  const balArea = `M${balPts.join(" L")} L${xAtYear(years).toFixed(1)},${y1(0).toFixed(1)} L${PAD.l},${y1(0).toFixed(1)} Z`;

  // 残高が半分になる年。返済の折り返しは期間の真ん中より後ろに来る。
  let halfYear = null;
  for (let i = 1; i <= years; i++) {
    if (balance[i] <= principalYen / 2) {
      halfYear = i;
      break;
    }
  }
  let halfMark = "";
  if (halfYear != null && halfYear < years) {
    const x = xAtYear(halfYear).toFixed(1);
    const late = halfYear > years * 0.6;
    halfMark = `
      <line class="marker" x1="${x}" y1="${top1}" x2="${x}" y2="${y1(0).toFixed(1)}"/>
      <circle class="marker-dot" cx="${x}" cy="${y1(balance[halfYear]).toFixed(1)}" r="3.5"/>
      <text class="marker-text" x="${x}" y="${top1 + 11}" text-anchor="${late ? "end" : "start"}" dx="${late ? -6 : 6}">${halfYear}年目に残高が半分</text>`;
  }

  /* --- 下段: 年ごとの元金と利息 --- */
  const maxYear = niceMax(Math.max(...yearly.map((y) => y.payment)) * 1.06, 3);
  const y2 = (v) => top2 + h2 - (v / maxYear) * h2;
  const bars = yearly
    .map((y, i) => {
      const cx = xAtYear(i) + unit / 2;
      const x = (cx - barW / 2).toFixed(1);
      const pTop = y2(y.principal);
      const iTop = y2(y.payment);
      const base = y2(0);
      return `<g class="bar" style="--n:${i}">
        <rect class="bar-interest" x="${x}" y="${iTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, pTop - iTop).toFixed(1)}"/>
        <rect class="bar-principal" x="${x}" y="${pTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, base - pTop).toFixed(1)}"/>
      </g>`;
    })
    .join("");

  /* --- 目盛 --- */
  const grid = (top, ph, maxY, ticks) => {
    let g = "";
    for (let i = 0; i <= ticks; i++) {
      const v = (maxY / ticks) * i;
      const y = top + ph - (v / maxY) * ph;
      g += `<line class="grid" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
      g += `<text class="ax-y" x="${PAD.l - 8}" y="${(y + 4).toFixed(1)}">${manLabel(v)}</text>`;
    }
    return g;
  };

  const stride = years > 24 ? 10 : years > 12 ? 5 : years > 4 ? 2 : 1;
  let xLabels = "";
  for (let k = 0; k <= years; k += stride) {
    xLabels += `<text class="ax-x" x="${xAtYear(k).toFixed(1)}" y="${h - 8}">${k}年</text>`;
  }
  if ((years % stride) !== 0) {
    xLabels += `<text class="ax-x" x="${xAtYear(years).toFixed(1)}" y="${h - 8}">${years}年</text>`;
  }

  return `
    <svg class="chart" viewBox="0 0 ${W} ${h}" role="img"
         aria-label="上段は残高が元金から0まで減っていく推移。下段は年ごとに払い込んだ元金と利息の積み上げ。">
      ${grid(top1, h1, maxBal, 4)}
      ${grid(top2, h2, maxYear, 3)}
      <text class="panel-tag" x="${PAD.l}" y="${top1 - 3}">残高</text>
      <text class="panel-tag" x="${PAD.l}" y="${top2 - 3}">その年に払い込んだ額</text>
      <path class="area-balance" d="${balArea}"/>
      <polyline class="line-balance" pathLength="100" points="${balPts.join(" ")}"/>
      ${halfMark}
      ${bars}
      ${xLabels}
      <rect class="hit" x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${h - PAD.t - PAD.b}"/>
      <line class="scrub-line" x1="0" y1="${PAD.t}" x2="0" y2="${(h - PAD.b).toFixed(1)}" style="opacity:0"/>
    </svg>`;
}

/** 年インデックス i の棒の中心。スクラブ線を合わせるのに使う。 */
export function xForBar(i, years) {
  const unit = (W - PAD.l - PAD.r) / years;
  return PAD.l + i * unit + unit / 2;
}

/* ------------------------------------------------------------
   2. 月々返済額の推移。基準と想定の2本、その差を帯で塗る。
      変更ポイントごとに縦線を立て、そこで金利が何%になるかを書く。
   ------------------------------------------------------------ */
export function paymentStepChart(
  base,
  scenario,
  { height = 300, marks = [], ceiling = null, focusYears = 0, totalYears = 0, stepLabels = [] } = {}
) {
  const h = height;
  const plotW = W - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  const full = base.length;
  if (!full) return "";
  // 段が出そろったあとの横ばい区間は描かない。動くところを大きく見せる。
  const count = focusYears > 0 ? Math.min(full, focusYears) : full;
  base = base.slice(0, count);
  scenario = scenario.slice(0, count);
  const cut = (totalYears || full) > count;

  const topPay = Math.max(...base, ...scenario);
  const lowPay = Math.min(...base, ...scenario);
  const ceilingFits = ceiling != null && ceiling > 0 && ceiling <= topPay * 1.7;
  const wanted = ceilingFits ? Math.max(topPay, ceiling) : topPay;
  const maxY = niceMax(wanted * 1.14, 4);

  // 0起点だと段が縦の1割ほどしか動かず、変化が読めない。
  // 下が大きく空くときだけ土台を切り上げ、軸に破断の印を必ず出す。
  const floorRaw = ceilingFits ? Math.min(lowPay, ceiling) : lowPay;
  const broken = floorRaw > maxY * 0.35;
  const minY = broken ? Math.floor((floorRaw * 0.94) / 10_000) * 10_000 : 0;

  const span = maxY - minY;
  const yAt = (v) => PAD.t + plotH - ((v - minY) / span) * plotH;
  const xAtYear = (k) => PAD.l + (k / count) * plotW;

  // 1年目の値をその年いっぱい保つ階段。年の途中で変わっても年単位で見せる。
  const stepPairs = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      out.push([xAtYear(i), yAt(arr[i])]);
      out.push([xAtYear(i + 1), yAt(arr[i])]);
    }
    return out;
  };
  const toPts = (pairs) => pairs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const basePairs = stepPairs(base);
  const scenPairs = stepPairs(scenario);
  const band = `M${toPts(scenPairs).split(" ").join(" L")} L${toPts([...basePairs].reverse()).split(" ").join(" L")} Z`;

  // 変更ポイントが近いとラベルが重なるので、一段ずつ高さをずらす。
  let markup = "";
  marks.forEach((mk, i) => {
    const x = xAtYear(mk.year);
    if (x > W - PAD.r - 2) return;
    const ty = PAD.t + 11 + (i % 2) * 28;
    markup += `
      <line class="branch" x1="${x.toFixed(1)}" y1="${PAD.t}" x2="${x.toFixed(1)}" y2="${yAt(minY).toFixed(1)}"/>
      <text class="mark-year" x="${x.toFixed(1)}" y="${ty}" dx="5">${mk.year}年</text>
      <text class="mark-rate" x="${x.toFixed(1)}" y="${ty + 13}" dx="5">${mk.label}</text>`;
  });

  // 段が上がったところに、そのときの月々を直接書く。
  let stepText = "";
  for (const st of stepLabels) {
    const x = xAtYear(st.year);
    if (x > W - PAD.r - 40) continue;
    stepText += `<text class="step-value" x="${(x + 5).toFixed(1)}" y="${(yAt(st.pay) - 7).toFixed(1)}">${st.text}</text>`;
  }

  let ceilingMark = "";
  if (ceilingFits) {
    const y = yAt(ceiling).toFixed(1);
    ceilingMark = `
      <line class="ceiling" x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}"/>
      <text class="ceiling-text" x="${W - PAD.r}" y="${(Number(y) - 6).toFixed(1)}" text-anchor="end">上限 ${manLabel(ceiling)}</text>`;
  } else if (ceiling != null && ceiling > 0) {
    ceilingMark = `<text class="ceiling-text" x="${W - PAD.r}" y="${PAD.t + 11}" text-anchor="end">↑上限 ${manLabel(ceiling)}</text>`;
  }

  const stride = count > 24 ? 10 : count > 12 ? 5 : count > 4 ? 2 : 1;
  let xLabels = "";
  for (let k = 0; k <= count; k += stride) {
    if (k === 0) continue;
    // 打ち切りの注記を置く右端は、年ラベルと重なるので空けておく。
    if (cut && k > count - stride) continue;
    xLabels += `<text class="ax-x" x="${xAtYear(k).toFixed(1)}" y="${h - 8}">${k}年</text>`;
  }
  if (cut) {
    const x = W - PAD.r;
    xLabels += `<path class="axis-break" d="M${(x - 6).toFixed(1)},${PAD.t} l-5,7 l5,7 l-5,7"/>
      <text class="ax-x" x="${x}" y="${h - 8}" text-anchor="end">以降${totalYears}年まで横ばい</text>`;
  }

  let grid = "";
  const tick = span / 4;
  for (let i = 0; i <= 4; i++) {
    const v = minY + tick * i;
    const y = yAt(v);
    grid += `<line class="grid" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ax-y" x="${PAD.l - 8}" y="${(y + 4).toFixed(1)}">${manLabelStep(v, tick)}</text>`;
  }
  if (broken) {
    const y = yAt(minY);
    grid += `<path class="axis-break" d="M${PAD.l - 14},${(y + 5).toFixed(1)} l6,-4 l6,4 l6,-4"/>
      <text class="axis-break-text" x="${PAD.l}" y="${(y + 16).toFixed(1)}">0起点でない</text>`;
  }

  return `
    <svg class="chart" viewBox="0 0 ${W} ${h}" role="img"
         aria-label="毎月の返済額の推移。細い青が金利横ばい、太い赤が置いた想定。差を帯で塗ってある。">
      ${grid}
      ${ceilingMark}
      <path class="diff-band" d="${band}"/>
      ${markup}
      <polyline class="fan is-base" pathLength="100" points="${toPts(basePairs)}"/>
      <polyline class="fan is-picked" pathLength="100" points="${toPts(scenPairs)}"/>
      ${stepText}
      ${xLabels}
      <rect class="hit" x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${plotH}"/>
      <line class="scrub-line" x1="0" y1="${PAD.t}" x2="0" y2="${yAt(minY).toFixed(1)}" style="opacity:0"/>
    </svg>`;
}

/** スクラブ用。SVG 内の x 座標から年インデックスを引く。 */
export function indexFromPointer(svg, clientX, count) {
  const rect = svg.getBoundingClientRect();
  const scale = W / rect.width;
  const x = (clientX - rect.left) * scale;
  const plotW = W - PAD.l - PAD.r;
  const frac = (x - PAD.l) / plotW;
  return Math.max(0, Math.min(count - 1, Math.round(frac * (count - 1))));
}

export function xForIndex(i, count) {
  return xAt(i, count, W - PAD.l - PAD.r);
}
