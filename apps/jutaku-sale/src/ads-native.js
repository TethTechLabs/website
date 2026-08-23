/**
 * ストアアプリだけの広告。Web では呼ばない。
 * 本番ユニット ID は入れない。公式テスト ID のみ。
 * バンドラを使わないので Capacitor はグローバルから読む。
 */
const TEST = {
  androidBanner: "ca-app-pub-3940256099942544/6300978111",
  iosBanner: "ca-app-pub-3940256099942544/2934735716",
  androidInterstitial: "ca-app-pub-3940256099942544/1033173712",
  iosInterstitial: "ca-app-pub-3940256099942544/4411468910",
};

function plugin() {
  return globalThis.Capacitor?.Plugins?.AdMob;
}

function isIos() {
  return globalThis.Capacitor?.getPlatform?.() === "ios";
}

let bannerReady = false;

export async function initNativeAds() {
  const AdMob = plugin();
  if (!AdMob) return;
  await AdMob.initialize({ initializeForTesting: true });
  bannerReady = true;
  await AdMob.showBanner({
    adId: isIos() ? TEST.iosBanner : TEST.androidBanner,
    adSize: "ADAPTIVE_BANNER",
    position: "BOTTOM_CENTER",
    margin: 56,
    isTesting: true,
  });
}

/**
 * 税額を出す画面ではバナーを引っ込める。
 * 出しっぱなしにすると、手取りや税額のすぐ下に広告が並び、
 * 広告が試算の結果と関係あるものとして読めてしまう。
 */
export async function setBannerVisible(visible) {
  const AdMob = plugin();
  if (!AdMob || !bannerReady) return;
  try {
    if (visible) await AdMob.resumeBanner();
    else await AdMob.hideBanner();
  } catch {
    // 端末や広告の状態によっては失敗する。広告のために画面を止めない。
  }
}

export async function showMatrixInterstitial() {
  const AdMob = plugin();
  if (!AdMob) return;
  await AdMob.prepareInterstitial({
    adId: isIos() ? TEST.iosInterstitial : TEST.androidInterstitial,
    isTesting: true,
  });
  await AdMob.showInterstitial();
}
