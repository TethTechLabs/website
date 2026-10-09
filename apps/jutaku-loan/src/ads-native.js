/**
 * ストアアプリだけの広告。Web では呼ばない。
 * バンドラを使わないので Capacitor はグローバルから読む。
 *
 * バナーはセーフエリア下端。ナビはその直上。高さは SDK の通知で合わせる。
 */
const ADS = {
  androidBanner: "ca-app-pub-9222260774149288/6078118870",
  iosBanner: "ca-app-pub-9222260774149288/6764514588",
  androidInterstitial: "ca-app-pub-9222260774149288/2683782270",
  iosInterstitial: "ca-app-pub-9222260774149288/7064563769",
};

const PROPERTY_ID = "jutaku-loan";
const ENDPOINT = "https://app-waitlist.tethtechlabs.workers.dev/api/monetization";

function plugin() {
  return globalThis.Capacitor?.Plugins?.AdMob;
}

function isIos() {
  return globalThis.Capacitor?.getPlatform?.() === "ios";
}

function bannerCreative() {
  return isIos() ? "loan-ban-ios" : "loan-ban-and";
}

function interstitialCreative() {
  return isIos() ? "loan-int-ios" : "loan-int-and";
}

function setBannerHeight(px) {
  const value = Number(px);
  const height = Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
  document.documentElement.style.setProperty("--ad-banner-height", `${height}px`);
  document.querySelector(".app")?.classList.toggle("has-native-ad", height > 0);
}

function postMonetization(payload) {
  try {
    const body = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" });
    const sent = globalThis.navigator?.sendBeacon?.(ENDPOINT, body);
    if (!sent) {
      fetch(ENDPOINT, {
        method: "POST",
        body,
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(() => {});
    }
  } catch {
    /* 計測のためにバナー初期化を落とさない */
  }
}

function trackOpen() {
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

  await AdMob.addListener("bannerAdSizeChanged", (info) => setBannerHeight(info?.height));
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

export async function initNativeAds() {
  trackOpen();
  const AdMob = plugin();
  if (!AdMob) return;

  // 広告の実寸が届くまでは画面を空けない。広告なし・取得失敗時も0へ戻す。
  setBannerHeight(0);
  await registerAdListeners(AdMob);

  try {
    await AdMob.initialize({ initializeForTesting: false });
    await AdMob.showBanner({
      adId: isIos() ? ADS.iosBanner : ADS.androidBanner,
      adSize: "ADAPTIVE_BANNER",
      position: "BOTTOM_CENTER",
      margin: 0,
      isTesting: false,
    });
  } catch (error) {
    setBannerHeight(0);
    throw error;
  }
}

export async function showMatrixInterstitial() {
  const AdMob = plugin();
  if (!AdMob) return;
  const adId = isIos() ? ADS.iosInterstitial : ADS.androidInterstitial;
  if (!adId) return;
  await AdMob.prepareInterstitial({
    adId,
    isTesting: false,
  });
  await AdMob.showInterstitial();
}
