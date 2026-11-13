/* Solar Star day/night switch. Load in <head> WITHOUT defer so the saved choice applies before the page paints:
     <script src="/theme.js"></script>
   Any <button class="ss-theme-toggle"></button> on the page becomes the switch.
   With no saved choice the page follows the device setting. */
(function () {
  var KEY = 'ss-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function current() {
    var s = root.getAttribute('data-theme');
    if (s === 'light' || s === 'dark') return s;
    return media && media.matches ? 'dark' : 'light';
  }
  function label(btn) {
    var night = current() === 'dark';
    btn.innerHTML = '<span class="ss-icon" aria-hidden="true">' + (night ? '☀' : '☾') + '</span>' +
      (night ? 'Day mode' : 'Night mode');
    btn.setAttribute('aria-label', night ? 'Switch to day mode' : 'Switch to night mode');
  }
  function refresh() {
    var btns = document.querySelectorAll('.ss-theme-toggle');
    for (var i = 0; i < btns.length; i++) label(btns[i]);
    document.dispatchEvent(new CustomEvent('ss-themechange', { detail: current() }));
  }

  var s = saved();
  if (s === 'light' || s === 'dark') root.setAttribute('data-theme', s);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.ss-theme-toggle');
    if (!btn) return;
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (err) { /* private window: still switches for this visit */ }
    refresh();
  });
  if (media && media.addEventListener) media.addEventListener('change', function () { if (!saved()) refresh(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
})();
