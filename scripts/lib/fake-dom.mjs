// DOM mínimo para ejecutar los scripts de la interfaz dentro de node:vm.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function fakeBrowser({ search = '', fetch }) {
  const elements = new Map();
  const classes = new Set();
  const element = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        innerHTML: '',
        textContent: '',
        hidden: false,
        style: {},
        dataset: {},
        listeners: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
        querySelector: () => ({ disabled: false }),
      });
    }
    return elements.get(selector);
  };
  const location = { pathname: '/', search, href: '/' };
  const context = vm.createContext({
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {},
      body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle() {} } },
    },
    window: { addEventListener() {} },
    location,
    history: {
      replaceState(_state, _title, url) {
        const [path, query = ''] = url.split('?');
        location.pathname = path;
        location.search = query ? '?' + query : '';
      },
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
    fetch,
  });
  context.globalThis = context;
  const load = (...files) => {
    for (const file of files) vm.runInContext(readFileSync(new URL('../../src/public/' + file, import.meta.url), 'utf8'), context);
  };
  return { context, elements, element, classes, location, load };
}
