/**
 * 結果画面の下の商品紹介（広告）。Web とストアアプリの両方に出す。
 *
 * 空の ID は出さない。入っているネットのボタンだけ出す。
 * 住宅ローン商品・銀行申込の送客は置かない。
 *
 * Amazon アソシエイトは 2026-08-19 申込。2027-02-15 までに他人の購入3件が要るので、
 * AdSense 通過を待たずに出す（2026-10-10 判断）。
 */
export const AFFILIATE = {
  /** Amazon アソシエイトのトラッキング ID。 */
  amazonTag: "tethtech-loan-22",
  /** 楽天アフィリエイト ID。 */
  rakutenId: "56afa1ad.d9f67324.56afa1ae.7bb4984d",
};

const RELAY_ORIGIN = "https://app-waitlist.tethtechlabs.workers.dev";
const PROPERTY_ID = "jutaku-loan";

const ITEMS = [
  {
    id: "moving-boxes",
    title: "引っ越しの梱包",
    blurb: "段ボールや緩衝材など、転居のときにそろえる消耗品。",
    query: "引っ越し 段ボール",
  },
  {
    id: "new-life-appliances",
    title: "新生活の家電",
    blurb: "冷蔵庫・洗濯機など、住み始めに検討することが多いもの。",
    query: "新生活 家電",
  },
  {
    id: "housing-loan-book",
    title: "住まいの入門書",
    blurb: "購入やローンの仕組みを、本で先に押さえておくとき。",
    query: "住宅ローン 入門",
  },
];

function amazonUrl(query, tag) {
  const url = new URL("https://www.amazon.co.jp/s");
  url.searchParams.set("k", query);
  url.searchParams.set("tag", tag);
  return url.toString();
}

function rakutenUrl(query, id) {
  const dest = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`;
  const enc = encodeURIComponent(dest);
  return `https://hb.afl.rakuten.co.jp/hgc/${id}/?pc=${enc}&m=${enc}`;
}

function relayUrl(network, linkId) {
  return `${RELAY_ORIGIN}/go/aff/${PROPERTY_ID}/${network}/${linkId}`;
}

function storeLink(label, href) {
  return `<a class="pill" href="${href}" target="_blank" rel="sponsored nofollow noopener">${label}</a>`;
}

export function shownAffiliateNetworks({
  amazonTag = AFFILIATE.amazonTag,
  rakutenId = AFFILIATE.rakutenId,
} = {}) {
  const networks = [];
  if (amazonTag) networks.push("amazon");
  if (rakutenId) networks.push("rakuten");
  return networks;
}

/**
 * 結果画面の下に出す HTML。
 * amazonTag / rakutenId はテスト用に上書きできる。
 * ストアアプリにも出す（実物の商品なので外部決済で問題ない。Amazon アソシエイトにアプリの登録が要る）。
 * リンクは target="_blank" で、アプリでは Safari / Chrome（または Amazon・楽天のアプリ）が開く。
 */
export function affiliateHtml({
  amazonTag = AFFILIATE.amazonTag,
  rakutenId = AFFILIATE.rakutenId,
} = {}) {
  const amazon = Boolean(amazonTag);
  const rakuten = Boolean(rakutenId);
  if (!amazon && !rakuten) return "";

  const items = ITEMS.map((item) => {
    const links = [];
    // 中継（/go/aff）は Worker 側の ID が未設定で 404 になるので直リンク。クリックは app.js が計測する。
    if (amazon) links.push(storeLink("Amazonで探す", amazonUrl(item.query, amazonTag)));
    if (rakuten) links.push(storeLink("楽天で探す", rakutenUrl(item.query, rakutenId)));
    return `<article class="aff-item">
        <h3>${item.title}</h3>
        <p>${item.blurb}</p>
        <div class="aff-links">${links.join("")}</div>
      </article>`;
  }).join("");

  const notes = [];
  if (amazon) {
    notes.push(
      "Amazonのアソシエイトとして、TethTechLabsは適格販売により収入を得ています。"
    );
  }
  if (rakuten) {
    notes.push("一部のリンクは楽天アフィリエイトです。");
  }

  return `<aside class="aff" aria-labelledby="h-aff">
      <div class="aff-head">
        <h2 id="h-aff">住まいの準備</h2>
        <span class="aff-badge">広告</span>
      </div>
      <p class="aff-lead">試算の数字とは別です。引っ越しや新生活で使うものを探すリンクです。融資の申込先ではありません。</p>
      ${items}
      <p class="aff-note">${notes.join(" ")}</p>
    </aside>`;
}

/** リンク先から Amazon / 楽天を見分ける。どちらでもなければ空文字。 */
export function affiliateNetworkOf(href) {
  try {
    const host = new URL(href).hostname;
    if (host.endsWith("rakuten.co.jp")) return "rakuten";
    if (host.endsWith("amazon.co.jp")) return "amazon";
  } catch {
    /* 壊れた href は数えない */
  }
  return "";
}

/** 「〜で探す」が押された瞬間に network を渡す。Web とアプリで送り先だけ変える。 */
export function onAffiliateClick(handler, root = globalThis.document) {
  root?.addEventListener?.("click", (e) => {
    const link = e.target?.closest?.(".aff a[href]");
    if (!link) return;
    const network = affiliateNetworkOf(link.href);
    if (network) handler(network);
  });
}
