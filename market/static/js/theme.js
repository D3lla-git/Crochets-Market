/* =====================================================================
   Crochets Market — light / dark mode.
   Loaded in <head> WITHOUT defer so the right theme is applied before the
   page paints (no white flash in dark mode). Follows the device setting
   until the visitor taps the toggle; their choice is then remembered.
   Any element with data-action="theme" toggles the theme.
   ===================================================================== */
(function () {
  "use strict";
  var KEY = "cm:theme";
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch (e) { return null; }
  }
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#071208" : "#0D2413");
    var buttons = document.querySelectorAll('[data-action="theme"]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(theme === "dark"));
      buttons[i].setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      buttons[i].title = theme === "dark" ? "Light mode" : "Dark mode";
    }
  }
  var current = saved() || (media && media.matches ? "dark" : "light");
  apply(current);

  if (media && media.addEventListener) {
    media.addEventListener("change", function (e) { if (!saved()) { current = e.matches ? "dark" : "light"; apply(current); } });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest('[data-action="theme"]');
    if (!btn) return;
    current = current === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, current); } catch (err) { /* private mode: still switch for this page */ }
    apply(current);
  });
  document.addEventListener("DOMContentLoaded", function () { apply(current); });

  window.MarketTheme = { get: function () { return current; } };
})();
