// keepalive.js — drop this script tag into index.html, nothing else to change
// <script src="keepalive.js"></script>  ← add this right before </body>
//
// What it does:
//   1. Pings your backend every 14 minutes so Render never hits 15-min sleep
//   2. On first load, detects a cold server and shows a friendly "waking up" banner
//   3. Completely isolated — touches nothing in app.js or styles.css

(function () {

  // ── Config ──────────────────────────────────────────────
  // Same logic as app.js: local dev → localhost, deployed → your real URL
  const PING_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  )
    ? 'http://localhost:8080/api/ping'
    : 'https://YOUR_BACKEND_URL.onrender.com/api/ping';

  const PING_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes — just under Render's 15-min limit
  const COLD_START_THRESHOLD_MS = 5000;     // if ping takes >5s, server was sleeping

  // ── Banner ───────────────────────────────────────────────
  // Injected into the DOM if a cold start is detected.
  // Styled entirely inline so it needs no CSS file changes.
  function showBanner(message, type) {
    removeBanner(); // never stack two banners

    const colours = {
      loading: { bg: '#fdf6e3', border: '#c9a84c', text: '#7a5c1e' },
      success: { bg: '#edf5ec', border: '#4a8c57', text: '#2d5e38' },
      error:   { bg: '#fdecea', border: '#d44f3f', text: '#7a2020' },
    };
    const c = colours[type] || colours.loading;

    const banner = document.createElement('div');
    banner.id = 'keepalive-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 99999;
      background: ${c.bg};
      border-bottom: 2px solid ${c.border};
      color: ${c.text};
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 500;
      text-align: center;
      padding: 10px 16px;
      letter-spacing: 0.02em;
      transition: opacity 0.4s ease;
    `;
    banner.textContent = message;
    document.body.prepend(banner);
  }

  function removeBanner() {
    const existing = document.getElementById('keepalive-banner');
    if (!existing) return;
    existing.style.opacity = '0';
    setTimeout(() => existing.remove(), 400);
  }

  // ── Ping function ────────────────────────────────────────
  // Sends a lightweight GET to /api/ping.
  // Measures response time to detect cold starts.
  // On first call: shows a banner if the server was sleeping.
  // On subsequent calls (keep-alive): silent — no UI change.
  async function ping(isFirstCall) {
    const start = Date.now();

    try {
      const res = await fetch(PING_URL, {
        method: 'GET',
        // no credentials, no JSON — keep it as lightweight as possible
      });

      const elapsed = Date.now() - start;

      if (!res.ok) {
        // Server responded but with an error — not a sleep issue, a real problem
        if (isFirstCall) {
          showBanner('⚠️ Server returned an error. Please refresh.', 'error');
        }
        return;
      }

      if (isFirstCall && elapsed > COLD_START_THRESHOLD_MS) {
        // Server was sleeping — it just woke up. Show a quick success message.
        showBanner('✅ Server is ready!', 'success');
        setTimeout(removeBanner, 2500);
      }
      // If the first ping was fast, server was already warm — show nothing.
      // If this is a keep-alive ping (not first), show nothing regardless.

    } catch (err) {
      // fetch() itself failed — network error or server completely unreachable
      if (isFirstCall) {
        showBanner('🌐 Could not reach the server. Check your connection.', 'error');
      }
    }
  }

  // ── Startup ──────────────────────────────────────────────
  // On the very first load, check immediately.
  // If the server responds slowly (cold start), show the "Waking up" banner
  // BEFORE the user tries to log in and gets a confusing spinner.

  async function initialCheck() {
    // Optimistic: show the banner straight away if we MIGHT have a cold start.
    // We don't know yet — we find out once the ping returns.
    // Strategy: show "waking up" immediately, then replace it with success/remove it.
    // This way the user always has feedback within milliseconds.

    const quickCheck = fetch(PING_URL, { method: 'GET' });

    // Give the server 1.5 seconds — if it hasn't responded by then, it was sleeping
    const slowTimeout = setTimeout(() => {
      showBanner('⏳ Waking up the server… (first load may take 30–60s)', 'loading');
    }, 1500);

    try {
      const res = await quickCheck;
      clearTimeout(slowTimeout);

      if (res.ok) {
        // Server responded — check if banner was already shown (it was slow)
        const banner = document.getElementById('keepalive-banner');
        if (banner) {
          // Was slow — replace loading banner with success
          showBanner('✅ Server is ready!', 'success');
          setTimeout(removeBanner, 2500);
        }
        // Was fast — banner was never shown, do nothing
      } else {
        clearTimeout(slowTimeout);
        showBanner('⚠️ Server returned an error. Please refresh.', 'error');
      }
    } catch (err) {
      clearTimeout(slowTimeout);
      showBanner('🌐 Could not reach the server. Check your connection.', 'error');
    }
  }

  // ── Keep-alive loop ──────────────────────────────────────
  // After the initial check, ping every 14 minutes silently.
  // This keeps the Render instance active as long as the tab is open.
  function startKeepAlive() {
    setInterval(() => ping(false), PING_INTERVAL_MS);
  }

  // ── Init ─────────────────────────────────────────────────
  // Wait for the DOM to exist before touching it
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initialCheck();
      startKeepAlive();
    });
  } else {
    // DOM already ready (script loaded with defer or at bottom of body)
    initialCheck();
    startKeepAlive();
  }

})(); // IIFE — everything inside is scoped, nothing leaks to global