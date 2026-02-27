// @ts-check

// Main browser entrypoint: wires UI state, MapKit interactions, and detail rendering.
import {
  getFestivalAssetUrl,
  setImageWithFallback,
  normalize,
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
  getResourceEntries,
} from "./lib/festival-utils.js";
import { getWeatherForecast } from "./lib/weather.js";

/** @typedef {import("./types.js").Festival} Festival */

const currentYear = new Date().getFullYear();
document.querySelectorAll(".siteYear").forEach(($el) => {
  $el.textContent = currentYear;
});

// ---------- Helpers ----------
function isMapLibraryLoaded() {
  if (typeof window.mapkit?.Map === "function") return true;
  const libs = window.mapkit?.loadedLibraries;
  if (!libs) return false;
  if (Array.isArray(libs)) return libs.includes("map") || libs.includes("full-map");
  if (typeof libs.has === "function") {
    return libs.has("map") || libs.has("full-map");
  }
  return Boolean(libs.map || libs["map"] || libs["full-map"]);
}

async function waitForMapKit() {
  // `__mapKitReady` is flipped by the script callback in index.html.
  // We preserve any existing callback and resolve when it runs.
  if (!window.__mapKitReady) {
    await new Promise((resolve) => {
      const previousInit = window.initMapKit;
      window.initMapKit = () => {
        try {
          previousInit?.();
        } catch (_) {}
        resolve();
      };
    });
  }

  if (isMapLibraryLoaded()) return;

  // Callback timing can be ahead of library availability, so poll briefly.
  await new Promise((resolve, reject) => {
    const timeoutMs = 8000;
    const startMs = Date.now();
    const timer = setInterval(() => {
      if (isMapLibraryLoaded()) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startMs >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("MapKit map library did not load."));
      }
    }, 50);
  });
}

function getMapFeatureVisibility(visibilityName) {
  return window.mapkit?.FeatureVisibility?.[visibilityName];
}

function getMapPadding(top, right, bottom, left) {
  if (typeof window.mapkit?.Padding === "function") {
    return new window.mapkit.Padding(top, right, bottom, left);
  }
  return { top, right, bottom, left };
}

function normalizeApplePlaceId(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

/** @returns {Promise<Festival[]>} */
async function loadFestivals() {
  // Normalize raw festival JSON into view-ready objects used throughout the UI.
  const response = await fetch("/data/festivals.json", { cache: "no-store" });
  const data = await response.json();
  const now = new Date();

  return (data ?? [])
    .filter((f) => f.latitude != null && f.longitude != null)
    .map((f) => {
      const derivedStatus = getDerivedFestivalStatus(f, now);
      const daysUntilStart = getDaysUntilFestivalStart(f, now, derivedStatus);
      return {
        ...f,
        status: derivedStatus,
        daysUntilStart,
        lat: f.latitude,
        lng: f.longitude,
        subtitle:
          `${f.city ?? ""}${f.city && f.state ? ", " : ""}${f.state ?? ""}`.trim(),
        logoAssetUrl: getFestivalAssetUrl(f, "logo"),
        mapAssetUrl: getFestivalAssetUrl(f, "map"),
        campAssetUrl: getFestivalAssetUrl(f, "camp"),
        placeId: normalizeApplePlaceId(f.placeId ?? f.placeID),
      };
    });
}

// Persisted UI preferences for grouping/sorting and optional list indicators.
let showUpcomingDaysInList = false;
const SETTINGS_STORAGE_KEYS = {
  group: "renfo.group",
  sort: "renfo.sort",
  showUpcomingDaysInList: "renfo.showUpcomingDaysInList",
};

function readStoredSetting(key) {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch (_) {
    return null;
  }
}

function writeStoredSetting(key, value) {
  try {
    window.localStorage?.setItem(key, String(value));
  } catch (_) {}
}

function getLucideIconMarkup(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

const WEATHER_ICON_COLORS = Object.freeze({
  sunCore: "#ffd66b",
  sunCoreStroke: "#ffc24a",
  sunRay: "#ffb739",
  moon: "#dce2ff",
  moonStroke: "#c1caf8",
  cloud: "#f8fbff",
  cloudShade: "#dce7f6",
  cloudStroke: "#cfdbed",
  rain: "#6ab9ff",
  lightning: "#ffd65a",
  lightningStroke: "#ffbf45",
  fog: "#ccd9eb",
  wind: "#d3dff2",
  snow: "#a8deff",
});

const WEATHER_ICON_PATHS = Object.freeze({
  cloudFull:
    "M7 18h8.9a3.9 3.9 0 0 0 .4-7.8 5.2 5.2 0 0 0-9.8.8A3.2 3.2 0 0 0 7 18Z",
  cloudCompact:
    "M7.2 18h8.5a3.7 3.7 0 0 0 .3-7.4 4.8 4.8 0 0 0-8.9.7A3.1 3.1 0 0 0 7.2 18Z",
  cloudLow:
    "M7.1 15.5h8.8a3.9 3.9 0 0 0 .4-7.8 5.2 5.2 0 0 0-9.8.8 3.2 3.2 0 0 0 .6 7Z",
});

function getWeatherCloudMarkup(pathData, strokeWidth = "1.35") {
  const c = WEATHER_ICON_COLORS;
  return `
      <path d="${pathData}" fill="${c.cloud}" stroke="${c.cloudStroke}" stroke-width="${strokeWidth}"></path>
      <ellipse cx="12.5" cy="16.6" rx="5.3" ry="1.45" fill="${c.cloudShade}" opacity="0.62"></ellipse>
  `;
}

function getWeatherIconSvg(name) {
  const iconName = String(name ?? "")
    .trim()
    .toLowerCase();
  const c = WEATHER_ICON_COLORS;

  if (iconName === "sun") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5.2" fill="${c.sunCore}" opacity="0.24"></circle>
      <circle cx="12" cy="12" r="4.1" fill="${c.sunCore}" stroke="${c.sunCoreStroke}" stroke-width="1.35"></circle>
      <circle cx="11.3" cy="11.3" r="1.95" fill="#fff2bd" opacity="0.55"></circle>
      <g stroke="${c.sunRay}" stroke-linecap="round" stroke-width="1.7">
        <path d="M12 2.4v2.2"></path>
        <path d="M12 19.4v2.2"></path>
        <path d="m4.9 4.9 1.6 1.6"></path>
        <path d="m17.5 17.5 1.6 1.6"></path>
        <path d="M2.4 12h2.2"></path>
        <path d="M19.4 12h2.2"></path>
        <path d="m4.9 19.1 1.6-1.6"></path>
        <path d="m17.5 6.5 1.6-1.6"></path>
      </g>
    </svg>`;
  }

  if (iconName === "moon") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.6 3.4a8.8 8.8 0 1 0 5 14.9A9.5 9.5 0 0 1 15.6 3.4Z" fill="${c.moon}" stroke="${c.moonStroke}" stroke-width="1.35"></path>
      <circle cx="15.1" cy="8.1" r="1.1" fill="#edf0ff" opacity="0.62"></circle>
    </svg>`;
  }

  if (iconName === "cloud") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      ${getWeatherCloudMarkup(WEATHER_ICON_PATHS.cloudFull, "1.35")}
    </svg>`;
  }

  if (iconName === "cloud-sun") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8.7" cy="8.5" r="3.3" fill="${c.sunCore}" opacity="0.22"></circle>
      <circle cx="8.7" cy="8.5" r="2.8" fill="${c.sunCore}" stroke="${c.sunCoreStroke}" stroke-width="1.15"></circle>
      <g stroke="${c.sunRay}" stroke-linecap="round" stroke-width="1.42">
        <path d="M8.7 3.6v1.5"></path>
        <path d="M8.7 12v1.5"></path>
        <path d="m5.2 5.1 1.1 1.1"></path>
        <path d="m11 10.9 1.1 1.1"></path>
        <path d="M3.8 8.5h1.5"></path>
        <path d="M12.1 8.5h1.5"></path>
      </g>
      ${getWeatherCloudMarkup(WEATHER_ICON_PATHS.cloudCompact, "1.28")}
    </svg>`;
  }

  if (iconName === "cloud-moon") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.8 4.2a5.1 5.1 0 0 0 5.4 6.6 5.8 5.8 0 0 1-5.4-6.6Z" fill="${c.moon}" stroke="${c.moonStroke}" stroke-width="1.12"></path>
      ${getWeatherCloudMarkup(WEATHER_ICON_PATHS.cloudCompact, "1.28")}
    </svg>`;
  }

  if (iconName === "cloud-rain") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      ${getWeatherCloudMarkup(WEATHER_ICON_PATHS.cloudLow, "1.35")}
      <g stroke="${c.rain}" stroke-linecap="round" stroke-width="1.68">
        <path d="m9 17.7-.9 2"></path>
        <path d="m13 17.7-.9 2"></path>
        <path d="m17 17.7-.9 2"></path>
      </g>
    </svg>`;
  }

  if (iconName === "cloud-lightning") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      ${getWeatherCloudMarkup(WEATHER_ICON_PATHS.cloudLow, "1.35")}
      <path d="m11.5 15.8-1.4 3h2.1l-1.3 2.8 4-4.8h-2.1l1.3-3Z" fill="${c.lightning}" stroke="${c.lightningStroke}" stroke-width="1.02"></path>
    </svg>`;
  }

  if (iconName === "cloud-fog") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      ${getWeatherCloudMarkup(WEATHER_ICON_PATHS.cloudLow, "1.35")}
      <g stroke="${c.fog}" stroke-linecap="round" stroke-width="1.5">
        <path d="M7.4 17.2h9.4"></path>
        <path d="M8.8 19.6h8"></path>
      </g>
    </svg>`;
  }

  if (iconName === "wind") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="${c.wind}" stroke-linecap="round" stroke-width="1.9" fill="none">
        <path d="M3.6 8.7h9.7c2 0 2-3.1.1-3.1-.9 0-1.6.5-1.9 1.2"></path>
        <path d="M2.8 12.8h14.1c2.7 0 2.8 3.9.1 3.9-1.2 0-2.1-.7-2.5-1.6"></path>
        <path d="M4.7 17.1h7.5"></path>
      </g>
    </svg>`;
  }

  if (iconName === "snowflake") {
    return `<svg class="weatherIconSvg" viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="${c.snow}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
        <path d="M12 4.2v15.6"></path>
        <path d="M5.2 8.1 18.8 16"></path>
        <path d="M18.8 8.1 5.2 16"></path>
        <path d="m12 4.2 1.4 1.4"></path>
        <path d="m12 4.2-1.4 1.4"></path>
        <path d="m12 19.8 1.4-1.4"></path>
        <path d="m12 19.8-1.4-1.4"></path>
      </g>
    </svg>`;
  }

  return getLucideIconMarkup(iconName || "cloud");
}

function refreshLucideIcons() {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({
    attrs: { "stroke-width": "2.1" },
  });
}

window.addEventListener("load", refreshLucideIcons);

function getSocialIconSvg(platform) {
  if (platform === "facebook") {
    return getLucideIconMarkup("facebook");
  }
  if (platform === "instagram") {
    return getLucideIconMarkup("instagram");
  }
  if (platform === "youtube") {
    return getLucideIconMarkup("youtube");
  }
  return getLucideIconMarkup("twitter");
}

// ---------- UI elements ----------
const $search = document.getElementById("search");
const $searchClearBtn = document.getElementById("searchClearBtn");
const $list = document.getElementById("list");
const $group = document.getElementById("groupSelect");
const $sort = document.getElementById("sortSelect");
const $sidebar = document.getElementById("sidebar");
const $sidebarHeader = document.getElementById("sidebarHeader");
const $sidebarGrabber = document.getElementById("sidebarGrabber");
const $collapseBtn = document.getElementById("collapseBtn");
const $expandPill = document.getElementById("expandPill");
const $optionsBtn = document.getElementById("optionsBtn");
const $optionsMenu = document.getElementById("optionsMenu");
const $groupMenuRow = document.getElementById("groupMenuRow");
const $sortMenuRow = document.getElementById("sortMenuRow");
const $groupChoices = document.getElementById("groupChoices");
const $sortChoices = document.getElementById("sortChoices");
const $groupSummary = document.getElementById("groupSummary");
const $sortSummary = document.getElementById("sortSummary");
const $daysUntilToggleRow = document.getElementById("daysUntilToggleRow");
const $daysUntilToggleIcon = document.getElementById("daysUntilToggleIcon");
const $daysUntilToggleTitle = document.getElementById("daysUntilToggleTitle");
const $groupChoiceButtons = Array.from(
  document.querySelectorAll('.optionChoice[data-select="group"]'),
);
const $sortChoiceButtons = Array.from(
  document.querySelectorAll('.optionChoice[data-select="sort"]'),
);
const $detailSidebar = document.getElementById("detailSidebar");
const $detailHeader = document.getElementById("detailHeader");
const $detailHeaderLogo = document.getElementById("detailHeaderLogo");
const $detailHeaderTitle = document.getElementById("detailHeaderTitle");
const $detailCloseBtn = document.getElementById("detailCloseBtn");
const $detailBody = document.getElementById("detailBody");
const $detailHeroLogo = document.getElementById("detailHeroLogo");
const $detailTitle = document.getElementById("detailTitle");
const $detailMetaRow = document.getElementById("detailMetaRow");
const $detailMetaStatusItem = document.getElementById("detailMetaStatusItem");
const $detailMetaEstablishedItem = document.getElementById(
  "detailMetaEstablishedItem",
);
const $detailMetaAttendanceItem = document.getElementById(
  "detailMetaAttendanceItem",
);
const $detailMetaStatusValue = document.getElementById("detailMetaStatusValue");
const $detailMetaEstablishedValue = document.getElementById(
  "detailMetaEstablishedValue",
);
const $detailMetaAttendanceValue = document.getElementById(
  "detailMetaAttendanceValue",
);
const $detailMetaItems = Array.from(
  $detailMetaRow.querySelectorAll(".detailMetaItem"),
);
const $detailSocialCard = document.getElementById("detailSocialCard");
const $detailSocials = document.getElementById("detailSocials");
const $detailLastUpdated = document.getElementById("detailLastUpdated");
const $detailDescriptionCard = document.getElementById("detailDescriptionCard");
const $detailDesc = document.getElementById("detailDesc");
const $detailActionCall = document.getElementById("detailActionCall");
const $detailActionDirections = document.getElementById(
  "detailActionDirections",
);
const $detailActionWebsite = document.getElementById("detailActionWebsite");
const $detailDateValue = document.getElementById("detailDateValue");
const $detailTimeValue = document.getElementById("detailTimeValue");
const $detailWeatherCard = document.getElementById("detailWeatherCard");
const $detailWeatherStatus = document.getElementById("detailWeatherStatus");
const $detailWeatherRows = document.getElementById("detailWeatherRows");
const $detailAddressLine1 = document.getElementById("detailAddressLine1");
const $detailAddressLine2 = document.getElementById("detailAddressLine2");
const $detailAddressLine3 = document.getElementById("detailAddressLine3");
const $detailAddressOpenBtn = document.getElementById("detailAddressOpenBtn");
const $detailAppleCard = document.getElementById("detailAppleCard");
const $detailAppleOpenBtn = document.getElementById("detailAppleOpenBtn");
const $detailLookAroundCard = document.getElementById("detailLookAroundCard");
const $detailLookAroundViewport = document.getElementById(
  "detailLookAroundViewport",
);
const $detailResourcesCard = document.getElementById("detailResourcesCard");
const $detailResources = document.getElementById("detailResources");
const $mobileMapControls = document.getElementById("mobileMapControls");
const $mobileMapStyleBtn = document.getElementById("mobileMapStyleBtn");
const $mobileUserLocationBtn = document.getElementById("mobileUserLocationBtn");
const $aboutOpenBtn = document.getElementById("aboutOpenBtn");
const $aboutModal = document.getElementById("aboutModal");
const $aboutDialog = document.getElementById("aboutDialog");
const $aboutCloseBtn = document.getElementById("aboutCloseBtn");
const $aboutBackdrop = document.getElementById("aboutBackdrop");

// Shared UI/runtime state.
let selectedFestivalId = null;
// Increments on each detail render request so async work can be ignored if stale.
let detailRenderVersion = 0;
let isDetailWeatherExpanded = false;
// Avoid repeated image probes for the same URL when building resource rows.
const resourceAssetExistsCache = new Map();
const applePlaceCache = new Map();
let activeAppleLookAround = null;
let appleLookAroundProbeHost = null;
const mobileMedia = window.matchMedia("(max-width: 640px)");
let mobileSheetState = "peek";
let mobileSheetOffset = 0;
let mobileSheetDrag = null;
let syncMapChromeForViewport = null;
let detailHeaderTitleSyncRaf = null;

function syncBrowserBottomInset() {
  const vv = window.visualViewport;
  let bottomInset = 0;
  if (vv) {
    const innerDelta = Math.round((window.innerHeight || 0) - vv.height);
    const clientDelta = Math.round(
      (document.documentElement?.clientHeight || 0) - vv.height,
    );
    const offsetDelta = Math.round(
      (window.innerHeight || 0) - (vv.height + vv.offsetTop),
    );
    bottomInset = Math.max(0, innerDelta, clientDelta, offsetDelta);
    // Ignore on-screen keyboard insets; this offset is for browser chrome overlap.
    if (bottomInset > 140) bottomInset = 0;
  }
  document.documentElement.style.setProperty(
    "--browser-bottom-inset",
    `${bottomInset}px`,
  );
}

function getSelectLabel(selectEl) {
  return selectEl.options[selectEl.selectedIndex]?.textContent ?? "";
}

function setDetailHeaderTitleProgress(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  $detailSidebar.style.setProperty(
    "--detail-header-title-progress",
    clamped.toFixed(3),
  );
}

function syncDetailHeaderTitleProgress() {
  if ($detailSidebar.hidden) {
    setDetailHeaderTitleProgress(0);
    return;
  }

  const headerRect = $detailHeader.getBoundingClientRect();
  const titleRect = $detailTitle.getBoundingClientRect();
  const fadeStart = 18;
  const fadeDistance = 44;
  const progress =
    (headerRect.bottom + fadeStart - titleRect.bottom) / fadeDistance;
  setDetailHeaderTitleProgress(progress);
}

function queueDetailHeaderTitleSync() {
  if (detailHeaderTitleSyncRaf != null) return;
  detailHeaderTitleSyncRaf = requestAnimationFrame(() => {
    detailHeaderTitleSyncRaf = null;
    syncDetailHeaderTitleProgress();
  });
}

function syncOptionsMenuState() {
  $groupSummary.textContent = getSelectLabel($group);
  $sortSummary.textContent = getSelectLabel($sort);
  $daysUntilToggleTitle.textContent = showUpcomingDaysInList
    ? "Hide Indicator"
    : "Show Indicator";
  $daysUntilToggleIcon.innerHTML = getLucideIconMarkup(
    showUpcomingDaysInList ? "eye-off" : "eye",
  );
  refreshLucideIcons();

  for (const button of $groupChoiceButtons) {
    button.classList.toggle("is-active", button.dataset.value === $group.value);
  }
  for (const button of $sortChoiceButtons) {
    button.classList.toggle("is-active", button.dataset.value === $sort.value);
  }
}

function syncOptionsMenuDirection() {
  if (!isMobileViewport()) {
    $optionsMenu.classList.remove("options-menu-up");
    $optionsMenu.classList.add("options-menu-down");
    return;
  }

  const sheetTop = $sidebar.getBoundingClientRect().top;
  const openDown = sheetTop <= window.innerHeight * 0.5;
  $optionsMenu.classList.toggle("options-menu-down", openDown);
  $optionsMenu.classList.toggle("options-menu-up", !openDown);
}

function positionOptionsMenu() {
  const headerRect = $sidebarHeader.getBoundingClientRect();
  const btnRect = $optionsBtn.getBoundingClientRect();
  const right = Math.max(8, Math.round(headerRect.right - btnRect.right));
  const openUp =
    isMobileViewport() && $optionsMenu.classList.contains("options-menu-up");
  const top = openUp
    ? Math.round(btnRect.bottom - headerRect.top)
    : Math.round(btnRect.top - headerRect.top);

  $optionsMenu.style.right = `${right}px`;
  $optionsMenu.style.top = `${top}px`;
}

function setChoicesOpen(type, open) {
  const isGroup = type === "group";
  const row = isGroup ? $groupMenuRow : $sortMenuRow;
  const choices = isGroup ? $groupChoices : $sortChoices;
  choices.hidden = !open;
  row.classList.toggle("is-open", open);
  row.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeOptionsMenu() {
  $optionsMenu.hidden = true;
  $optionsBtn.classList.remove("is-menu-open");
  $sidebar.classList.remove("options-open");
  setChoicesOpen("group", false);
  setChoicesOpen("sort", false);
}

function toggleOptionsMenu() {
  const opening = $optionsMenu.hidden;
  if (!opening) {
    closeOptionsMenu();
    return;
  }

  syncOptionsMenuState();
  syncOptionsMenuDirection();
  positionOptionsMenu();
  $optionsMenu.hidden = false;
  $optionsBtn.classList.add("is-menu-open");
  $sidebar.classList.add("options-open");
}

function toggleChoices(type) {
  if (type === "group") {
    const opening = $groupChoices.hidden;
    setChoicesOpen("group", opening);
    setChoicesOpen("sort", false);
    return;
  }

  const opening = $sortChoices.hidden;
  setChoicesOpen("sort", opening);
  setChoicesOpen("group", false);
}

function isAboutModalOpen() {
  return Boolean($aboutModal && !$aboutModal.hidden);
}

function openAboutModal() {
  if (!$aboutModal) return;
  closeOptionsMenu();
  $aboutModal.hidden = false;
  document.body.classList.add("about-open");
  refreshLucideIcons();
  requestAnimationFrame(() => {
    $aboutCloseBtn?.focus();
  });
}

function closeAboutModal(options = {}) {
  const { restoreFocus = true } = options;
  if (!$aboutModal || $aboutModal.hidden) return;
  $aboutModal.hidden = true;
  document.body.classList.remove("about-open");
  if (restoreFocus) $aboutOpenBtn?.focus();
}

function setSelectValue(selectEl, value) {
  if (selectEl.value === value) return;
  selectEl.value = value;
  selectEl.dispatchEvent(new Event("change"));
}

function applyStoredUiSettings() {
  // Apply only valid stored values so new option sets don't break UI state.
  const storedGroup = readStoredSetting(SETTINGS_STORAGE_KEYS.group);
  if (
    storedGroup &&
    Array.from($group.options).some((option) => option.value === storedGroup)
  ) {
    $group.value = storedGroup;
  }

  const storedSort = readStoredSetting(SETTINGS_STORAGE_KEYS.sort);
  if (
    storedSort &&
    Array.from($sort.options).some((option) => option.value === storedSort)
  ) {
    $sort.value = storedSort;
  }

  const storedShowUpcomingDays = readStoredSetting(
    SETTINGS_STORAGE_KEYS.showUpcomingDaysInList,
  );
  if (storedShowUpcomingDays != null) {
    showUpcomingDaysInList = storedShowUpcomingDays === "true";
  }
}

function isMobileViewport() {
  return mobileMedia.matches;
}

function getMobileSheetMetrics() {
  const sidebarHeight = $sidebar.getBoundingClientRect().height;
  const headerHeight = $sidebarHeader.getBoundingClientRect().height;
  const peekVisible = Math.max(96, headerHeight);
  const maxOffset = Math.max(0, sidebarHeight - peekVisible);
  const midOffsetRatio = 0.66;
  document.documentElement.style.setProperty(
    "--mobile-sheet-peek-visible",
    `${peekVisible}px`,
  );
  return {
    full: 0,
    mid: Math.round(maxOffset * midOffsetRatio),
    peek: maxOffset,
  };
}

function applyMobileSheetOffset(nextOffset, options = {}) {
  if (!isMobileViewport()) return;
  const { animate = true } = options;
  const { peek } = getMobileSheetMetrics();
  const clamped = Math.min(Math.max(nextOffset, 0), peek);
  mobileSheetOffset = clamped;
  if (!animate) $sidebar.style.transition = "none";
  $sidebar.style.setProperty("--mobile-list-offset", `${clamped}px`);
  if (!animate) {
    requestAnimationFrame(() => {
      $sidebar.style.removeProperty("transition");
    });
  }
}

function syncMobileSheetMetaVisibility() {
  const show =
    isMobileViewport() &&
    mobileSheetState === "peek" &&
    !document.body.classList.contains("mobile-detail-open");
  document.body.classList.toggle("mobile-sheet-peek", show);
}

function setMobileSheetState(nextState, options = {}) {
  if (!isMobileViewport()) return;
  const { animate = true } = options;
  const { full, mid, peek } = getMobileSheetMetrics();
  const target = nextState === "full" ? full : nextState === "mid" ? mid : peek;
  mobileSheetState = nextState;
  applyMobileSheetOffset(target, { animate });
  syncMobileSheetMetaVisibility();
  if (typeof syncMapChromeForViewport === "function") syncMapChromeForViewport();
}

function snapMobileSheetToNearest() {
  if (!isMobileViewport()) return;
  const metrics = getMobileSheetMetrics();
  const states = ["full", "mid", "peek"];
  let nearest = "peek";
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const state of states) {
    const dist = Math.abs(mobileSheetOffset - metrics[state]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = state;
    }
  }
  setMobileSheetState(nearest, { animate: true });
}

function syncMobileModeClasses() {
  syncBrowserBottomInset();
  const mobile = isMobileViewport();
  document.body.classList.toggle("mobile-mode", mobile);
  if (!mobile) {
    document.body.classList.remove("mobile-detail-open");
    document.body.classList.remove("mobile-sheet-peek");
    $sidebar.style.removeProperty("--mobile-list-offset");
    syncOptionsMenuDirection();
    positionOptionsMenu();
    if (typeof syncMapChromeForViewport === "function")
      syncMapChromeForViewport();
    return;
  }
  setMobileSheetState(mobileSheetState, { animate: false });
  if (!$optionsMenu.hidden) {
    syncOptionsMenuDirection();
    positionOptionsMenu();
  }
}

function syncMobileDetailSheetState(isOpen) {
  if (!isMobileViewport()) {
    document.body.classList.remove("mobile-detail-open");
    document.body.classList.remove("mobile-sheet-peek");
    return;
  }
  if (isOpen) {
    document.body.classList.add("mobile-detail-open");
    syncMobileSheetMetaVisibility();
    if (typeof syncMapChromeForViewport === "function")
      syncMapChromeForViewport();
    return;
  }

  // Bring list sheet back instantly when detail closes.
  $sidebar.style.transition = "none";
  document.body.classList.remove("mobile-detail-open");
  syncMobileSheetMetaVisibility();
  if (typeof syncMapChromeForViewport === "function")
    syncMapChromeForViewport();
  requestAnimationFrame(() => {
    $sidebar.style.removeProperty("transition");
  });
}

function updateSearchClearVisibility() {
  $searchClearBtn.hidden = !$search.value;
}

function setCollapsed(collapsed) {
  if (isMobileViewport()) return;
  $sidebar.classList.toggle("is-collapsed", collapsed);
  $expandPill.classList.toggle("show", collapsed);
  document.body.classList.toggle("list-collapsed", collapsed);
  if (collapsed) closeOptionsMenu();
}

$collapseBtn.addEventListener("click", () => setCollapsed(true));
$expandPill.addEventListener("click", () => setCollapsed(false));
$optionsBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleOptionsMenu();
});
$optionsMenu.addEventListener("click", (event) => event.stopPropagation());
$groupMenuRow.addEventListener("click", () => toggleChoices("group"));
$sortMenuRow.addEventListener("click", () => toggleChoices("sort"));
document.addEventListener("click", closeOptionsMenu);
$aboutOpenBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  openAboutModal();
});
$aboutCloseBtn?.addEventListener("click", () => {
  closeAboutModal();
});
$aboutBackdrop?.addEventListener("click", () => {
  closeAboutModal();
});
$aboutDialog?.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (isAboutModalOpen()) {
    closeAboutModal();
    return;
  }
  closeOptionsMenu();
});
$searchClearBtn.addEventListener("click", () => {
  if (!$search.value) return;
  $search.value = "";
  $search.dispatchEvent(new Event("input", { bubbles: true }));
  $search.focus();
});
$detailBody.addEventListener("scroll", queueDetailHeaderTitleSync, {
  passive: true,
});
window.addEventListener("resize", queueDetailHeaderTitleSync);

function handleMobileSheetPointerDown(event) {
  if (!isMobileViewport()) return;
  if (document.body.classList.contains("mobile-detail-open")) return;
  if (event.target.closest("button, a, input, select, textarea, label")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  mobileSheetDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startOffset: mobileSheetOffset,
  };
  document.body.classList.remove("mobile-sheet-peek");
  $sidebarHeader.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handleMobileSheetPointerMove(event) {
  if (!mobileSheetDrag) return;
  if (event.pointerId !== mobileSheetDrag.pointerId) return;
  const delta = event.clientY - mobileSheetDrag.startY;
  applyMobileSheetOffset(mobileSheetDrag.startOffset + delta, {
    animate: false,
  });
  event.preventDefault();
}

function handleMobileSheetPointerUp(event) {
  if (!mobileSheetDrag) return;
  if (event.pointerId !== mobileSheetDrag.pointerId) return;
  mobileSheetDrag = null;
  snapMobileSheetToNearest();
}

$sidebarGrabber.addEventListener("pointerdown", handleMobileSheetPointerDown);
$sidebarHeader.addEventListener("pointerdown", handleMobileSheetPointerDown);
window.addEventListener("pointermove", handleMobileSheetPointerMove, {
  passive: false,
});
window.addEventListener("pointerup", handleMobileSheetPointerUp);
window.addEventListener("pointercancel", handleMobileSheetPointerUp);
if (mobileMedia.addEventListener) {
  mobileMedia.addEventListener("change", syncMobileModeClasses);
} else if (mobileMedia.addListener) {
  mobileMedia.addListener(syncMobileModeClasses);
}
window.addEventListener("resize", () => syncMobileModeClasses());
window.addEventListener("orientationchange", () => syncMobileModeClasses());
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncMobileModeClasses);
  window.visualViewport.addEventListener("scroll", syncMobileModeClasses);
}

for (const button of $groupChoiceButtons) {
  button.addEventListener("click", () => {
    setSelectValue($group, button.dataset.value);
    closeOptionsMenu();
  });
}

for (const button of $sortChoiceButtons) {
  button.addEventListener("click", () => {
    setSelectValue($sort, button.dataset.value);
    closeOptionsMenu();
  });
}

/**
 * @param {Festival[]} items
 * @param {string} groupMode
 * @param {(festival: Festival) => void} onSelect
 */
function renderListGrouped(items, groupMode, onSelect) {
  $list.innerHTML = "";

  const grouped = new Map();
  for (const f of items) {
    const key = getGroupKey(f, groupMode);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(f);
  }

  const groupKeys =
    groupMode === "none"
      ? ["All"]
      : sortGroupKeys(Array.from(grouped.keys()), groupMode);

  for (const key of groupKeys) {
    const groupItems = grouped.get(key) ?? items;
    if (groupMode !== "none") {
      const header = document.createElement("div");
      header.className = "sectionHeader";
      header.textContent = key;
      $list.appendChild(header);
    } else {
      const spacer = document.createElement("div");
      spacer.className = "sectionHeader sectionHeaderSpacer";
      spacer.textContent = " ";
      spacer.setAttribute("aria-hidden", "true");
      $list.appendChild(spacer);
    }

    const sectionGroup = document.createElement("div");
    sectionGroup.className = "sectionGroup";

    for (const f of groupItems) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.id = String(f.id);
      if (
        selectedFestivalId != null &&
        String(f.id) === String(selectedFestivalId)
      ) {
        row.classList.add("is-selected");
      }

      const rowMain = document.createElement("div");
      rowMain.className = "rowMain";

      const logo = document.createElement("img");
      logo.className = "rowLogo";
      logo.alt = "";
      logo.setAttribute("aria-hidden", "true");
      setImageWithFallback(logo, f.logoAssetUrl);

      const title = document.createElement("p");
      title.className = "rowTitle";
      title.textContent = f.name ?? "Untitled";

      rowMain.append(logo, title);
      row.appendChild(rowMain);

      const indicatorData = getListIndicatorData(f, showUpcomingDaysInList);
      if (indicatorData?.type === "days") {
        const daysWrap = document.createElement("div");
        daysWrap.className = "rowDaysUntil";
        const dayLabel = indicatorData.daysUntilStart === 1 ? "day" : "days";
        daysWrap.setAttribute(
          "aria-label",
          `${indicatorData.daysUntilStart} ${dayLabel} until start`,
        );

        const daysValue = document.createElement("span");
        daysValue.className = "rowDaysUntilValue";
        daysValue.textContent = String(indicatorData.daysUntilStart);

        const daysLabel = document.createElement("span");
        daysLabel.className = "rowDaysUntilLabel";
        daysLabel.textContent = dayLabel;

        daysWrap.append(daysValue, daysLabel);
        row.appendChild(daysWrap);
      } else if (indicatorData?.type === "status") {
        const statusWrap = document.createElement("div");
        statusWrap.className = `rowStatusIndicator rowStatusIndicator--${indicatorData.variant}`;
        statusWrap.setAttribute("aria-label", indicatorData.ariaLabel);

        if (indicatorData.icon) {
          statusWrap.innerHTML = `<span class="rowStatusIndicatorIcon">${getLucideIconMarkup(indicatorData.icon)}</span>`;
        } else {
          const statusText = document.createElement("span");
          statusText.className = "rowStatusIndicatorText";
          statusText.textContent = indicatorData.text;
          statusWrap.appendChild(statusText);
        }

        row.appendChild(statusWrap);
      }

      row.addEventListener("click", () => onSelect(f));
      sectionGroup.appendChild(row);
    }

    $list.appendChild(sectionGroup);

    if (groupMode === "none") break;
  }

  refreshLucideIcons();
}

function setDetailActionLink(el, href, openInNewTab = false) {
  if (!href) {
    el.removeAttribute("href");
    el.removeAttribute("target");
    el.removeAttribute("rel");
    el.setAttribute("aria-disabled", "true");
    el.classList.add("is-disabled");
    return;
  }

  el.href = href;
  el.removeAttribute("aria-disabled");
  el.classList.remove("is-disabled");
  if (openInNewTab) {
    el.target = "_blank";
    el.rel = "noopener noreferrer";
  } else {
    el.removeAttribute("target");
    el.removeAttribute("rel");
  }
}

function renderWeatherStatus(message) {
  const text = String(message ?? "").trim();
  $detailWeatherStatus.textContent = text;
  $detailWeatherStatus.hidden = !text;
}

function syncDetailWeatherToggle(dayCount = 0) {
  const hasExpandableForecast = dayCount > 1;
  $detailWeatherRows.classList.toggle(
    "is-collapsed",
    hasExpandableForecast && !isDetailWeatherExpanded,
  );
  const toggleButton = $detailWeatherRows.querySelector(".detailWeatherToggle");
  if (!toggleButton) return;
  toggleButton.setAttribute(
    "aria-expanded",
    String(hasExpandableForecast && isDetailWeatherExpanded),
  );
  const buttonLabel =
    hasExpandableForecast && isDetailWeatherExpanded
      ? "Collapse forecast"
      : "Expand forecast";
  toggleButton.setAttribute("aria-label", buttonLabel);
  toggleButton.title = buttonLabel;
}

function resetDetailWeatherToggle() {
  isDetailWeatherExpanded = false;
  syncDetailWeatherToggle(0);
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function waitForDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function getAppleLookAroundProbeHost() {
  if (appleLookAroundProbeHost?.isConnected) return appleLookAroundProbeHost;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "fixed";
  host.style.left = "-200vw";
  host.style.top = "0";
  host.style.width = "320px";
  host.style.height = "184px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.overflow = "hidden";
  host.style.zIndex = "-1";
  document.body.appendChild(host);
  appleLookAroundProbeHost = host;
  return host;
}

function destroyDetailAppleEmbeds() {
  if (typeof activeAppleLookAround?.destroy === "function") {
    try {
      activeAppleLookAround.destroy();
    } catch (_) {}
  }
  activeAppleLookAround = null;
  $detailLookAroundViewport.innerHTML = "";
}

function clearDetailApplePanels() {
  destroyDetailAppleEmbeds();
  $detailAppleCard.hidden = true;
  $detailLookAroundCard.hidden = true;
  setDetailActionLink($detailAppleOpenBtn, null, true);
}

function buildAppleMapsHref(f) {
  const placeId = normalizeApplePlaceId(f?.placeId ?? f?.placeID);
  if (placeId) {
    return `https://maps.apple.com/place?place-id=${encodeURIComponent(placeId)}`;
  }

  const q = [f?.name, f?.address, f?.city, f?.state, f?.zip]
    .filter(Boolean)
    .join(", ");
  if (q) return `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  return buildDirectionsHref(f);
}

function buildAppleSearchRegion(lat, lng) {
  if (
    typeof window.mapkit?.Coordinate !== "function" ||
    typeof window.mapkit?.CoordinateSpan !== "function" ||
    typeof window.mapkit?.CoordinateRegion !== "function"
  ) {
    return null;
  }
  return new window.mapkit.CoordinateRegion(
    new window.mapkit.Coordinate(lat, lng),
    new window.mapkit.CoordinateSpan(0.08, 0.08),
  );
}

function computeAppleCoordinateDistance(place, f) {
  const lat = place?.coordinate?.latitude;
  const lng = place?.coordinate?.longitude;
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    typeof lng !== "number" ||
    !Number.isFinite(lng)
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.hypot(lat - f.lat, lng - f.lng);
}

function scoreApplePlaceSearchMatch(place, f) {
  const placeName = normalize(place?.name ?? "");
  const festivalName = normalize(f?.name ?? "");
  let score = 0;

  if (placeName && festivalName) {
    if (placeName === festivalName) score += 100;
    if (placeName.includes(festivalName) || festivalName.includes(placeName)) {
      score += 50;
    }

    const festivalTokens = festivalName
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);
    for (const token of festivalTokens) {
      if (placeName.includes(token)) score += 8;
    }
  }

  const distancePenalty = Math.min(
    40,
    Math.round(computeAppleCoordinateDistance(place, f) * 300),
  );
  return score - distancePenalty;
}

function pickBestAppleSearchPlace(places, f) {
  const ranked = [...places]
    .filter(Boolean)
    .map((place) => ({ place, score: scoreApplePlaceSearchMatch(place, f) }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  if (ranked[0].score < 12) return null;
  return ranked[0].place;
}

function lookupApplePlaceById(placeId) {
  if (
    !placeId ||
    typeof window.mapkit?.PlaceLookup !== "function"
  ) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const lookup = new window.mapkit.PlaceLookup();
    lookup.getPlace(placeId, (error, place) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(place ?? null);
    });
  });
}

function searchApplePlaceForFestival(f) {
  if (
    typeof window.mapkit?.Search !== "function" ||
    typeof f?.lat !== "number" ||
    typeof f?.lng !== "number"
  ) {
    return Promise.resolve(null);
  }

  const region = buildAppleSearchRegion(f.lat, f.lng);
  const searchOptions = region ? { region } : {};
  const regionPriority = window.mapkit?.Search?.RegionPriority?.Required;
  if (regionPriority) {
    searchOptions.regionPriority = regionPriority;
  }

  return new Promise((resolve, reject) => {
    const search = new window.mapkit.Search(searchOptions);
    search.search(f.name ?? "", (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      const places = Array.isArray(data?.places) ? data.places : [];
      resolve(pickBestAppleSearchPlace(places, f));
    });
  });
}

async function resolveFestivalApplePlace(f) {
  const placeId = normalizeApplePlaceId(f?.placeId ?? f?.placeID);

  if (placeId) {
    try {
      const place = await lookupApplePlaceById(placeId);
      if (place) return place;
    } catch (_) {}
  }

  try {
    const place = await searchApplePlaceForFestival(f);
    if (place) return place;
  } catch (_) {}

  return null;
}

function getFestivalApplePlace(f) {
  const placeId = normalizeApplePlaceId(f?.placeId ?? f?.placeID);
  const key = placeId
    ? `place:${placeId}`
    : `festival:${String(f?.id ?? "")}:${String(f?.lat ?? "")}:${String(f?.lng ?? "")}`;

  if (applePlaceCache.has(key)) return applePlaceCache.get(key);

  const promise = resolveFestivalApplePlace(f).catch((error) => {
    applePlaceCache.delete(key);
    throw error;
  });
  applePlaceCache.set(key, promise);
  return promise;
}

function getLookAroundLocationKey(location) {
  if (typeof location?.id === "string" && location.id.trim()) {
    return `place:${location.id.trim()}`;
  }

  const lat = location?.coordinate?.latitude ?? location?.latitude;
  const lng = location?.coordinate?.longitude ?? location?.longitude;
  if (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  ) {
    return `coord:${lat.toFixed(6)},${lng.toFixed(6)}`;
  }

  return null;
}

function getLookAroundLocationCandidates(f, place = null) {
  const candidates = [];
  const seen = new Set();
  const appendCandidate = (location) => {
    if (!location) return;
    const key = getLookAroundLocationKey(location);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    candidates.push(location);
  };

  if (place) {
    appendCandidate(place);
  }

  if (
    typeof window.mapkit?.Coordinate === "function" &&
    typeof f?.lat === "number" &&
    Number.isFinite(f.lat) &&
    typeof f?.lng === "number" &&
    Number.isFinite(f.lng)
  ) {
    appendCandidate(new window.mapkit.Coordinate(f.lat, f.lng));
  }

  return candidates;
}

async function probeLookAroundAvailability(location, renderVersion) {
  if (typeof window.mapkit?.LookAround !== "function") return false;

  const probeHost = getAppleLookAroundProbeHost();
  probeHost.innerHTML = "";

  return new Promise((resolve) => {
    let probe = null;
    let isSettled = false;
    const finish = (isAvailable) => {
      if (isSettled) return;
      isSettled = true;
      if (typeof probe?.destroy === "function") {
        try {
          probe.destroy();
        } catch (_) {}
      }
      probeHost.innerHTML = "";
      resolve(renderVersion === detailRenderVersion && isAvailable);
    };

    try {
      probe = new window.mapkit.LookAround(probeHost, location, {
        showsDialogControl: false,
      });
      probe.addEventListener?.("load", () => finish(true));
      probe.addEventListener?.("error", () => finish(false));
      probe.addEventListener?.("readystatechange", () => {
        if (probe?.readyState === "complete") {
          finish(true);
          return;
        }
        if (probe?.readyState === "error") {
          finish(false);
        }
      });
      waitForDelay(5000).then(() => finish(false));
    } catch (_) {
      finish(false);
    }
  });
}

async function mountDetailLookAround(location, renderVersion) {
  $detailLookAroundCard.hidden = false;
  await waitForNextFrame();
  if (renderVersion !== detailRenderVersion) return false;

  try {
    if (typeof window.mapkit?.LookAroundPreview !== "function") {
      $detailLookAroundCard.hidden = true;
      return false;
    }
    activeAppleLookAround = new window.mapkit.LookAroundPreview(
      $detailLookAroundViewport,
      location,
    );
    return true;
  } catch (_) {
    $detailLookAroundCard.hidden = true;
    $detailLookAroundViewport.innerHTML = "";
    activeAppleLookAround = null;
    return false;
  }
}

async function renderDetailAppleMaps(f, renderVersion) {
  clearDetailApplePanels();

  if (!f || (f.lat == null && !normalizeApplePlaceId(f.placeId ?? f.placeID))) {
    return;
  }

  const mapsHref = buildAppleMapsHref(f);
  $detailAppleCard.hidden = false;
  setDetailActionLink($detailAppleOpenBtn, mapsHref, true);

  if (
    typeof window.mapkit?.LookAround !== "function" ||
    typeof window.mapkit?.LookAroundPreview !== "function" ||
    !$detailLookAroundViewport
  ) {
    return;
  }

  let place = null;
  try {
    place = await getFestivalApplePlace(f);
  } catch (_) {}
  if (renderVersion !== detailRenderVersion) return;

  const lookAroundCandidates = getLookAroundLocationCandidates(f, place);
  for (const candidate of lookAroundCandidates) {
    const isAvailable = await probeLookAroundAvailability(
      candidate,
      renderVersion,
    );
    if (renderVersion !== detailRenderVersion) return;
    if (!isAvailable) continue;

    const didMount = await mountDetailLookAround(candidate, renderVersion);
    if (renderVersion !== detailRenderVersion) return;
    if (didMount) break;
  }
}

async function renderDetailWeather(f, renderVersion) {
  $detailWeatherRows.innerHTML = "";
  resetDetailWeatherToggle();

  if (!f || f.lat == null || f.lng == null) {
    renderWeatherStatus("");
    $detailWeatherCard.hidden = true;
    return;
  }

  $detailWeatherCard.hidden = false;
  renderWeatherStatus("Loading forecast...");

  try {
    const weather = await getWeatherForecast(f.lat, f.lng);
    // A newer selection may have rendered while this request was in flight.
    if (renderVersion !== detailRenderVersion) return;
    renderWeatherStatus("");

    if (!Array.isArray(weather?.days) || weather.days.length === 0) {
      if (!$detailWeatherStatus.textContent) {
        renderWeatherStatus("Forecast unavailable.");
      }
      syncDetailWeatherToggle(0);
      return;
    }

    $detailWeatherRows.innerHTML = "";
    for (const [index, day] of weather.days.entries()) {
      const row = document.createElement("div");
      row.className = "detailWeatherRow";
      const isExpandableRow = index === 0 && weather.days.length > 1;
      if (isExpandableRow) {
        row.classList.add("is-expandable");
      }

      const iconWrap = document.createElement("span");
      iconWrap.className = "detailWeatherIconWrap";

      const icon = document.createElement("span");
      icon.className = "detailWeatherIcon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = getWeatherIconSvg(day.icon);
      iconWrap.append(icon);

      if (
        typeof day.precipChancePercent === "number" &&
        Number.isFinite(day.precipChancePercent) &&
        day.precipChancePercent > 0
      ) {
        row.classList.add("has-precip");
        const precipChance = document.createElement("span");
        precipChance.className = "detailWeatherPrecip";
        precipChance.textContent = `${Math.round(day.precipChancePercent)}%`;
        iconWrap.append(precipChance);
      }

      const main = document.createElement("div");
      main.className = "detailWeatherMain";

      const dayLabel = document.createElement("p");
      dayLabel.className = "detailWeatherDay";
      const dayLabelText = document.createElement("span");
      dayLabelText.className = "detailWeatherDayText";
      dayLabelText.textContent = day.dayLabel;
      dayLabel.append(dayLabelText);

      if (day.dateLabel) {
        const dayDateDivider = document.createElement("span");
        dayDateDivider.className = "detailWeatherDayDivider";
        dayDateDivider.textContent = "\u00B7";

        const dayDateLabel = document.createElement("span");
        dayDateLabel.className = "detailWeatherDate";
        dayDateLabel.textContent = day.dateLabel;

        dayLabel.append(dayDateDivider, dayDateLabel);
      }
      main.append(dayLabel);

      const temps = document.createElement("p");
      temps.className = "detailWeatherTemps";
      const tempHigh = document.createElement("span");
      tempHigh.className = "detailWeatherTempHigh";
      tempHigh.textContent = day.tempHigh;

      const tempDivider = document.createElement("span");
      tempDivider.className = "detailWeatherTempDivider";
      tempDivider.textContent = " / ";

      const tempLow = document.createElement("span");
      tempLow.className = "detailWeatherTempLow";
      tempLow.textContent = day.tempLow;

      temps.append(tempHigh, tempDivider, tempLow);
      row.append(iconWrap, main, temps);

      if (isExpandableRow) {
        const toggleButton = document.createElement("button");
        toggleButton.className = "detailWeatherToggle";
        toggleButton.type = "button";
        toggleButton.setAttribute("aria-controls", "detailWeatherRows");
        toggleButton.innerHTML = `
          <span class="detailWeatherToggleIcon" aria-hidden="true">
            ${getLucideIconMarkup("chevron-down")}
          </span>
        `;
        toggleButton.addEventListener("click", () => {
          isDetailWeatherExpanded = !isDetailWeatherExpanded;
          syncDetailWeatherToggle($detailWeatherRows.childElementCount);
        });
        row.append(toggleButton);
      }

      $detailWeatherRows.appendChild(row);
    }
    syncDetailWeatherToggle(weather.days.length);
    refreshLucideIcons();
  } catch (error) {
    // Same stale-guard for error responses from in-flight requests.
    if (renderVersion !== detailRenderVersion) return;

    $detailWeatherRows.innerHTML = "";
    syncDetailWeatherToggle(0);
    if (error?.code === "missing_token") {
      renderWeatherStatus(
        "Weather unavailable. Set WEATHER_API_URL (recommended) or WEATHERKIT_TOKEN in config.js.",
      );
      return;
    }

    if (error?.status === 401 || error?.status === 403) {
      if (error?.source === "proxy") {
        renderWeatherStatus(
          "Weather unavailable. Weather proxy is not authorized with WeatherKit.",
        );
      } else {
        renderWeatherStatus(
          "Weather unavailable. WeatherKit token is not authorized for this origin.",
        );
      }
      return;
    }

    if (error?.status === 429) {
      renderWeatherStatus("Weather unavailable right now due to rate limits.");
      return;
    }

    renderWeatherStatus("Weather unavailable right now.");
  }
}

function getResourceIconSvg(type) {
  if (type === "camp") {
    return getLucideIconMarkup("tent");
  }
  if (type === "tickets") {
    return getLucideIconMarkup("ticket");
  }
  if (type === "lostFound") {
    return getLucideIconMarkup("shield-question-mark");
  }
  return getLucideIconMarkup("map");
}

function checkImageAssetExists(url) {
  if (!url) return Promise.resolve(false);
  if (resourceAssetExistsCache.has(url))
    return resourceAssetExistsCache.get(url);

  const probe = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

  resourceAssetExistsCache.set(url, probe);
  return probe;
}

async function renderDetailResources(f, renderVersion) {
  const resourceEntries = getResourceEntries(f);
  if (resourceEntries.length === 0) {
    $detailResources.innerHTML = "";
    $detailResourcesCard.hidden = true;
    return;
  }

  const exists = await Promise.all(
    resourceEntries.map((item) =>
      item.probeImage
        ? checkImageAssetExists(item.href)
        : Promise.resolve(true),
    ),
  );
  // Ignore async results if detail panel has moved on to another festival.
  if (renderVersion !== detailRenderVersion) return;

  $detailResources.innerHTML = "";

  for (let i = 0; i < resourceEntries.length; i++) {
    if (!exists[i]) continue;
    const resource = resourceEntries[i];
    const link = document.createElement("a");
    link.className = "detailResourceBtn";
    link.href = resource.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", resource.label);
    link.innerHTML = `
      <span class="detailResourceIcon">${getResourceIconSvg(resource.type)}</span>
      <span class="detailResourceLabel">${resource.label}</span>
      <span class="detailResourceChevron" aria-hidden="true">${getLucideIconMarkup("chevron-right")}</span>
    `;
    $detailResources.appendChild(link);
  }

  $detailResourcesCard.hidden = $detailResources.childElementCount === 0;
  refreshLucideIcons();
}

/** @param {Festival|null} f */
function updateDetailPanel(f) {
  // Every render attempt gets a new version to guard async weather/resource updates.
  const renderVersion = ++detailRenderVersion;
  if (!f) {
    $detailWeatherRows.innerHTML = "";
    $detailWeatherStatus.textContent = "";
    $detailWeatherStatus.hidden = true;
    resetDetailWeatherToggle();
    $detailWeatherCard.hidden = true;
    clearDetailApplePanels();
    $detailResources.innerHTML = "";
    $detailResourcesCard.hidden = true;
    $detailMetaStatusValue.textContent = "";
    $detailMetaStatusValue.classList.remove("is-active", "is-discontinued");
    $detailMetaEstablishedValue.textContent = "";
    $detailMetaAttendanceValue.textContent = "";
    $detailLastUpdated.textContent = "";
    $detailLastUpdated.hidden = true;
    for (const item of $detailMetaItems) {
      item.hidden = true;
      item.classList.remove("has-visible-predecessor");
    }
    $detailHeaderTitle.textContent = "";
    setDetailHeaderTitleProgress(0);
    $detailMetaRow.hidden = true;
    $detailSidebar.hidden = true;
    syncMobileDetailSheetState(false);
    return;
  }

  setImageWithFallback($detailHeroLogo, f.logoAssetUrl);
  setImageWithFallback($detailHeaderLogo, f.logoAssetUrl);
  const detailTitleText = f.name ?? "Untitled";
  $detailTitle.textContent = detailTitleText;
  $detailHeaderTitle.textContent = detailTitleText;

  const establishedYear = getEstablishedYear(f.established);
  const statusText = String(f.status ?? "").trim();
  $detailMetaStatusValue.classList.remove("is-active", "is-discontinued");

  if (statusText) {
    $detailMetaStatusValue.textContent = statusText;
    $detailMetaStatusItem.hidden = false;
    const normalizedStatus = statusText.toLowerCase();
    if (normalizedStatus === "active") {
      $detailMetaStatusValue.classList.add("is-active");
    } else if (normalizedStatus === "discontinued") {
      $detailMetaStatusValue.classList.add("is-discontinued");
    }
  } else {
    $detailMetaStatusValue.textContent = "";
    $detailMetaStatusItem.hidden = true;
  }

  if (establishedYear) {
    $detailMetaEstablishedValue.textContent = String(establishedYear);
    $detailMetaEstablishedItem.hidden = false;
  } else {
    $detailMetaEstablishedValue.textContent = "";
    $detailMetaEstablishedItem.hidden = true;
  }

  const attendance = formatAttendance(f.attendance);
  if (attendance) {
    $detailMetaAttendanceValue.textContent = attendance;
    $detailMetaAttendanceItem.hidden = false;
  } else {
    $detailMetaAttendanceValue.textContent = "";
    $detailMetaAttendanceItem.hidden = true;
  }

  for (const item of $detailMetaItems) {
    const valueEl = item.querySelector(".detailMetaValue");
    if (!valueEl) continue;
    item.hidden = !String(valueEl.textContent ?? "").trim();
    item.classList.remove("has-visible-predecessor");
  }

  let hasVisibleMetaItem = false;
  for (const item of $detailMetaItems) {
    if (item.hidden) continue;
    if (hasVisibleMetaItem) {
      item.classList.add("has-visible-predecessor");
    }
    hasVisibleMetaItem = true;
  }
  $detailMetaRow.hidden = $detailMetaItems.every((item) => item.hidden);

  const dateRange = formatDateRange(f);
  $detailDateValue.textContent = dateRange;
  $detailTimeValue.textContent = formatTimeRange(f);

  $detailWeatherRows.innerHTML = "";
  $detailWeatherStatus.textContent = "";
  $detailWeatherStatus.hidden = true;
  resetDetailWeatherToggle();
  $detailWeatherCard.hidden = true;
  clearDetailApplePanels();

  const cityState = [f.city, f.state].filter(Boolean).join(", ");
  const line2 = [cityState, f.zip].filter(Boolean).join(" ").trim();
  $detailAddressLine1.textContent = f.address || "Address unavailable";
  $detailAddressLine2.textContent = line2 || "Location unavailable";
  $detailAddressLine3.textContent = "United States";

  const aboutText = f.description?.trim() || "";
  if (aboutText) {
    $detailDesc.textContent = aboutText;
    $detailDescriptionCard.hidden = false;
  } else {
    $detailDesc.textContent = "";
    $detailDescriptionCard.hidden = true;
  }

  const lastUpdatedText = formatLastUpdated(f.modified);
  if (lastUpdatedText) {
    $detailLastUpdated.textContent = lastUpdatedText;
    $detailLastUpdated.hidden = false;
  } else {
    $detailLastUpdated.textContent = "";
    $detailLastUpdated.hidden = true;
  }

  const telValue = String(f.phone ?? "").replace(/[^\d+]/g, "");
  const callHref = telValue ? `tel:${telValue}` : null;
  const directionsHref = buildDirectionsHref(f);
  const websiteHref = f.website || null;

  setDetailActionLink($detailActionCall, callHref, false);
  setDetailActionLink($detailActionDirections, directionsHref, true);
  setDetailActionLink($detailAddressOpenBtn, directionsHref, true);
  setDetailActionLink($detailActionWebsite, websiteHref, true);

  const socials = getSocialEntries(f);
  $detailSocials.innerHTML = "";
  if (socials.length > 0) {
    for (const social of socials) {
      const a = document.createElement("a");
      a.className = "detailSocialBtn";
      a.href = social.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", social.label);
      a.title = social.label;
      a.innerHTML = `
        <span class="detailSocialIcon" aria-hidden="true">${getSocialIconSvg(social.platform)}</span>
      `;
      $detailSocials.appendChild(a);
    }
    $detailSocialCard.hidden = false;
    refreshLucideIcons();
  } else {
    $detailSocialCard.hidden = true;
  }

  $detailResources.innerHTML = "";
  $detailResourcesCard.hidden = true;
  renderDetailWeather(f, renderVersion);
  renderDetailAppleMaps(f, renderVersion);
  renderDetailResources(f, renderVersion);
  $detailSidebar.hidden = false;
  syncMobileDetailSheetState(true);
  queueDetailHeaderTitleSync();
}

// ---------- Map ----------
function makeMarker(f) {
  const coord = new mapkit.Coordinate(f.lat, f.lng);
  const statusText = String(f?.status ?? "")
    .trim()
    .toLowerCase();
  const isActiveFestival = statusText === "active";
  const crownGlyphImage = {
    1: "/assets/images/crown.png",
    2: "/assets/images/crown.png",
    3: "/assets/images/crown.png",
  };

  const marker = new mapkit.MarkerAnnotation(coord, {
    title: f.name,
    subtitle: f.subtitle,
    glyphImage: crownGlyphImage,
    selectedGlyphImage: crownGlyphImage,
    ...(isActiveFestival
      ? {
          color: "#34c759",
          selectedColor: "#34c759",
        }
      : {}),
  });

  // clustering
  marker.clusteringIdentifier = "festival";

  marker.data = f;
  return marker;
}

function applySystemColorScheme(map) {
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  const set = () => {
    const isDark = !!mql?.matches;

    // MapKit JS supports color schemes; this is the common API shape.
    // If Apple changes names, this will just no-op safely.
    try {
      const cs = mapkit?.Map?.ColorSchemes;
      if (cs) map.colorScheme = isDark ? cs.Dark : cs.Light;
    } catch (_) {}
  };

  set();
  if (mql?.addEventListener) mql.addEventListener("change", set);
  else if (mql?.addListener) mql.addListener(set);
}

// ---------- Main ----------
async function main() {
  refreshLucideIcons();
  await waitForMapKit();

  const map = new mapkit.Map("map", {
    showsCompass: getMapFeatureVisibility("Visible"),
    showsZoomControl: true,
    showsUserLocationControl: false,
  });

  const mapTypes = mapkit?.Map?.MapTypes ?? null;
  const mapTypeByStyle = {
    standard: mapTypes?.Standard ?? "standard",
    hybrid: mapTypes?.Hybrid ?? "hybrid",
    satellite: mapTypes?.Satellite ?? "satellite",
  };

  function getMapStyleForType(type) {
    if (type === mapTypeByStyle.hybrid || normalize(type) === "hybrid")
      return "hybrid";
    if (type === mapTypeByStyle.satellite || normalize(type) === "satellite")
      return "satellite";
    return "standard";
  }

  function syncMobileMapStyleButtonState() {
    if (!$mobileMapStyleBtn) return;
    const currentStyle = getMapStyleForType(map.mapType);
    const iconName = currentStyle === "hybrid" ? "layers-3" : "map";
    $mobileMapStyleBtn.classList.remove("is-active");
    $mobileMapStyleBtn.innerHTML = getLucideIconMarkup(iconName);
    refreshLucideIcons();
  }

  function getMobileLocationIconMarkup(isTracking) {
    if (isTracking) {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M3 11.5 21 3l-8.5 18-1.95-7.55z"></path>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M3 11.5 21 3l-8.5 18-1.95-7.55z"></path>
      </svg>
    `;
  }

  function syncMobileMapButtonState() {
    if (!$mobileUserLocationBtn) return;
    const tracking = !!map.tracksUserLocation;
    $mobileUserLocationBtn.innerHTML = getMobileLocationIconMarkup(tracking);
    $mobileUserLocationBtn.setAttribute(
      "aria-pressed",
      tracking ? "true" : "false",
    );
  }

  syncMapChromeForViewport = () => {
    const isAtFullHeight = mobileSheetState === "full" || mobileSheetOffset <= 1;
    const isMobileDetailOpen =
      isMobileViewport() &&
      document.body.classList.contains("mobile-detail-open");
    const hideMapControlsOnMobile =
      isMobileViewport() && (isAtFullHeight || isMobileDetailOpen);

    if ($mobileMapControls) {
      $mobileMapControls.hidden = hideMapControlsOnMobile;
    }

    try {
      map.showsMapTypeControl = false;
      map.showsUserLocationControl = false;
    } catch (_) {}

    // Controls can be re-added during internal relayout; enforce hidden state once more.
    setTimeout(() => {
      try {
        map.showsMapTypeControl = false;
        map.showsUserLocationControl = false;
      } catch (_) {}
    }, 120);

    syncMobileMapButtonState();
    syncMobileMapStyleButtonState();
  };

  if ($mobileMapStyleBtn) {
    $mobileMapStyleBtn.addEventListener("click", () => {
      const currentStyle = getMapStyleForType(map.mapType);
      map.mapType =
        currentStyle === "hybrid"
          ? mapTypeByStyle.standard
          : mapTypeByStyle.hybrid;
      syncMobileMapStyleButtonState();
    });
  }

  if ($mobileUserLocationBtn) {
    $mobileUserLocationBtn.addEventListener("click", () => {
      try {
        map.showsUserLocation = true;
        map.tracksUserLocation = !map.tracksUserLocation;
      } catch (_) {}
      syncMobileMapButtonState();
    });
  }

  syncMapChromeForViewport();

  applySystemColorScheme(map);

  const allFestivals = await loadFestivals();
  applyStoredUiSettings();

  // Create annotations + lookup
  const annotations = allFestivals.map(makeMarker);
  const byId = new Map();
  for (const a of annotations) {
    if (a?.data?.id != null) byId.set(String(a.data.id), a);
  }

  map.addAnnotations(annotations);
  map.showItems(annotations, {
    animate: false,
    padding: getMapPadding(60, 60, 60, 60),
  });

  let selectedAnnotation = null;
  let pendingMapSelectionTimer = null;

  function clearPendingMapSelection() {
    if (!pendingMapSelectionTimer) return;
    clearTimeout(pendingMapSelectionTimer);
    pendingMapSelectionTimer = null;
  }

  function clearFestivalSelection() {
    clearPendingMapSelection();
    selectedFestivalId = null;
    updateDetailPanel(null);
    rerender();

    if (selectedAnnotation) {
      try {
        map.deselectAnnotation(selectedAnnotation);
      } catch (_) {}
    }
    selectedAnnotation = null;
  }

  function selectFestival(f, options = {}) {
    if (!f) return;
    const { zoomToFestival = false, annotation = null } = options;
    const ann = annotation ?? byId.get(String(f.id)) ?? null;
    clearPendingMapSelection();

    selectedFestivalId = f.id;
    updateDetailPanel(f);
    rerender();

    if (!ann) return;

    if (selectedAnnotation && selectedAnnotation !== ann) {
      try {
        map.deselectAnnotation(selectedAnnotation);
      } catch (_) {}
    }

    selectedAnnotation = ann;
    if (zoomToFestival) {
      map.showItems([ann], {
        animate: true,
        padding: getMapPadding(90, 90, 90, 90),
      });
    }

    if (!annotation) {
      const applyMapSelection = () => {
        try {
          map.selectAnnotation(ann);
        } catch (_) {}
      };

      if (zoomToFestival) {
        // Delay selection slightly so camera animation finishes first.
        pendingMapSelectionTimer = setTimeout(() => {
          pendingMapSelectionTimer = null;
          applyMapSelection();
        }, 260);
      } else {
        applyMapSelection();
      }
    }
  }

  $detailCloseBtn.addEventListener("click", clearFestivalSelection);

  // Clicking a cluster zooms in to expand
  map.addEventListener("select", (event) => {
    const a = event.annotation;
    if (!a) return;

    if (Array.isArray(a.memberAnnotations) && a.memberAnnotations.length > 1) {
      map.showItems(a.memberAnnotations, {
        animate: true,
        padding: getMapPadding(60, 60, 60, 60),
      });
      map.deselectAnnotation(a);
      return;
    }

    const festivalId = a?.data?.id;
    if (festivalId == null || !byId.has(String(festivalId))) {
      // Ignore non-festival annotations (for example user location).
      return;
    }

    selectFestival(a.data, { annotation: a });
  });

  function focusFestival(f) {
    selectFestival(f, { zoomToFestival: true });
  }

  function getFilteredAndSorted() {
    const q = normalize($search.value).trim();
    const groupMode = $group.value;
    const sortMode = $sort.value;

    const filtered = !q
      ? allFestivals
      : allFestivals.filter((f) => {
          const hay =
            `${f.name ?? ""} ${f.city ?? ""} ${f.state ?? ""} ${f.stateName ?? ""} ${f.status ?? ""}`.toLowerCase();
          return hay.includes(q);
        });

    const sorted = sortFestivals(filtered, sortMode);

    return { items: sorted, groupMode };
  }

  function rerender() {
    const { items, groupMode } = getFilteredAndSorted();
    renderListGrouped(items, groupMode, focusFestival);
  }

  // Initial render
  rerender();
  syncOptionsMenuState();
  updateSearchClearVisibility();
  updateDetailPanel(null);
  syncMobileModeClasses();

  // Controls
  $search.addEventListener("input", () => {
    updateSearchClearVisibility();
    rerender();
  });
  $group.addEventListener("change", () => {
    writeStoredSetting(SETTINGS_STORAGE_KEYS.group, $group.value);
    syncOptionsMenuState();
    closeOptionsMenu();
    rerender();
  });
  $sort.addEventListener("change", () => {
    writeStoredSetting(SETTINGS_STORAGE_KEYS.sort, $sort.value);
    syncOptionsMenuState();
    closeOptionsMenu();
    rerender();
  });
  $daysUntilToggleRow.addEventListener("click", () => {
    showUpcomingDaysInList = !showUpcomingDaysInList;
    writeStoredSetting(
      SETTINGS_STORAGE_KEYS.showUpcomingDaysInList,
      showUpcomingDaysInList,
    );
    syncOptionsMenuState();
    closeOptionsMenu();
    rerender();
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:16px;white-space:pre-wrap">Error:\n${err?.message || err}</pre>`;
});
