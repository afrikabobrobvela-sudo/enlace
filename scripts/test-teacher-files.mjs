import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
let submit, saved;
const ctx = vm.createContext({
  teaches: () => true,
  esc: x => x,
  $: () => ({}),
  modal: (_title, _html, handler) => {
    submit = handler;
  },
  save: async (...args) => {
    saved = args;
  }
});
vm.runInContext(readFileSync('src/public/activity-files.js', 'utf8'), ctx);
vm.runInContext("attachmentManager=()=>({upload:async()=>['presentation-id']});", ctx);
const task = {
  id: 'activity-id',
  kind: 'task',
  revision: 4,
  data: {
    title: 'Presentación',
    body: 'Instrucciones',
    due: '2026-10-01T12:00:00Z',
    visible: false,
    extensions: ['pdf'],
    submissionMode: 'files',
    maxFiles: 1,
    allowResubmit: false
  }
};
ctx.teacherFilesModal(task);
await submit();
assert.equal(saved[0], 'task');
assert.equal(saved[1].fileIds[0], 'presentation-id');
assert.equal(saved[1].extensions, 'pdf');
assert.equal(saved[1].visible, false);
assert.equal(saved[1].due, task.data.due);
assert.equal(saved[1].maxFiles, 1);
assert.equal(saved[2].revision, 4);
console.log('PASS: teacher attachments preserve instructions, visibility, dates, student restrictions and revision.');
