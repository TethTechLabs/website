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

let bannerReady = false;
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
  setBannerSpace(bannerHeight);
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
  if (!AdMob.addListener) return;
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
    await AdMob.initialize({ initializeForTesting: false });
    await registerAdListeners(AdMob);
    await AdMob.showBanner({
      adId: isIos() ? AD_UNITS.iosBanner : AD_UNITS.androidBanner,
      adSize: "ADAPTIVE_BANNER",
      position: "BOTTOM_CENTER",
      // 画面最下部に置く。操作バー側が SizeChanged の実測高を予約する。
      margin: 0,
      isTesting: false,
    });
    bannerReady = true;
  } catch {
    // 広告が無い・読めない場合は、操作部のための空白も残さない。
    setBannerHeight(0);
  }
}

/**
 * 税額を出す画面ではバナーを引っ込める。
 * 出しっぱなしにすると、手取りや税額のすぐ下に広告が並び、
 * 広告が試算の結果と関係あるものとして読めてしまう。
 */
export async function setBannerVisible(visible) {
  const AdMob = plugin();
  if (!AdMob || !bannerReady) {
    setBannerSpace(0);
    return;
  }
  try {
    if (visible) {
      // 読み込み済みの高さを先に戻し、広告の再表示までボタン位置を安定させる。
      setBannerSpace(bannerHeight);
      await AdMob.resumeBanner();
    } else {
      await AdMob.hideBanner();
      setBannerSpace(0);
    }
  } catch {
    // 端末や広告の状態によっては失敗する。広告のために画面を止めず、空白も残さない。
    setBannerHeight(0);
  }
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
