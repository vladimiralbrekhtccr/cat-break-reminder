const intervalEl = document.getElementById("intervalMin");
const breakEl = document.getElementById("breakSec");
const siteListEl = document.getElementById("siteList");
const siteListWrap = document.getElementById("siteListWrap");
const savedEl = document.getElementById("saved");
const countdownEl = document.getElementById("countdown");
const countdownLabel = document.querySelector(".countdown-label");

const ALARM_NAME = "cat-break";
const DEFAULTS = {
  intervalMin: 25,
  breakSec: 30,
  siteMode: "all",
  siteList: [],
};

function getModeRadios() { return document.querySelectorAll('input[name="siteMode"]'); }
function getSelectedMode() {
  for (const r of getModeRadios()) if (r.checked) return r.value;
  return "all";
}
function setSelectedMode(mode) {
  for (const r of getModeRadios()) r.checked = r.value === mode;
  refreshListEnabled();
}
function refreshListEnabled() {
  siteListWrap.classList.toggle("disabled", getSelectedMode() !== "list");
}

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  intervalEl.value = s.intervalMin;
  breakEl.value = s.breakSec;
  setSelectedMode(s.siteMode);
  siteListEl.value = (s.siteList || []).join("\n");
}

function flash(msg, color = "#2a8f3a") {
  savedEl.textContent = msg;
  savedEl.style.color = color;
}

function parseSiteList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .map((l) => l.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
}

function formatCountdown(ms) {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

let rafHandle = null;

async function startCountdownLoop() {
  if (rafHandle) cancelAnimationFrame(rafHandle);

  const [alarm, pendingResp] = await Promise.all([
    chrome.alarms.get(ALARM_NAME),
    chrome.runtime.sendMessage({ type: "GET_PENDING" }).catch(() => ({ pending: null })),
  ]);
  const pending = pendingResp?.pending;

  if (pending) {
    countdownLabel.textContent = "Break pending";
    countdownEl.textContent = "now";
    return;
  }
  if (!alarm) {
    countdownLabel.textContent = "Next break in";
    countdownEl.textContent = "--:--";
    return;
  }

  countdownLabel.textContent = "Next break in";

  let lastText = "";
  const tick = () => {
    const remaining = alarm.scheduledTime - Date.now();
    const text = formatCountdown(remaining);
    if (text !== lastText) {
      countdownEl.textContent = text;
      lastText = text;
    }
    if (remaining <= 0) {
      // Alarm just fired — refresh in a moment to read the rescheduled time.
      setTimeout(startCountdownLoop, 750);
      return;
    }
    rafHandle = requestAnimationFrame(tick);
  };
  tick();
}

document.getElementById("save").addEventListener("click", async () => {
  const intervalMin = Math.max(1, parseInt(intervalEl.value, 10) || 25);
  const breakSec = Math.max(5, parseInt(breakEl.value, 10) || 30);
  const siteMode = getSelectedMode();
  const siteList = parseSiteList(siteListEl.value);

  await chrome.storage.sync.set({ intervalMin, breakSec, siteMode, siteList });
  await chrome.runtime.sendMessage({ type: "RESCHEDULE" });
  flash("Saved.");
  setTimeout(() => (savedEl.textContent = ""), 1500);
  startCountdownLoop();
});

document.getElementById("test").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "TEST_CAT" });
  if (result?.ok) {
    flash("Cat sent — switch to the tab.");
    setTimeout(() => window.close(), 600);
  } else if (result?.reason === "unsupported_url") {
    flash("Open a normal http(s) page and try again.", "#b13a3a");
  } else if (result?.reason === "inject_failed") {
    flash("Couldn't inject — try reloading the tab.", "#b13a3a");
  } else {
    flash("Failed: " + (result?.reason || "unknown"), "#b13a3a");
  }
});

for (const r of getModeRadios()) r.addEventListener("change", refreshListEnabled);

window.addEventListener("unload", () => {
  if (rafHandle) cancelAnimationFrame(rafHandle);
});

load();
startCountdownLoop();
