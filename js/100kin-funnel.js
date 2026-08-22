const APP_ID = "100kin";
const EVENT_ENDPOINT = "https://app-waitlist.tethtechlabs.workers.dev/api/funnel";
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const STORAGE_KEY = "100kin:funnel-attribution";

function readPhase() {
  return document.documentElement.getAttribute("data-lp-phase") === "store" ? "store" : "waitlist";
}

function readAttribution() {
  const params = new URLSearchParams(location.search);
  const current = Object.fromEntries(
    ATTR_KEYS.map((key) => [key, (params.get(key) || "").slice(0, 100)]).filter(([, value]) => value)
  );

  if (Object.keys(current).length) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Measurement must never block the LP.
    }
    return current;
  }

  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
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
