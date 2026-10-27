// The only behaviour on the site: the theme switch and the copy buttons.
(function () {
  var root = document.documentElement;
  var dark = function () {
    return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };

  document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
    var sync = function () {
      button.setAttribute('aria-pressed', String(dark()));
    };
    sync();
    button.addEventListener('click', function () {
      var next = dark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (e) {}
      sync();
    });
  });

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    var label = button.querySelector('[data-copy-label]');
    var initial = label ? label.textContent : '';
    button.addEventListener('click', function () {
      var source = document.getElementById(button.getAttribute('data-copy'));
      if (!source || !navigator.clipboard) return;
      navigator.clipboard.writeText(source.innerText.trim()).then(function () {
        if (!label) return;
        label.textContent = 'Copied';
        setTimeout(function () {
          label.textContent = initial;
        }, 1600);
      });
    });
  });
})();
