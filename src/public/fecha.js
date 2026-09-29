/* Selector de fecha y hora propio (12.22). Los campos nativos (<input type="datetime-local|date|time">) se ven
 * distinto en cada navegador (en inglés, con AM/PM o mm/dd/aaaa); aquí cada uno se acompaña de un botón en español
 * que abre un calendario con la hora. El campo original sigue en el formulario (oculto) y guarda el valor en su
 * formato de siempre, así que nada de lo que lee los formularios cambia. En el teléfono se abre como hoja inferior.
 */
const DT_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DT_DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DT_SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DT_QUICK_TIMES = ['07:00', '12:00', '18:00', '23:59'];
const pad2 = (n) => String(n).padStart(2, '0');
const dtIcon = (kind) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${
    kind === 'time' ? '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' : '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
  }</svg>`;
let dtOpen = null; // { input, view: Date (primer día del mes mostrado), pop }

/** Partes del valor del campo: { date: 'AAAA-MM-DD' | '', time: 'HH:MM' | '' }. */
function dtParts(input) {
  const v = input.value || '';
  if (input.type === 'time') return { date: '', time: v.slice(0, 5) };
  if (input.type === 'date') return { date: v.slice(0, 10), time: '' };
  const [date = '', time = ''] = v.split('T');
  return { date, time: time.slice(0, 5) };
}

/** Texto del botón (HTML): «29 sep 2026 · 10:00», «29 sep 2026» o «10:00». El año se oculta si el campo es angosto. */
function dtLabel(input) {
  const { date, time } = dtParts(input);
  if (input.type === 'time') return time ? esc(time) : '';
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const day = `${d} ${DT_SHORT_MONTHS[m - 1]}<span class="dt-year"> ${y}</span>`;
  return input.type === 'date' || !time ? day : `${day} · ${esc(time)}`;
}

/** Hora que se propone al elegir un día en un campo vacío: inicio del día para «desde», fin del día para lo demás. */
const dtDefaultTime = (input) => (/start|open|desde|publish|inicio/i.test(input.name || '') ? '07:00' : '23:59');

function dtSet(input, date, time) {
  const value = input.type === 'time' ? time : input.type === 'date' ? date : date ? `${date}T${time || dtDefaultTime(input)}` : '';
  dtNativeValue.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  dtRefresh(input);
}

const dtNativeValue = typeof HTMLInputElement === 'function' ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') : null;

function dtRefresh(input) {
  const box = input.closest('.dt-field');
  if (!box) return;
  const label = dtLabel(input);
  box.querySelector('.dt-text').innerHTML = label || (input.type === 'time' ? 'Elegir hora' : 'Elegir fecha');
  box.querySelector('.dt-display').title = box.querySelector('.dt-text').textContent;
  box.classList.toggle('is-empty', !label);
  box.querySelector('.dt-clear').hidden = !label || input.required;
}

/** Convierte un campo nativo en el selector (una sola vez). */
function dtEnhance(input) {
  if (input.dataset.dt || !dtNativeValue || !input.matches(DT_SELECTOR)) return;
  input.dataset.dt = '1';
  const box = document.createElement('span');
  box.className = `dt-field dt-kind-${input.type === 'datetime-local' ? 'datetime' : input.type}`;
  box.innerHTML = `<button type="button" class="dt-display" aria-haspopup="dialog">${dtIcon(input.type === 'time' ? 'time' : 'date')}<span class="dt-text"></span></button><button type="button" class="dt-clear" aria-label="Borrar" hidden>×</button>`;
  input.after(box);
  box.prepend(input);
  input.classList.add('dt-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  box.querySelector('.dt-display').setAttribute('aria-label', (input.closest('label')?.firstChild?.textContent || 'Fecha').trim());
  // Si el código cambia el valor (por ejemplo, al llenar un formulario), el botón se actualiza solo.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() {
      return dtNativeValue.get.call(this);
    },
    set(v) {
      dtNativeValue.set.call(this, v);
      dtRefresh(this);
    },
  });
  // La validación del navegador (campo obligatorio vacío) enfoca el campo oculto: se abre el selector.
  input.addEventListener('focus', () => dtShow(input));
  dtRefresh(input);
}

const DT_SELECTOR = 'input[type="datetime-local"], input[type="date"], input[type="time"]';
function dtEnhanceAll(root = document) {
  root.querySelectorAll?.(DT_SELECTOR).forEach(dtEnhance);
}

// ---- Ventana del calendario ---------------------------------------------------------------------------

function dtShow(input) {
  dtClose();
  const { date, time } = dtParts(input);
  const base = date ? new Date(`${date}T00:00`) : new Date();
  const pop = document.createElement('div');
  pop.className = 'dt-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', input.type === 'time' ? 'Elegir hora' : 'Elegir fecha');
  (input.closest('dialog') || document.body).append(pop);
  dtOpen = { input, view: new Date(base.getFullYear(), base.getMonth(), 1), pop, date, time };
  dtRender();
  dtPlace();
  (pop.querySelector('.dt-day.is-selected') || pop.querySelector('.dt-day.is-today') || pop.querySelector('button'))?.focus({ preventScroll: true });
}

function dtClose() {
  if (!dtOpen) return;
  const { pop, input } = dtOpen;
  dtOpen = null;
  pop.remove();
  input.closest('.dt-field')?.querySelector('.dt-display')?.focus({ preventScroll: true });
}

function dtPlace() {
  const { pop, input } = dtOpen;
  if (matchMedia('(max-width: 720px)').matches) {
    pop.classList.add('is-sheet');
    return;
  }
  // Abajo del campo; si no cabe, arriba; si tampoco, a un lado (sin tapar nunca el campo).
  const r = input.closest('.dt-field').getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const clampTop = (top) => Math.min(Math.max(8, top), innerHeight - h - 8);
  let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let top;
  if (r.bottom + 6 + h <= innerHeight - 8) top = r.bottom + 6;
  else if (r.top - 6 - h >= 8) top = r.top - h - 6;
  else {
    top = clampTop(r.top + r.height / 2 - h / 2);
    left = r.right + 8 + w <= innerWidth - 8 ? r.right + 8 : Math.max(8, r.left - w - 8);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function dtRender() {
  const { pop, input, view, date, time } = dtOpen;
  const hasDate = input.type !== 'time';
  const hasTime = input.type !== 'date';
  let calendar = '';
  if (hasDate) {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    const first = (view.getDay() + 6) % 7; // lunes = 0
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - first);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const cls = ['dt-day', d.getMonth() !== view.getMonth() ? 'is-other' : '', key === todayKey ? 'is-today' : '', key === date ? 'is-selected' : ''].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="${cls}" data-dt-day="${key}" aria-label="${d.getDate()} de ${DT_MONTHS[d.getMonth()]} de ${d.getFullYear()}"${key === date ? ' aria-pressed="true"' : ''}>${d.getDate()}</button>`);
    }
    calendar = `<div class="dt-head"><button type="button" class="dt-nav" data-dt-month="-1" aria-label="Mes anterior">‹</button>
        <strong>${DT_MONTHS[view.getMonth()][0].toUpperCase() + DT_MONTHS[view.getMonth()].slice(1)} ${view.getFullYear()}</strong>
        <button type="button" class="dt-nav" data-dt-month="1" aria-label="Mes siguiente">›</button></div>
      <div class="dt-week">${DT_DAYS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="dt-grid">${cells.join('')}</div>`;
  }
  let clock = '';
  if (hasTime) {
    const [h, m] = (time || (hasDate ? dtDefaultTime(input) : '')).split(':');
    const minutes = [...new Set([...Array(12).keys()].map((i) => pad2(i * 5)).concat(m && !['59'].includes(m) ? [m] : [], ['59']))].sort();
    clock = `<div class="dt-time"><span class="dt-time-label">Hora</span>
        <select data-dt-hour aria-label="Hora">${[...Array(24).keys()].map((i) => `<option value="${pad2(i)}" ${pad2(i) === h ? 'selected' : ''}>${pad2(i)}</option>`).join('')}</select>
        <span aria-hidden="true">:</span>
        <select data-dt-minute aria-label="Minutos">${minutes.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="dt-quick">${DT_QUICK_TIMES.map((t) => `<button type="button" data-dt-time="${t}" class="${t === time ? 'is-selected' : ''}">${t}</button>`).join('')}</div>`;
  }
  pop.innerHTML = `${pop.classList.contains('is-sheet') || matchMedia('(max-width: 720px)').matches ? `<div class="dt-sheet-title">${esc((input.closest('label')?.firstChild?.textContent || '').trim()) || 'Fecha'}</div>` : ''}
    ${calendar}${clock}
    <div class="dt-actions">${hasDate ? '<button type="button" class="text-btn" data-dt-today>Hoy</button>' : ''}${input.required ? '' : '<button type="button" class="text-btn dt-clear-link" data-dt-clear>Borrar</button>'}
      <button type="button" class="primary" data-dt-done>Listo</button></div>`;
}

/** Lo elegido en la ventana (día y hora) al campo. */
function dtApply({ close = false } = {}) {
  const { input, pop } = dtOpen;
  const hour = pop.querySelector('[data-dt-hour]')?.value;
  const minute = pop.querySelector('[data-dt-minute]')?.value;
  if (hour !== undefined && minute !== undefined && (dtOpen.date || input.type === 'time')) dtOpen.time = `${hour}:${minute}`;
  if (dtOpen.date || input.type === 'time') dtSet(input, dtOpen.date, dtOpen.time);
  if (close) dtClose();
}

if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
  new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(DT_SELECTOR)) dtEnhance(node);
        else dtEnhanceAll(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => dtEnhanceAll());

  document.addEventListener('click', (e) => {
    const display = e.target.closest('.dt-display');
    if (display) {
      const input = display.parentElement.querySelector('.dt-native');
      if (!input.disabled) dtOpen?.input === input ? dtClose() : dtShow(input);
      return;
    }
    const clear = e.target.closest('.dt-clear');
    if (clear) {
      dtSet(clear.parentElement.querySelector('.dt-native'), '', '');
      return;
    }
    if (!dtOpen) return;
    // El clic en la etiqueta del campo (o el que el navegador reenvía al campo oculto) no cierra lo que acaba de abrir.
    if (e.target.classList?.contains('dt-native') || e.target.closest('label')?.contains(dtOpen.input)) return;
    if (!e.target.closest('.dt-pop')) return dtClose();
    const t = e.target;
    if (t.closest('[data-dt-month]')) {
      dtOpen.view = new Date(dtOpen.view.getFullYear(), dtOpen.view.getMonth() + Number(t.closest('[data-dt-month]').dataset.dtMonth), 1);
      dtRender();
      return;
    }
    if (t.closest('[data-dt-day]')) {
      dtOpen.date = t.closest('[data-dt-day]').dataset.dtDay;
      if (dtOpen.input.type === 'date') return dtApply({ close: true });
      dtApply();
      dtRender();
      return;
    }
    if (t.closest('[data-dt-time]')) {
      dtOpen.time = t.closest('[data-dt-time]').dataset.dtTime;
      if (!dtOpen.date && dtOpen.input.type !== 'time') {
        const now = new Date();
        dtOpen.date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      }
      dtSet(dtOpen.input, dtOpen.date, dtOpen.time);
      dtRender();
      return;
    }
    if (t.closest('[data-dt-today]')) {
      const now = new Date();
      dtOpen.date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      dtOpen.view = new Date(now.getFullYear(), now.getMonth(), 1);
      dtApply();
      dtRender();
      return;
    }
    if (t.closest('[data-dt-clear]')) {
      dtSet(dtOpen.input, '', '');
      return dtClose();
    }
    if (t.closest('[data-dt-done]')) dtApply({ close: true });
  });
  document.addEventListener('change', (e) => {
    if (dtOpen && e.target.closest('.dt-pop') && e.target.matches('[data-dt-hour], [data-dt-minute]')) {
      if (!dtOpen.date && dtOpen.input.type !== 'time') {
        const now = new Date();
        dtOpen.date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      }
      dtApply();
      dtRender();
    }
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!dtOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // no cierra la ventana que contiene el campo
        dtClose();
      }
    },
    true,
  );
  addEventListener('resize', () => dtOpen && !dtOpen.pop.classList.contains('is-sheet') && dtPlace());
  document.addEventListener('scroll', (e) => dtOpen && !dtOpen.pop.contains(e.target) && !dtOpen.pop.classList.contains('is-sheet') && dtPlace(), true);
}
