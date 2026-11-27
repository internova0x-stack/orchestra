/*
 * Website chat widget loader (lib/widget.ts). A bank pastes:
 *   <script src="https://<orchestra>/widget.js" data-key="wk_..." async></script>
 * Optional: data-customer-token="<token your server signed>" for a signed-in customer; data-country="Canada" (the
 * visitor's country if your site knows it: general answers follow that market until the customer is verified).
 * Page API: window.OrchestraChat.open(), .close(), .identify(token) (after the customer signs in).
 * The chat itself runs in a frame from Orchestra, which browsers show only on the widget's listed websites.
 */
(function () {
  "use strict";
  if (window.OrchestraChat && window.OrchestraChat.loaded) return;
  var script = document.currentScript || document.querySelector('script[src*="widget.js"][data-key]');
  if (!script) return;
  var key = script.getAttribute("data-key") || "";
  var base;
  try { base = new URL(script.src).origin; } catch (e) { return; }
  var token = script.getAttribute("data-customer-token") || null;
  var language = script.getAttribute("data-language") || "en";
  var country = script.getAttribute("data-country") || null;
  var open = false, frame = null, panel = null, button = null, ready = false, pendingOpen = false;

  function luminance(hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function build(cfg) {
    var host = document.createElement("div");
    host.setAttribute("data-orchestra-chat", "");
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var colour = /^#[0-9a-f]{6}$/i.test(cfg.colour) ? cfg.colour : "#4F3BF3";
    var on = 1.05 / (luminance(colour) + 0.05) >= 3 ? "#ffffff" : "#1e2c42";
    var style = document.createElement("style");
    style.textContent =
      ".btn{position:fixed;right:calc(20px + env(safe-area-inset-right,0px));bottom:calc(20px + env(safe-area-inset-bottom,0px));width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;" +
      "background:" + colour + ";color:" + on + ";box-shadow:0 6px 20px rgba(0,0,0,.25);display:grid;place-items:center;z-index:2147483646;transition:transform .15s}" +
      ".btn:hover{transform:scale(1.05)}.btn:focus-visible{outline:3px solid " + colour + ";outline-offset:3px}" +
      ".panel{position:fixed;right:calc(20px + env(safe-area-inset-right,0px));bottom:calc(92px + env(safe-area-inset-bottom,0px));width:380px;height:min(640px,calc(100vh - 120px));" +
      "border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28);background:#fff;z-index:2147483647;display:none}" +
      ".panel.open{display:block}.panel iframe{width:100%;height:100%;border:0;display:block}" +
      "@media (max-width:480px){.panel{right:0;bottom:0;width:100%;height:100%;border-radius:0}.panel.open~.btn{display:none}}" +
      "@media (prefers-reduced-motion:reduce){.btn{transition:none}}";
    root.appendChild(style);
    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", cfg.title || "Chat");
    root.appendChild(panel);
    button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.setAttribute("aria-label", "Open chat: " + (cfg.title || "Support"));
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = ICON_CHAT;
    button.addEventListener("click", function () { open ? close() : show(); });
    root.appendChild(button);
    if (pendingOpen) show();
  }

  function show() {
    if (!panel) { pendingOpen = true; return; }
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = base + "/w/" + encodeURIComponent(key);
      frame.title = "Chat";
      frame.setAttribute("allow", "clipboard-write");
      panel.appendChild(frame);
    }
    open = true;
    panel.classList.add("open");
    button.innerHTML = ICON_CLOSE;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Close chat");
    try { frame.focus(); } catch (e) {}
  }

  function close() {
    if (!panel) return;
    open = false;
    panel.classList.remove("open");
    button.innerHTML = ICON_CHAT;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open chat");
    button.focus();
  }

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ source: "orchestra-page" }, msg), base);
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== base || !frame || e.source !== frame.contentWindow) return;
    var d = e.data || {};
    if (d.source !== "orchestra-chat") return;
    if (d.type === "ready") { ready = true; post({ type: "init", token: token, language: language, country: country }); }
    if (d.type === "close") close();
  });

  window.OrchestraChat = {
    loaded: true,
    open: show,
    close: close,
    /** The customer has just signed in: start a new conversation as them (the token your server signed). */
    identify: function (t) { token = t || null; if (ready && token) post({ type: "identify", token: token, language: language, country: country }); },
  };

  function start() {
    fetch(base + "/api/w/" + encodeURIComponent(key))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) { if (cfg && cfg.live) build(cfg); })
      .catch(function () {});
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
