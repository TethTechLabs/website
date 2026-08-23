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

function niceMax(v, ticks) {
  return niceCeil(v / ticks) * ticks;
}

/**
 * 0をまたぐ軸の範囲。刻みを先に丸めてから下端を合わせる。
 * 上下を別々に丸めると (200万 − −1,500万) / 4 = 425万 のような刻みになり、
 * 目盛のラベルが読めなくなる。
 */
function niceScale(lo, hi, ticks) {
  const step = niceCeil(Math.max(1, (hi - lo) / ticks));
  const min = Math.floor(lo / step) * step;
  return { min, max: min + step * ticks, step };
}

function manLabel(v) {
  const m = v / 10_000;
  const sign = m < 0 ? "−" : "";
  const a = Math.abs(m);
  if (a >= 10_000) return `${sign}${(a / 10_000).toFixed(a % 10_000 === 0 ? 0 : 1)}億`;
  if (a >= 1) return `${sign}${Math.round(a).toLocaleString("ja-JP")}万`;
  return "0";
}

/* ------------------------------------------------------------
   1. 手取りまでの落ち方。売却価格から何がいくら引かれて、
      いくら残るかを、段差そのもので見せる。
      円グラフにすると「残債」と「手取り」が同じ性質に見えてしまう。
      引かれる順に落としていけば、どこで削られたかが位置で分かる。
   ------------------------------------------------------------ */
export function waterfallChart(steps, { height = 300 } = {}) {
  if (!steps.length) return "";
  const h = height;
  const plotW = W - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b - 18;
  const unit = plotW / steps.length;
  const barW = Math.min(78, unit * 0.62);

  // 目盛の上限は、開始額と途中の高さの大きいほう。マイナスまで落ちる場合は下も取る。
  let running = 0;
  const laid = steps.map((s) => {
    const start = s.type === "total" ? 0 : running;
    const end = s.type === "total" ? s.value : running + s.value;
    if (s.type !== "total") running = end;
    else running = s.value;
    return { ...s, start, end };
  });
  const highs = laid.flatMap((s) => [s.start, s.end]);
  const scale = niceScale(Math.min(0, ...highs) * 1.15, Math.max(...highs, 1) * 1.06, 4);
  const floor = scale.min;
  const span = scale.max - floor;
  const yAt = (v) => PAD.t + plotH - ((v - floor) / span) * plotH;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = floor + scale.step * i;
    const y = yAt(v);
    grid += `<line class="grid" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ax-y" x="${PAD.l - 8}" y="${(y + 4).toFixed(1)}">${manLabel(v)}</text>`;
  }
  if (floor < 0) {
    const y = yAt(0);
    grid += `<line class="zero-line" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
  }

  let bars = "";
  let links = "";
  laid.forEach((s, i) => {
    const cx = PAD.l + unit * i + unit / 2;
    const x = cx - barW / 2;
    const top = Math.min(yAt(s.start), yAt(s.end));
    const bottom = Math.max(yAt(s.start), yAt(s.end));
    const cls = s.type === "total" ? (s.end < 0 ? "wf-bar is-short" : "wf-bar is-total") : s.type === "start" ? "wf-bar is-start" : "wf-bar is-minus";
    bars += `<g class="wf" style="--n:${i}">
      <rect class="${cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, bottom - top).toFixed(1)}" rx="2"/>
      <text class="wf-value" x="${cx.toFixed(1)}" y="${(top - 7).toFixed(1)}">${s.type === "start" || s.type === "total" ? manLabel(s.end) : `−${manLabel(Math.abs(s.value))}`}</text>
      <text class="wf-label" x="${cx.toFixed(1)}" y="${(h - 8).toFixed(1)}">${s.label}</text>
    </g>`;
    // 落ちた先を次の棒の頭につなぐ点線。段差が続いていることを示す。
    if (i < laid.length - 1 && s.type !== "total") {
      const y = yAt(s.end).toFixed(1);
      links += `<line class="wf-link" x1="${(cx + barW / 2).toFixed(1)}" y1="${y}" x2="${(PAD.l + unit * (i + 1) + unit / 2 - barW / 2).toFixed(1)}" y2="${y}"/>`;
    }
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img"
      aria-label="売却価格から諸費用・ローン残債・税金を順に引いて、手取りが残るまでの内訳。">
      ${grid}${links}${bars}
    </svg>`;
}

/* ------------------------------------------------------------
   2. 売れた価格ごとの手取り。
      いくらで売れるかは相手次第なので、1点の答えより
      「この帯のどこに落ちるか」で見たほうが実態に合う。
      手取り0の線と、いま置いている価格を重ねて描く。
   ------------------------------------------------------------ */
export function proceedsChart(rows, { height = 280, current = null, breakEven = null } = {}) {
  if (rows.length < 2) return "";
  const h = height;
  const plotW = W - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;

  const xs = rows.map((r) => r.price);
  const ys = rows.map((r) => r.net);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const scale = niceScale(Math.min(0, ...ys) * 1.12, Math.max(...ys, 1) * 1.08, 4);
  const yFloor = scale.min;
  const span = scale.max - yFloor;

  const xAt = (v) => PAD.l + ((v - xMin) / Math.max(1, xMax - xMin)) * plotW;
  const yAt = (v) => PAD.t + plotH - ((v - yFloor) / span) * plotH;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = yFloor + scale.step * i;
    const y = yAt(v);
    grid += `<line class="grid" x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ax-y" x="${PAD.l - 8}" y="${(y + 4).toFixed(1)}">${manLabel(v)}</text>`;
  }

  const pts = rows.map((r) => `${xAt(r.price).toFixed(1)},${yAt(r.net).toFixed(1)}`);

  // 手取りがマイナスの区間だけを別に塗る。持ち出しになる帯を目で拾えるようにする。
  let shortArea = "";
  if (yFloor < 0) {
    const zeroY = yAt(0).toFixed(1);
    const neg = rows.filter((r) => r.net <= 0);
    if (neg.length) {
      const negPts = neg.map((r) => `${xAt(r.price).toFixed(1)},${yAt(r.net).toFixed(1)}`);
      const crossing =
        breakEven != null && breakEven >= xMin && breakEven <= xMax
          ? breakEven
          : neg[neg.length - 1].price;
      const endX = xAt(crossing).toFixed(1);
      shortArea = `<path class="short-area" d="M${xAt(xMin).toFixed(1)},${zeroY} L${negPts.join(" L")} L${endX},${zeroY} Z"/>`;
    }
    grid += `<line class="zero-line" x1="${PAD.l}" y1="${zeroY}" x2="${W - PAD.r}" y2="${zeroY}"/>`;
  }

  let marks = "";
  if (breakEven != null && breakEven >= xMin && breakEven <= xMax) {
    const x = xAt(breakEven);
    const late = x > W * 0.62;
    marks += `<line class="branch" x1="${x.toFixed(1)}" y1="${PAD.t}" x2="${x.toFixed(1)}" y2="${(h - PAD.b).toFixed(1)}"/>
      <text class="mark-year" x="${x.toFixed(1)}" y="${PAD.t + 11}" dx="${late ? -5 : 5}" text-anchor="${late ? "end" : "start"}">${manLabel(breakEven)}円で手取り0</text>`;
  }
  if (current != null && current >= xMin && current <= xMax) {
    const row = rows.reduce((a, b) => (Math.abs(b.price - current) < Math.abs(a.price - current) ? b : a));
    marks += `<line class="marker" x1="${xAt(current).toFixed(1)}" y1="${PAD.t}" x2="${xAt(current).toFixed(1)}" y2="${(h - PAD.b).toFixed(1)}"/>
      <circle class="marker-dot" cx="${xAt(current).toFixed(1)}" cy="${yAt(row.net).toFixed(1)}" r="4.5"/>`;
  }

  const stride = Math.max(1, Math.ceil(rows.length / 6));
  let xLabels = "";
  for (let i = 0; i < rows.length; i += stride) {
    xLabels += `<text class="ax-x" x="${xAt(rows[i].price).toFixed(1)}" y="${h - 8}">${manLabel(rows[i].price)}</text>`;
  }

  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img"
      aria-label="横軸が売却できた価格、縦軸がそのときの手取り。手取りが0を下回る帯は色を変えてある。">
      ${grid}${shortArea}${marks}
      <polyline class="line-net" pathLength="100" points="${pts.join(" ")}"/>
      ${xLabels}
      <rect class="hit" x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${plotH}"/>
      <line class="scrub-line" x1="0" y1="${PAD.t}" x2="0" y2="${(h - PAD.b).toFixed(1)}" style="opacity:0"/>
    </svg>`;
}

/** スクラブ用。SVG 内の x 座標から行インデックスを引く。 */
export function indexFromPointer(svg, clientX, count) {
  const rect = svg.getBoundingClientRect();
  const scale = W / rect.width;
  const x = (clientX - rect.left) * scale;
  const plotW = W - PAD.l - PAD.r;
  const frac = (x - PAD.l) / plotW;
  return Math.max(0, Math.min(count - 1, Math.round(frac * (count - 1))));
}

export function xForIndex(i, count) {
  return PAD.l + (count <= 1 ? 0 : (i / (count - 1)) * (W - PAD.l - PAD.r));
}
