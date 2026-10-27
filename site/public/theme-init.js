// Runs before first paint so a chosen theme never flashes. No choice: follow the system.
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
