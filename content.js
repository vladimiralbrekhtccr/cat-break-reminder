// Content script: injects the cat-video overlay and runs the break countdown.

(() => {
  if (window.__catBreakInjected) return;
  window.__catBreakInjected = true;
  console.log("[cbr] content.js loaded — build forward-loop-2026-04-28");

  const WALK_URL  = chrome.runtime.getURL("assets/neko1.webm");   // 11s walk-in + sit
  const SLEEP_URL = chrome.runtime.getURL("assets/neko2.webm");   // sleeping cat

  // Loop window inside neko1.webm. Cat is in the relaxed sit pose between
  // these two timestamps, so the seam pop is small. We never swap `src` for
  // looping — only for the sleep transition — so the cat stays on screen
  // without reload artefacts.
  const LOOP_START = 8.5;
  const LOOP_END   = 10.85;

  const TITLE_TEXT = "Cat Rest Time";
  const LOG = (...a) => console.log("[cbr]", ...a);

  let activeOverlay = null;
  let activeDismiss = null;

  function showCat(breakSec) {
    if (activeOverlay) return;

    const overlay = document.createElement("div");
    overlay.id = "cbr-overlay";
    overlay.innerHTML = `
      <div class="cbr-cat-stack">
        <video class="cbr-cat" src="${WALK_URL}" autoplay muted playsinline preload="auto"></video>
      </div>
      <div class="cbr-card">
        <div class="cbr-title">${TITLE_TEXT}</div>
        <div class="cbr-timer">0:00</div>
      </div>
      <button class="cbr-close" type="button" aria-label="Dismiss break">×</button>
    `;
    document.documentElement.appendChild(overlay);
    activeOverlay = overlay;

    const stackEl = overlay.querySelector(".cbr-cat-stack");
    const video   = overlay.querySelector(".cbr-cat");
    const timerEl = overlay.querySelector(".cbr-timer");
    const closeEl = overlay.querySelector(".cbr-close");

    requestAnimationFrame(() => overlay.classList.add("cbr-visible"));

    const startSlide = () => overlay.isConnected && overlay.classList.add("cbr-ready");
    if (video.readyState >= 2) startSlide();
    else {
      video.addEventListener("loadeddata", startSlide, { once: true });
      setTimeout(startSlide, 1000);
    }

    // Surface video errors so we can see what's happening if anything fails.
    video.addEventListener("error", () => {
      const err = video.error;
      LOG("video error", err && { code: err.code, message: err.message }, "src=", video.currentSrc);
    });

    let switchedToSleep = false;

    // Forward-only loop: when playback approaches LOOP_END, seek back to
    // LOOP_START. rAF gives frame-tight timing so we never overshoot into
    // the natural ended state. The video element is never reloaded — same
    // src throughout, alpha preserved, no flashes.
    function loopMonitor() {
      if (!overlay.isConnected || switchedToSleep) return;
      if (video.currentTime >= LOOP_END) {
        try { video.currentTime = LOOP_START; } catch (_) {}
      }
      requestAnimationFrame(loopMonitor);
    }
    requestAnimationFrame(loopMonitor);

    // Safety: if `ended` ever fires (rAF missed the boundary, tab was hidden),
    // seek back into the loop window and resume.
    video.addEventListener("ended", () => {
      if (switchedToSleep) return;
      try { video.currentTime = LOOP_START; } catch (_) {}
      video.play().catch(() => {});
    });

    // ---- Sleep transition ------------------------------------------------
    function switchToSleep() {
      switchedToSleep = true;
      LOG("switch → sleep");
      video.pause();
      video.src = SLEEP_URL;
      video.loop = true;
      video.classList.add("cbr-sleeping");
      video.play().catch((e) => LOG("sleep play() rejected:", e?.name || e));
    }

    // ---- Drag ------------------------------------------------------------
    let dragX = 0, dragY = 0;
    let isDragging = false;
    let startPx = 0, startPy = 0, baseX = 0, baseY = 0;

    function applyTransform() {
      stackEl.style.transform = `translate3d(${dragX}px, ${dragY}px, 0)`;
    }
    function enableDrag() {
      stackEl.style.animation = "none";
      applyTransform();
      stackEl.classList.add("cbr-draggable");
      stackEl.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        isDragging = true;
        startPx = e.clientX; startPy = e.clientY;
        baseX = dragX; baseY = dragY;
        stackEl.classList.add("cbr-dragging");
        try { stackEl.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
      });
      stackEl.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        dragX = baseX + (e.clientX - startPx);
        dragY = baseY + (e.clientY - startPy);
        applyTransform();
      });
      const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        stackEl.classList.remove("cbr-dragging");
        try { stackEl.releasePointerCapture(e.pointerId); } catch {}
      };
      stackEl.addEventListener("pointerup", stopDrag);
      stackEl.addEventListener("pointercancel", stopDrag);
    }
    stackEl.addEventListener("animationend", enableDrag, { once: true });
    setTimeout(() => {
      if (!stackEl.classList.contains("cbr-draggable")) enableDrag();
    }, 3500);

    // ---- Countdown -------------------------------------------------------
    let remaining = Math.max(1, Math.floor(breakSec));
    timerEl.textContent = formatTime(remaining);
    const tick = setInterval(() => {
      remaining -= 1;
      timerEl.textContent = formatTime(remaining);
      if (!switchedToSleep && remaining <= Math.min(10, Math.floor(breakSec / 2))) {
        switchToSleep();
      }
      if (remaining <= 0) {
        clearInterval(tick);
        dismiss();
      }
    }, 1000);

    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      clearInterval(tick);
      overlay.classList.remove("cbr-visible");
      overlay.classList.add("cbr-fade-out");
      setTimeout(() => {
        overlay.remove();
        if (activeOverlay === overlay) activeOverlay = null;
        if (activeDismiss === dismiss) activeDismiss = null;
      }, 600);
    }
    activeDismiss = dismiss;

    closeEl.addEventListener("click", () => {
      dismiss();
      chrome.runtime.sendMessage({ type: "DISMISS_BROADCAST" }).catch(() => {});
    });
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PING") { sendResponse({ ok: true }); return; }
    if (msg?.type === "SHOW_CAT") {
      showCat(msg.breakSec ?? 30);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "DISMISS_CAT") {
      if (activeDismiss) activeDismiss();
      sendResponse({ ok: true });
      return;
    }
  });
})();
