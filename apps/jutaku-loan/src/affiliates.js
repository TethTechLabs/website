/**
 * Web版だけの商品紹介（広告）。ストアアプリでは出さない。
 *
 * Amazon は審査がある。楽天は先に通ることが多い。
 * 空の ID は出さない。入っているネットのボタンだけ出す。
 * 住宅ローン商品・銀行申込の送客は置かない。
 *
 * ID が届いたら、下の amazonTag / rakutenId に貼るだけ。
 */
export const AFFILIATE = {
  /** Amazon アソシエイトのトラッキング ID。発行済み tethtechlabs-22。審査と AdSense 通過まで空のまま。 */
  amazonTag: "",
  /** 楽天アフィリエイト ID。発行済み 56afa1ad.d9f67324.56afa1ae.7bb4984d。AdSense 通過まで空のまま。 */
  rakutenId: "",
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

function isNativeApp() {
  return globalThis.Capacitor?.isNativePlatform?.() === true;
}

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
  native = isNativeApp(),
  amazonTag = AFFILIATE.amazonTag,
  rakutenId = AFFILIATE.rakutenId,
} = {}) {
  if (native) return [];
  const networks = [];
  if (amazonTag) networks.push("amazon");
  if (rakutenId) networks.push("rakuten");
  return networks;
}

/**
 * 結果画面の下に出す HTML。
 * native / amazonTag / rakutenId はテスト用に上書きできる。
 */
export function affiliateHtml({
  native = isNativeApp(),
  amazonTag = AFFILIATE.amazonTag,
  rakutenId = AFFILIATE.rakutenId,
} = {}) {
  if (native) return "";
  const amazon = Boolean(amazonTag);
  const rakuten = Boolean(rakutenId);
  if (!amazon && !rakuten) return "";

  const items = ITEMS.map((item) => {
    const links = [];
    if (amazon) links.push(storeLink("Amazonで探す", relayUrl("amazon", item.id)));
    if (rakuten) links.push(storeLink("楽天で探す", relayUrl("rakuten", item.id)));
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
