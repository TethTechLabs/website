const APP_ID = "100kin";
const EVENT_ENDPOINT = "https://app-waitlist.tethtechlabs.workers.dev/api/funnel";
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const STORAGE_KEY = "100kin:funnel-attribution";

function readPhase() {
  return document.documentElement.getAttribute("data-lp-phase") === "store" ? "store" : "waitlist";
}

/** UTM が無い来訪の流入元。管理画面の X / YT / 直接 / 他 に合わせる。 */
function sourceFromReferrer() {
  const raw = document.referrer || "";
  if (!raw) return { utm_source: "direct" };
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com"
    ) {
      return { utm_source: "youtube", utm_medium: "social" };
    }
    if (host === "x.com" || host === "twitter.com" || host === "t.co") {
      return { utm_source: "x", utm_medium: "social" };
    }
  } catch {
    /* ignore invalid referrer */
  }
  return { utm_source: "other" };
}

function canonicalSource(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["youtube", "yt", "shorts", "youtube_shorts", "youtu"].includes(raw)) return "youtube";
  return String(value || "").trim();
}

function readAttribution() {
  const params = new URLSearchParams(location.search);
  const current = Object.fromEntries(
    ATTR_KEYS.map((key) => [key, (params.get(key) || "").slice(0, 100)]).filter(([, value]) => value)
  );
  if (current.utm_source) current.utm_source = canonicalSource(current.utm_source);

  // 再読み込みや LP 内の移動では、最初に来たときの流入元を使い続ける。
  if (!Object.keys(current).length) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") || {};
      if (stored.utm_source) return stored;
    } catch {
      // Measurement must never block the LP.
    }
  }
  if (!current.utm_source) Object.assign(current, sourceFromReferrer());

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Measurement must never block the LP.
  }
  return current;
}

const attribution = readAttribution();
const phase = readPhase();

function track(event, placement = "", extras = {}) {
  const payload = JSON.stringify({
    event,
    app_id: APP_ID,
    page: "lp",
    placement,
    ...extras,
    ...attribution,
  });
  const body = new Blob([payload], { type: "text/plain;charset=UTF-8" });
  navigator.sendBeacon?.(EVENT_ENDPOINT, body);
}

function applyAttributionParams(url) {
  const destination = new URL(url);
  for (const key of ATTR_KEYS) {
    const value = attribution[key];
    if (value) destination.searchParams.set(key, value);
  }
  return destination;
}

for (const link of document.querySelectorAll("[data-funnel-placement]")) {
  const placement = link.dataset.funnelPlacement || "unknown";
  const destination = applyAttributionParams(link.href);
  destination.searchParams.set("from", "lp");
  destination.searchParams.set("cta", placement);
  link.href = destination.toString();
  link.addEventListener("click", () => track("cta_click", placement));
}

for (const link of document.querySelectorAll("[data-store-platform]")) {
  const destination = applyAttributionParams(link.href);
  destination.searchParams.set("placement", link.dataset.storePlacement || "unknown");
  link.href = destination.toString();
}

track("lp_view", "", { status: phase });
