import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const elements = new Map();
const element = s => {
  if (!elements.has(s))
    elements.set(s, {
      innerHTML: '',
      textContent: '',
      style: {},
      classList: {
        add() {
        },
        remove() {
        },
        toggle() {
        }
      }
    });
  return elements.get(s);
};
const listeners = {};
const document = {
  querySelector: element,
  querySelectorAll: () => [],
  body: { classList: { toggle() {
      } } },
  addEventListener(type, fn) {
    (listeners[type] ??= []).push(fn);
  }
};
const context = vm.createContext({
  document,
  window: { addEventListener() {
    } },
  console,
  setTimeout,
  clearTimeout,
  confirm: () => true
});
for (const file of ['richtext.js', 'trash.js', 'registro.js', 'workspace.js']) vm.runInContext(readFileSync('src/public/' + file, 'utf8'), context);
vm.runInContext(readFileSync('src/public/app.js', 'utf8').replace('\ninit();', '\n'), context);
vm.runInContext(`me={id:'teacher',name:'Docente',email:'t@example.test',role:'teacher'};courses=[{id:'c',name:'Química <script>',group_name:'A',canTeach:true,canDelete:true}];current={course:courses[0],canTeach:true,canDelete:true,records:[{id:'g',kind:'group',revision:2,data:{title:'Equipo uno',category:'Equipos',members:['m']}}],members:[{id:'m',name:'Alumno',role:'student'}],files:[]};`, context);
vm.runInContext('renderHome()', context);
let html = element('#main').innerHTML;
assert(html.includes('data-action="delete-course"'));
assert(html.includes('Química &lt;script&gt;'));
assert(!html.includes('Química <script>'));
vm.runInContext('renderContent()', context);
html = element('#main').innerHTML;
assert(html.includes('Crear guía editable'));
for (const title of ['Presentación de la materia', 'Temario por unidades', 'Evaluación y criterios', 'Bibliografía y recursos'])
  assert(html.includes(title));
const sections = vm.runInContext('guideSections()', context);
assert.equal(sections.length, 7);
assert(sections.every(x => x.body.length > 200));
vm.runInContext('renderGroups()', context);
assert(element('#main').innerHTML.includes('data-action="delete-group"'));
let handler;
context.modal = (_title, _html, fn) => {
  handler = fn;
};
const calls = [];
context.request = async (...args) => {
  calls.push(args);
  return {};
};
vm.runInContext('deleteGroupModal(find("g"))', context);
await handler(new Map([['confirm', 'Equipo uno']]));
assert.equal(calls[0][0], '/api/group');
assert.equal(calls[0][2], 'DELETE');
assert.equal(calls[0][1].revision, 2);
vm.runInContext('current.canTeach=false;current.canDelete=false;me.role="student";renderContent()', context);
assert(!element('#main').innerHTML.includes('Crear guía editable'));
vm.runInContext('renderGroups()', context);
assert(!element('#main').innerHTML.includes('data-action="delete-group"'));
vm.runInContext('section="tasks";nav()', context);
assert(element('#topnav').innerHTML.includes('aria-current="page"'));
assert(element('#topnav').innerHTML.includes('more-menu'));
console.log('PASS: teacher/student workspace rendering, escaping, seven guide examples, deletion confirmation and navigation.');
