// @ts-check

/** @typedef {import("../types.js").Festival} Festival */

const DEFAULT_FESTIVAL_LOGO = "/renfo-logo.png";
const ASSETS_BASE_URL = String(window.RENFO_CONFIG?.ASSETS_BASE_URL || "https://assets.renfo.app").replace(/\/+$/, "");

function sanitizeAssetPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * @param {Festival} f
 * @param {string} type
 */
function getFestivalAssetUrl(f, type) {
  const state = sanitizeAssetPart(f.state);
  const abbreviation = sanitizeAssetPart(f.abbreviation);
  const assetType = sanitizeAssetPart(type);
  if (!state || !abbreviation || !assetType) return null;
  return `${ASSETS_BASE_URL}/${state}-${abbreviation}-${assetType}.png`;
}

function setImageWithFallback(img, primarySrc, fallbackSrc = DEFAULT_FESTIVAL_LOGO) {
  img.onerror = () => {
    img.onerror = null;
    img.src = fallbackSrc;
  };
  img.src = primarySrc || fallbackSrc;
}

function normalize(s) {
  return (s ?? "").toString().toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const monthIndex = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const d = new Date(year, monthIndex, day);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * @param {Festival} f
 * @param {Date=} now
 */
function getDerivedFestivalStatus(f, now = new Date()) {
  if (f?.discontinued === true) return "Discontinued";

  const start = parseDate(f?.dateBegin ?? f?.startDate);
  const end = parseDate(f?.dateEnd ?? f?.endDate);
  const today = startOfLocalDay(now);
  const startDay = start ? startOfLocalDay(start) : null;
  const endDay = end ? startOfLocalDay(end) : null;

  if (startDay && endDay) {
    if (today < startDay) return "Upcoming";
    if (today > endDay) return "Inactive";
    return "Active";
  }

  if (startDay) {
    return today < startDay ? "Upcoming" : "Active";
  }

  if (endDay) {
    return today > endDay ? "Inactive" : "Active";
  }

  return null;
}

/**
 * @param {Festival} f
 * @param {Date=} now
 * @param {string|null=} status
 */
function getDaysUntilFestivalStart(f, now = new Date(), status = null) {
  const resolvedStatus = status ?? getDerivedFestivalStatus(f, now);
  if (resolvedStatus !== "Upcoming") return null;

  const start = parseDate(f?.dateBegin ?? f?.startDate);
  if (!start) return null;

  const today = startOfLocalDay(now);
  const startDay = startOfLocalDay(start);
  const diffMs = startDay.getTime() - today.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs < 0) return null;
  return Math.floor(diffMs / dayMs);
}

function formatLastUpdated(value) {
  if (!value) return null;
  const updatedAt = new Date(String(value));
  if (!Number.isFinite(updatedAt.getTime())) return null;

  const datePart = updatedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const timePart = updatedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  return `Last Updated: ${datePart} at ${timePart}`;
}

function compareByName(a, b) {
  return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
}

function compareByStartDate(a, b) {
  const da = parseDate(a.dateBegin) ?? parseDate(a.startDate) ?? null;
  const db = parseDate(b.dateBegin) ?? parseDate(b.startDate) ?? null;

  // Nulls last
  if (!da && !db) return compareByName(a, b);
  if (!da) return 1;
  if (!db) return -1;

  const diff = da.getTime() - db.getTime();
  return diff !== 0 ? diff : compareByName(a, b);
}

function getGroupKey(f, groupMode) {
  if (groupMode === "status") return f.status || "Unknown";
  if (groupMode === "state") return f.stateName || f.state || "Unknown";
  return "All";
}

function getListIndicatorData(f, showUpcomingDaysInList) {
  const status = normalize(f?.status).trim();

  if (status === "active") {
    return { type: "status", variant: "active", icon: "check", ariaLabel: "Status: Active" };
  }

  if (status === "upcoming") {
    const daysUntilStart = Number.isFinite(f?.daysUntilStart) ? f.daysUntilStart : null;
    if (showUpcomingDaysInList && daysUntilStart != null && daysUntilStart >= 0) {
      return { type: "days", daysUntilStart };
    }

    return { type: "status", variant: "upcoming", text: "Soon", ariaLabel: "Status: Upcoming" };
  }

  if (status === "inactive") {
    return { type: "status", variant: "inactive", icon: "help-circle", ariaLabel: "Status: Inactive" };
  }

  if (status === "discontinued") {
    return { type: "status", variant: "discontinued", icon: "x", ariaLabel: "Status: Discontinued" };
  }

  return null;
}

function sortFestivals(items, sortMode) {
  const copy = [...items];
  copy.sort(sortMode === "startDate" ? compareByStartDate : compareByName);
  return copy;
}

function sortGroupKeys(groupKeys, groupMode) {
  if (groupMode !== "status") {
    return groupKeys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  const statusOrder = new Map([
    ["active", 0],
    ["upcoming", 1],
    ["inactive", 2],
    ["discontinued", 3]
  ]);

  return groupKeys.sort((a, b) => {
    const rankA = statusOrder.get(normalize(a).trim()) ?? Number.MAX_SAFE_INTEGER;
    const rankB = statusOrder.get(normalize(b).trim()) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function formatDateRange(f) {
  const opts = { month: "short", day: "numeric", year: "numeric" };
  const start = parseDate(f.dateBegin);
  const end = parseDate(f.dateEnd);
  if (start && end) {
    return `${start.toLocaleDateString(undefined, opts)} - ${end.toLocaleDateString(undefined, opts)}`;
  }
  if (start) return start.toLocaleDateString(undefined, opts);
  if (end) return end.toLocaleDateString(undefined, opts);
  return "Not available";
}

function formatTime(value) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!m) return String(value);
  const hours24 = Number(m[1]);
  const minutes = m[2];
  if (!Number.isFinite(hours24)) return String(value);
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = ((hours24 + 11) % 12) + 1;
  return `${hours12}:${minutes} ${ampm}`;
}

function formatTimeRange(f) {
  const start = formatTime(f.timeBegin);
  const end = formatTime(f.timeEnd);
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  if (end) return end;
  return "Not available";
}

function formatAttendance(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value.toLocaleString()}+`;
  }
  return String(value);
}

function getEstablishedYear(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return year >= 1500 && year <= 2100 ? year : null;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  if (!match) return null;
  return Number(match[1]);
}

function buildDirectionsHref(f) {
  if (f.lat != null && f.lng != null) {
    return `https://maps.apple.com/?ll=${encodeURIComponent(`${f.lat},${f.lng}`)}&q=${encodeURIComponent(f.name ?? "Festival")}`;
  }

  const q = [f.address, f.city, f.state, f.zip].filter(Boolean).join(", ");
  return q ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : null;
}

function normalizeSocialUrl(platform, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const handle = value.replace(/^@/, "");
  if (!handle) return null;

  if (platform === "facebook") return `https://facebook.com/${handle}`;
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "x") return `https://x.com/${handle}`;
  if (platform === "youtube") {
    if (value.startsWith("@")) return `https://youtube.com/${value}`;
    if (/^(channel\/|c\/|user\/)/i.test(value)) return `https://youtube.com/${value}`;
    return `https://youtube.com/${handle}`;
  }
  return null;
}

function getSocialEntries(f) {
  const candidates = [
    { platform: "facebook", label: "Facebook", value: f.facebook },
    { platform: "instagram", label: "Instagram", value: f.instagram },
    { platform: "x", label: "X", value: f.x },
    { platform: "youtube", label: "YouTube", value: f.youtube }
  ];

  return candidates
    .map(item => {
      const href = normalizeSocialUrl(item.platform, item.value);
      return href ? { ...item, href } : null;
    })
    .filter(Boolean);
}

function normalizeResourceHref(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;

  const digits = value.replace(/[^\d+]/g, "");
  if (/^\+?\d{7,}$/.test(digits)) return `tel:${digits}`;
  if (/^[^\s]+\.[^\s]+$/.test(value)) return `https://${value}`;
  return null;
}

function getResourceEntries(f) {
  return [
    { type: "map", label: "Festival Map", href: f.mapAssetUrl, probeImage: true },
    { type: "camp", label: "Campground Map", href: f.campAssetUrl, probeImage: true },
    { type: "tickets", label: "Tickets", href: normalizeResourceHref(f.tickets), probeImage: false },
    { type: "lostFound", label: "Lost & Found", href: normalizeResourceHref(f.lostAndFound), probeImage: false }
  ].filter(item => !!item.href);
}

export {
  DEFAULT_FESTIVAL_LOGO,
  getFestivalAssetUrl,
  setImageWithFallback,
  normalize,
  parseDate,
  getDerivedFestivalStatus,
  getDaysUntilFestivalStart,
  formatLastUpdated,
  getGroupKey,
  getListIndicatorData,
  sortFestivals,
  sortGroupKeys,
  formatDateRange,
  formatTimeRange,
  formatAttendance,
  getEstablishedYear,
  buildDirectionsHref,
  getSocialEntries,
  getResourceEntries
};