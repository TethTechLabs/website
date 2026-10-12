/**
 * ストアアプリだけの広告。Web では呼ばない。
 * 承認済みの AdMob（pub-9222260774149288）を使う。
 * バナーは画面最下部、インタースティシャルは結果を読んだ後に次の試算へ戻るときだけ出す。
 * バンドラを使わないので Capacitor はグローバルから読む。
 */
const AD_UNITS = {
  androidBanner: "ca-app-pub-9222260774149288/8580390646",
  iosBanner: "ca-app-pub-9222260774149288/5919557963",
  androidInterstitial: "ca-app-pub-9222260774149288/8092056042",
  iosInterstitial: "ca-app-pub-9222260774149288/8127820269",
};

/**
 * 本人の端末。ここに入れた端末だけテスト広告になる（他の利用者は本番のまま）。
 * ID は端末で起動したときの「<Google> To get test ads on this device」ログから取る。
 * 同じ開発元のアプリ（住宅ローン試算）と同じ値になる。アプリを全部消して入れ直すと変わることがある。
 */
const TEST_DEVICES = [
  "bedfe98781d67a99ffda524951925a96", // iPhone 17（2026-10-10）
];

const PROPERTY_ID = "jutaku-sale";
const ENDPOINT = "https://app-waitlist.tethtechlabs.workers.dev/api/monetization";

function plugin() {
  return globalThis.Capacitor?.Plugins?.AdMob;
}

function isIos() {
  return globalThis.Capacitor?.getPlatform?.() === "ios";
}

function bannerCreative() {
  return isIos() ? "sale-ban-ios" : "sale-ban-and";
}

function interstitialCreative() {
  return isIos() ? "sale-int-ios" : "sale-int-and";
}

/**
 * バナーを出してよい条件。すべて満たしたときだけ実際に出す。
 * 可視性を決める入力は複数あるので、個々の呼び出し側で hide/show を命令せず、
 * ここに条件を集めて syncBanner() が現状との差分だけを適用する。
 * 条件が増えるときもこのオブジェクトに足す。
 */
const allow = {
  loaded: false,      // AdMob の初期化が済んでいる
  screen: true,       // 画面が広告を許す（結果画面では出さない）
  foreground: true,   // アプリが前面にある
};
let shown = false;      // いま実際に出ているか
// リスナーは AdMob インスタンスごとに一度だけ張る。二重に張ると
// 1 回の表示で同じイベントが複数回飛び、計測が水増しされる。
const listenersFor = new WeakSet();
let syncing = Promise.resolve();
let bannerHeight = 0;

/**
 * ネイティブのバナーは WebView の上に重なるため、表示時だけ操作バーを上へ逃がす。
 * 受け取る高さは Android では dp、iOS では point で、WebView の CSS px と同じ論理単位。
 */
function setBannerSpace(height) {
  const value = Math.max(0, Math.round(Number(height) || 0));
  document.documentElement.style.setProperty("--native-banner-height", `${value}px`);
}

function setBannerHeight(height) {
  bannerHeight = Math.max(0, Math.round(Number(height) || 0));
  setBannerSpace(shown ? bannerHeight : 0);
}

function bannerOptions() {
  return {
    adId: isIos() ? AD_UNITS.iosBanner : AD_UNITS.androidBanner,
    adSize: "ADAPTIVE_BANNER",
    position: "BOTTOM_CENTER",
    // 画面最下部に置く。操作バー側が SizeChanged の実測高を予約する。
    margin: 0,
    isTesting: false,
  };
}

/**
 * 条件から「出すべきか」を決め、現状と違うときだけ操作する。
 * 直前の同期を待ってから動くので、画面遷移が続いても show と remove が競合しない。
 */
function syncBanner() {
  syncing = syncing.then(applyBannerState, applyBannerState);
  return syncing;
}

async function applyBannerState() {
  const AdMob = plugin();
  if (!AdMob) return;
  const want = allow.loaded && allow.screen && allow.foreground;
  if (want === shown) return;
  try {
    if (want) {
      await AdMob.showBanner(bannerOptions());
      shown = true;
      setBannerSpace(bannerHeight);
    } else {
      // hideBanner では AdMob のバナーが生き残り自動更新を続けるため、破棄する。
      await AdMob.removeBanner();
      shown = false;
      setBannerSpace(0);
    }
  } catch {
    // 端末や在庫の都合で失敗する。広告のために画面を止めず、空白も残さない。
    shown = false;
    setBannerSpace(0);
  }
}

/**
 * WebView はアプリが裏に回っても動き続ける。バナーを残すと AdMob が
 * 自動更新を繰り返し、誰も見ていない表示が積み上がって無効トラフィックになる。
 */
function watchAppState() {
  const App = globalThis.Capacitor?.Plugins?.App;
  if (!App?.addListener) return;
  App.addListener("appStateChange", ({ isActive }) => {
    allow.foreground = Boolean(isActive);
    syncBanner();
  });
}

function postMonetization(payload) {
  try {
    const body = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" });
    globalThis.navigator?.sendBeacon?.(ENDPOINT, body);
    fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      mode: "cors",
      credentials: "omit",
    }).catch(() => {});
  } catch {
    /* 計測のために本編を止めない */
  }
}

export function trackOpen() {
  postMonetization({
    event: "app_open",
    property_id: PROPERTY_ID,
    channel: "app_ad",
    network: "admob",
    placement: "launch",
    format: "page",
    creative: "",
    platform: isIos() ? "ios" : "android",
    status: "",
  });
}

function trackAd(event, { format, creative, status = "" }) {
  postMonetization({
    event,
    property_id: PROPERTY_ID,
    channel: "app_ad",
    network: "admob",
    placement: format === "banner" ? "bottom_banner" : "interstitial",
    format,
    creative,
    platform: isIos() ? "ios" : "android",
    status,
  });
}

async function registerAdListeners(AdMob) {
  if (listenersFor.has(AdMob) || !AdMob.addListener) return;
  listenersFor.add(AdMob);
  const banner = bannerCreative();
  const interstitial = interstitialCreative();

  await AdMob.addListener("bannerAdSizeChanged", ({ height }) => setBannerHeight(height));
  await AdMob.addListener("bannerAdFailedToLoad", () => {
    setBannerHeight(0);
    trackAd("ad_failed", { format: "banner", creative: banner, status: "load" });
  });
  await AdMob.addListener("bannerAdLoaded", () => {
    trackAd("ad_loaded", { format: "banner", creative: banner });
  });
  await AdMob.addListener("bannerAdImpression", () => {
    trackAd("ad_impression", { format: "banner", creative: banner });
  });
  // bannerAdClicked はパッチで足したイベント（patches/）。AdMob のクリック数と同じ契機で数える。
  await AdMob.addListener("bannerAdClicked", () => {
    trackAd("ad_clicked", { format: "banner", creative: banner });
  });
  await AdMob.addListener("interstitialAdLoaded", () => {
    trackAd("ad_loaded", { format: "interstitial", creative: interstitial });
  });
  await AdMob.addListener("interstitialAdFailedToLoad", () => {
    trackAd("ad_failed", { format: "interstitial", creative: interstitial, status: "load" });
  });
  await AdMob.addListener("interstitialAdShowed", () => {
    trackAd("ad_shown", { format: "interstitial", creative: interstitial });
  });
  await AdMob.addListener("interstitialAdFailedToShow", () => {
    trackAd("ad_failed", { format: "interstitial", creative: interstitial, status: "show" });
  });
  await AdMob.addListener("interstitialAdDismissed", () => {
    trackAd("ad_dismissed", { format: "interstitial", creative: interstitial });
  });
}

/** 結果画面の「Amazon / 楽天で探す」を押したとき（アプリ内アフィリエイト）。 */
export function trackAffiliateClick(network) {
  postMonetization({
    event: "aff_click",
    property_id: PROPERTY_ID,
    channel: "app_aff",
    network,
    placement: "result",
    format: "link",
    creative: "",
    platform: isIos() ? "ios" : "android",
    status: "",
  });
}

export async function initNativeAds() {
  trackOpen();
  const AdMob = plugin();
  if (!AdMob) return;
  try {
    // initializeForTesting は TEST_DEVICES を登録するだけ。広告ユニットは本番のまま。
    await AdMob.initialize({ initializeForTesting: true, testingDevices: TEST_DEVICES });
    await registerAdListeners(AdMob);
    watchAppState();
    // 起動時はまだ何も出ていない。前回の値を引きずらないよう条件を初期化する。
    allow.screen = true;
    allow.foreground = true;
    shown = false;
    allow.loaded = true;
    await syncBanner();
  } catch {
    // 広告が無い・読めない場合は、操作部のための空白も残さない。
    allow.loaded = false;
    setBannerHeight(0);
  }
}

/**
 * 税額を出す画面ではバナーを引っ込める。
 * 出しっぱなしにすると、手取りや税額のすぐ下に広告が並び、
 * 広告が試算の結果と関係あるものとして読めてしまう。
 */
export function setBannerVisible(visible) {
  allow.screen = Boolean(visible);
  return syncBanner();
}

export async function showMatrixInterstitial() {
  const AdMob = plugin();
  if (!AdMob) return;
  try {
    await AdMob.prepareInterstitial({
      adId: isIos() ? AD_UNITS.iosInterstitial : AD_UNITS.androidInterstitial,
      isTesting: false,
    });
    await AdMob.showInterstitial();
  } catch {
    // 読み込みに失敗しても、次の試算へ戻る操作を止めない。
  }
}
