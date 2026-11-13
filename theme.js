// Solar Star day/night mode. Follows the device until the visitor picks one; remembers the pick.
(function () {
  var KEY = "solarstar-theme";
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;

  function current() {
    if (root.dataset.theme) return root.dataset.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function label(btn) {
    var next = current() === "dark" ? "Day" : "Night";
    btn.textContent = (next === "Day" ? "☀ " : "☾ ") + next + " mode";
    btn.setAttribute("aria-label", "Switch to " + next.toLowerCase() + " mode");
  }
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.querySelector(".theme-toggle");
    if (!btn) return;
    label(btn);
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) {}
      label(btn);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { label(btn); });
  });
})();
