const DEFAULT_ENDPOINT = "https://app-waitlist.tethtechlabs.workers.dev/api/monetization";
const seenSlots = new WeakSet();

function send(endpoint, payload) {
  try {
    const body = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" });
    const sent = globalThis.navigator?.sendBeacon?.(endpoint, body);
    if (!sent) {
      fetch(endpoint, {
        method: "POST",
        body,
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(() => {});
    }
  } catch {
    /* measurement must not break the page */
  }
}

function isFilledIns(el) {
  return (
    Boolean(el) &&
    el.tagName === "INS" &&
    el.classList?.contains("adsbygoogle") &&
    !el.closest?.(".ad-slot.is-empty")
  );
}

function collectIns(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope) return [];
  if (isFilledIns(scope)) return [scope];
  if (typeof scope.querySelectorAll !== "function") return [];
  return [...scope.querySelectorAll("ins.adsbygoogle")].filter(isFilledIns);
}

/**
 * @param {{
 *   propertyId: string,
 *   endpoint?: string,
 *   platform?: "web" | "ios" | "android",
 * }} opts
 */
export function createMonetization(opts) {
  const propertyId = String(opts?.propertyId || "").trim();
  const endpoint = opts?.endpoint || DEFAULT_ENDPOINT;
  const platform = opts?.platform || "web";

  function track(event, fields = {}) {
    send(endpoint, {
      event,
      property_id: propertyId,
      platform,
      ...fields,
    });
  }

  return {
    track,
    pageView({ placement = "auto" } = {}) {
      track("page_view", {
        channel: "web_ad",
        network: "adsense",
        placement,
        format: "page",
        creative: "",
      });
    },
    observeAdSlots(root) {
      if (typeof IntersectionObserver !== "function") return;
      const targets = collectIns(root).filter((el) => !seenSlots.has(el));
      if (!targets.length) return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
            const el = entry.target;
            if (seenSlots.has(el)) {
              observer.unobserve(el);
              continue;
            }
            seenSlots.add(el);
            observer.unobserve(el);
            track("slot_view", {
              channel: "web_ad",
              network: "adsense",
              placement: el.dataset.adSlot ? "slot" : "",
              format: "slot",
              creative: String(el.dataset.adSlot || "").slice(-40),
            });
          }
        },
        { threshold: 0.5 }
      );
      for (const el of targets) observer.observe(el);
    },
    affiliateView({ network, placement = "result" } = {}) {
      track("aff_view", {
        channel: "web_aff",
        network,
        placement,
        format: "link",
        creative: "",
      });
    },
  };
}

export { collectIns };
