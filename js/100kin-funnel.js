const APP_ID = "100kin";
const EVENT_ENDPOINT = "https://app-waitlist.tethtechlabs.workers.dev/api/funnel";
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const STORAGE_KEY = "100kin:funnel-attribution";

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

function track(event, placement = "") {
  const payload = JSON.stringify({
    event,
    app_id: APP_ID,
    page: "lp",
    placement,
    ...attribution,
  });
  const body = new Blob([payload], { type: "text/plain;charset=UTF-8" });
  navigator.sendBeacon?.(EVENT_ENDPOINT, body);
}

for (const link of document.querySelectorAll("[data-funnel-placement]")) {
  const placement = link.dataset.funnelPlacement || "unknown";
  const destination = new URL(link.href);
  destination.searchParams.set("from", "lp");
  destination.searchParams.set("cta", placement);
  for (const [key, value] of Object.entries(attribution)) {
    destination.searchParams.set(key, value);
  }
  link.href = destination.toString();
  link.addEventListener("click", () => track("cta_click", placement));
}

track("lp_view");
