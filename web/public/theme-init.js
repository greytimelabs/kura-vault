// Applied before first paint so the page never flashes the wrong theme.
// A separate file because the content security policy forbids inline scripts.
(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('mv_theme') || 'system';
  } catch (e) {}
  var dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
