/**
 * Web版だけの商品紹介（広告）。ストアアプリでは出さない。
 *
 * ここに不動産の一括査定・買取業者への送客は置かない。
 * このツールの中身は「登録せずに自分で手取りを出せること」なので、
 * 結果の直後に査定の申込口を置いた時点で、業者のシミュレーターと
 * 同じものになる。成果単価は査定送客のほうがはるかに高いが、
 * それを取ると売り物そのものが無くなる。
 *
 * 置くのは、売却が決まったあとに実際に買う物だけ。
 * Amazon は審査がある。楽天は先に通ることが多い。
 * 空の ID は出さない。入っているネットのボタンだけ出す。
 */
export const AFFILIATE = {
  /** Amazon アソシエイトのトラッキング ID（例: something-22） */
  amazonTag: "",
  /** 楽天アフィリエイト ID（例: xxxx.yyyy.zzzz） */
  rakutenId: "",
};

const ITEMS = [
  {
    title: "引き渡しまでの片づけ",
    blurb: "残置物の処分袋や梱包材など、明け渡しの前にそろえるもの。",
    query: "引っ越し 梱包 資材",
  },
  {
    title: "内見前の手入れ",
    blurb: "水回りや床の清掃用品。写真と内見の印象に効くところ。",
    query: "ハウスクリーニング 洗剤 セット",
  },
  {
    title: "売却と税の本",
    blurb: "確定申告や特例の要件を、自分で一度読んでおくとき。",
    query: "不動産 売却 確定申告",
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

function storeLink(label, href) {
  return `<a class="pill" href="${href}" target="_blank" rel="sponsored nofollow noopener">${label}</a>`;
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
    notes.push("Amazonのアソシエイトとして、TethTechLabsは適格販売により収入を得ています。");
  }
  if (rakuten) notes.push("一部のリンクは楽天アフィリエイトです。");

  return `<aside class="aff" aria-labelledby="h-aff">
      <div class="aff-head">
        <h2 id="h-aff">売却の準備</h2>
        <span class="aff-badge">広告</span>
      </div>
      <p class="aff-lead">試算の数字とは関係ありません。売却が決まったあとに使う物を探すリンクです。査定や買取の申込先は置いていません。</p>
      ${items}
      <p class="aff-note">${notes.join(" ")}</p>
    </aside>`;
}
