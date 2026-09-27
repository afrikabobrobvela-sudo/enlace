// Panel de docentes e importación de listas de alumnos.
import assert from 'node:assert/strict';
import { fakeBrowser } from './lib/fake-dom.mjs';

const browser = fakeBrowser({ fetch: async () => ({ ok: true, status: 200, json: async () => [] }) });
browser.load('admin-tools.js');
const { context } = browser;

// ---- parseRoster: Excel (tabuladores), CSV y encabezados ----
const excel = context.parseRoster(
  'Nombre\tMatrícula\tCorreo\nAna Pérez López\t202612345\tAna.Perez@alumno.buap.mx\n\nLuis Gómez\t\tluis@alumno.buap.mx\n',
);
assert.deepEqual(JSON.parse(JSON.stringify(excel.students)), [
  { name: 'Ana Pérez López', email: 'ana.perez@alumno.buap.mx', matricula: '202612345' },
  { name: 'Luis Gómez', email: 'luis@alumno.buap.mx', matricula: '' },
]);
assert.equal(excel.errors.length, 0);

const csv = context.parseRoster('"rosa@alumno.buap.mx","Rosa Díaz",202600001\nmario@alumno.buap.mx;Mario Ruiz\nSin correo, 202600003\n');
assert.equal(csv.students.length, 2);
assert.equal(csv.students[0].name, 'Rosa Díaz');
assert.equal(csv.students[0].matricula, '202600001');
assert.equal(csv.students[1].name, 'Mario Ruiz');
assert.deepEqual(JSON.parse(JSON.stringify(csv.errors)), [{ line: 3, text: 'Sin correo, 202600003' }]);

// ---- renderTeachers: acciones, cuenta principal y escape de HTML ----
Object.assign(context, {
  $: browser.element,
  current: null,
  homeView: 'teachers',
  me: { email: 'coord@example.test', role: 'admin' },
  esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  fmt: (s) => 'fecha:' + s,
  button: (label, action, id = '', style = 'primary') => `<button class="${style}" data-action="${action}">${label}</button>`,
  request: async () => [
    { email: 'owner@example.test', name: 'Dr. Rodrigo Vela', role: 'admin', owner: true, courses: 3, user_id: 'u0', lastLogin: '2026-09-20' },
    { email: 'coord@example.test', name: 'Coordinación', role: 'admin', owner: false, courses: 0, user_id: 'u1', lastLogin: null },
    { email: 'x@example.test', name: '<img src=x onerror=alert(1)>', role: 'teacher', owner: false, courses: 2, user_id: null, lastLogin: null },
  ],
});
await context.renderTeachers();
const html = browser.elements.get('#main').innerHTML;
assert.doesNotMatch(html, /<img src=x/, 'Los nombres se escapan');
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.equal((html.match(/data-action="remove-teacher"/g) || []).length, 1, 'Ni la cuenta principal ni uno mismo se pueden retirar');
assert.match(html, /data-courses="2"/);
assert.match(html, /Aún no entra/);
assert.match(html, /fecha:2026-09-20/);
assert.match(html, /Cuenta principal/);

// Si la persona navegó a otra pantalla mientras cargaba la lista, no se sobrescribe.
const loading = context.renderTeachers();
browser.elements.get('#main').innerHTML = 'OTRA PANTALLA'; // la persona cambia de pantalla mientras llega la respuesta
context.homeView = 'courses';
await loading;
assert.equal(browser.elements.get('#main').innerHTML, 'OTRA PANTALLA');

console.log('PASS: lista de alumnos desde Excel/CSV, panel de docentes con acciones seguras y nombres escapados.');
