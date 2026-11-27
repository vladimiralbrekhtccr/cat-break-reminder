// Service worker: schedules the break alarm, shows the cat on matching tabs,
// and defers missed breaks to the next eligible tab.

const ALARM_NAME = "cat-break";
const PENDING_KEY = "pendingBreak";
const PENDING_TTL_MS = 60 * 60 * 1000; // 1h: a stale pending break is dropped

const DEFAULTS = {
  intervalMin: 25,
  breakSec: 30,
  siteMode: "all",   // "all" | "list"
  siteList: [],
};

async function getSettings() {
  return await chrome.storage.sync.get(DEFAULTS);
}

async function rescheduleAlarm() {
  const { intervalMin } = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: intervalMin,
    periodInMinutes: intervalMin,
  });
}

chrome.runtime.onInstalled.addListener(rescheduleAlarm);
chrome.runtime.onStartup.addListener(rescheduleAlarm);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.intervalMin) rescheduleAlarm();
});

// --- helpers ---------------------------------------------------------------

function isInjectableUrl(url) {
  return typeof url === "string" && /^(https?:|file:)/.test(url);
}

function hostnameMatches(hostname, entry) {
  const e = entry.trim().toLowerCase().replace(/^\*\./, "");
  if (!e) return false;
  return hostname === e || hostname.endsWith("." + e);
}

function tabMatchesSiteFilter(tab, settings) {
  if (settings.siteMode !== "list") return true;
  if (!settings.siteList?.length) return false;
  try {
    const host = new URL(tab.url).hostname.toLowerCase();
    return settings.siteList.some((entry) => hostnameMatches(host, entry));
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch (_) { /* not loaded */ }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch (e) {
    console.warn("[cat-break] inject failed", e);
    return false;
  }
}

async function showCatOnTab(tab, { ignoreFilter = false } = {}) {
  if (!tab?.id || !isInjectableUrl(tab.url)) {
    return { ok: false, reason: "unsupported_url", url: tab?.url };
  }
  const settings = await getSettings();
  if (!ignoreFilter && !tabMatchesSiteFilter(tab, settings)) {
    return { ok: false, reason: "site_not_in_list", url: tab.url };
  }
  const ready = await ensureContentScript(tab.id);
  if (!ready) return { ok: false, reason: "inject_failed" };
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SHOW_CAT", breakSec: settings.breakSec });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "send_failed", error: String(e) };
  }
}

// --- pending break (deferred when no eligible tab is active) --------------

async function setPendingBreak(scheduledTime) {
  await chrome.storage.local.set({ [PENDING_KEY]: { scheduledTime } });
}
async function getPendingBreak() {
  const r = await chrome.storage.local.get(PENDING_KEY);
  return r[PENDING_KEY] || null;
}
async function clearPendingBreak() {
  await chrome.storage.local.remove(PENDING_KEY);
}

async function consumePendingIfEligible(tab) {
  const pending = await getPendingBreak();
  if (!pending) return;
  if (Date.now() - pending.scheduledTime > PENDING_TTL_MS) {
    await clearPendingBreak();
    return;
  }
  const result = await showCatOnTab(tab);
  if (result.ok) await clearPendingBreak();
}

// --- alarm + tab events ----------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const tabs = await chrome.tabs.query({ active: true });
  let shown = false;
  for (const tab of tabs) {
    const r = await showCatOnTab(tab);
    if (r.ok) shown = true;
  }
  if (!shown) await setPendingBreak(Date.now());
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await consumePendingIfEligible(tab);
  } catch {}
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    await consumePendingIfEligible(tab);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) await consumePendingIfEligible(tab);
  } catch {}
});

// --- popup messages --------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TEST_CAT") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await showCatOnTab(tab, { ignoreFilter: true });
      sendResponse(result);
    })();
    return true;
  }
  if (msg?.type === "RESCHEDULE") {
    rescheduleAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "GET_PENDING") {
    getPendingBreak().then((p) => sendResponse({ pending: p }));
    return true;
  }
  if (msg?.type === "DISMISS_BROADCAST") {
    (async () => {
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.map(async (tab) => {
        if (!tab.id || !isInjectableUrl(tab.url)) return;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "DISMISS_CAT" });
        } catch (_) { /* tab has no content script — ignore */ }
      }));
      // User explicitly dismissed; drop any deferred break too.
      await clearPendingBreak();
      sendResponse({ ok: true });
    })();
    return true;
  }
});
