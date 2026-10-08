/* Preferencia visual local: el tema claro es el predeterminado y el botón permite fijarla. */
(() => {
  const KEY = 'enlace:theme';
  const read = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'dark' || value === 'light' ? value : '';
    } catch {
      return '';
    }
  };
  const apply = (mode) => {
    document.documentElement.dataset.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = mode === 'dark' ? '#091827' : '#111a2e';
    updateControls();
  };
  const moon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const sun = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function updateControls() {
    const dark = document.documentElement.dataset.colorScheme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const label = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
      button.innerHTML = dark ? sun : moon;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(dark));
    });
  }
  function set(mode, remember = true) {
    if (remember) {
      try { localStorage.setItem(KEY, mode); } catch {}
    }
    apply(mode);
  }
  const initial = read() || 'light';
  apply(initial);
  window.enlaceTheme = { get: () => document.documentElement.dataset.colorScheme, set };
  document.addEventListener('DOMContentLoaded', () => {
    updateControls();
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => set(document.documentElement.dataset.colorScheme === 'dark' ? 'light' : 'dark'));
    });
  }, { once: true });
})();
