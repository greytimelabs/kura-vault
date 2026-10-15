// After a deploy, a page loaded earlier still names the old hashed bundle. The
// host answers that missing file with index.html, the module fails to load and
// the page stays blank. Reload once to fetch the current page; the flag stops a
// loop if the bundle is broken for some other reason.
// A separate file because the content security policy forbids inline scripts.
(function () {
  window.addEventListener(
    'error',
    function (event) {
      var el = event.target;
      if (!el || el.tagName !== 'SCRIPT' || el.type !== 'module') return;
      try {
        if (sessionStorage.getItem('kv_stale_reload') === el.src) return;
        sessionStorage.setItem('kv_stale_reload', el.src);
      } catch (e) {
        return;
      }
      location.reload();
    },
    true,
  );
})();
