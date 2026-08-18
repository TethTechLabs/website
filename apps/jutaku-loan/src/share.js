/* ============================================================
   共有用の画像とテキストを作る。
   DOM のスクリーンショットは撮らない。必要な数字だけを Canvas に
   描き直すので、余計なUIやその日のスクロール位置が写り込まない。
   ============================================================ */

const W = 1080;
const H = 1350;

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = "";
  let cy = y;
  for (const ch of [...text]) {
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxWidth) {
      ctx.fillText(line, x, cy);
      line = ch;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
  return cy + lineHeight;
}

/**
 * data: { dateLabel, monthly, bonus, total, rows:[[label,value]], disclaimer }
 * colors: 呼び出し側でいまのテーマ・配色から作った色一式。
 */
export function buildShareCanvas(data, colors) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const sans = "system-ui, -apple-system, 'Hiragino Sans', sans-serif";

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = colors.accent;
  ctx.font = `700 30px ${sans}`;
  ctx.fillText("試算値", 64, 92);

  ctx.fillStyle = colors.muted;
  ctx.font = `500 26px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText(`${data.dateLabel} 時点`, W - 64, 92);
  ctx.textAlign = "left";

  ctx.fillStyle = colors.muted;
  ctx.font = `600 30px ${sans}`;
  ctx.fillText("毎月の返済", 64, 190);

  ctx.fillStyle = colors.ink;
  ctx.font = `700 104px ${sans}`;
  ctx.fillText(data.monthly, 60, 300);

  let y = 300;
  if (data.bonus) {
    ctx.fillStyle = colors.warm;
    ctx.font = `700 32px ${sans}`;
    y += 46;
    ctx.fillText(`ボーナス月 ＋${data.bonus}（年2回）`, 64, y);
  }

  y += 50;
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, y);
  ctx.lineTo(W - 64, y);
  ctx.stroke();

  y += 60;
  ctx.font = `500 30px ${sans}`;
  for (const [label, value] of data.rows) {
    ctx.fillStyle = colors.muted;
    ctx.fillText(label, 64, y);
    ctx.fillStyle = colors.ink;
    ctx.font = `700 30px ${sans}`;
    ctx.textAlign = "right";
    ctx.fillText(value, W - 64, y);
    ctx.textAlign = "left";
    ctx.font = `500 30px ${sans}`;
    y += 54;
  }

  y += 16;
  ctx.strokeStyle = colors.line;
  ctx.beginPath();
  ctx.moveTo(64, y);
  ctx.lineTo(W - 64, y);
  ctx.stroke();

  y += 58;
  ctx.fillStyle = colors.muted;
  ctx.font = `500 28px ${sans}`;
  ctx.fillText("総返済（諸費用は別途）", 64, y);
  y += 54;
  ctx.fillStyle = colors.ink;
  ctx.font = `700 46px ${sans}`;
  ctx.fillText(data.total, 64, y);

  ctx.fillStyle = colors.faint;
  ctx.font = `500 23px ${sans}`;
  wrapText(ctx, data.disclaimer, 64, H - 118, W - 128, 32);

  ctx.fillStyle = colors.faint;
  ctx.font = `700 24px ${sans}`;
  ctx.fillText("住宅ローン試算", 64, H - 48);

  return canvas;
}

export function buildShareText(data) {
  return [
    `【住宅ローン試算】${data.dateLabel} 時点`,
    ...data.rows.map(([label, value]) => `${label}：${value}`),
    `毎月の返済：${data.monthly}${data.bonus ? `（ボーナス月＋${data.bonus}）` : ""}`,
    `総返済：${data.total}`,
    "",
    `※${data.disclaimer}`,
    // 受け取った人が自分の条件で試せるように、最後に公開URLを置く。
    ...(data.url ? ["", data.url] : []),
  ].join("\n");
}
