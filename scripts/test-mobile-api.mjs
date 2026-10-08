import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { api } from '../src/server/api.js';
import { completeLogin } from '../src/server/auth.js';
import { memoryBucket, openD1 } from './lib/d1-sqlite.mjs';

const dir = mkdtempSync(tmpdir() + '/enlace-mobile-');
const store = openD1(dir + '/test.sqlite');
const env = {
  DB: store.DB,
  BUCKET: memoryBucket(),
  AULA_OWNER_EMAIL: 'admin@example.test',
  SESSION_SECRET: 'x'.repeat(48),
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
};
const remoteUsers = {
  student: { email: 'student@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' },
  teacher: { email: 'teacher@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' },
  admin: { email: 'admin@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' },
  suspended: { email: 'suspended@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' },
  unconfirmed: { email: 'student@example.test', email_confirmed_at: null },
};
const originalFetch = globalThis.fetch;
let checks = 0;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, init = {}) => {
  assert.equal(input, 'https://supabase.test/auth/v1/user');
  assert.equal(init.headers.apikey, 'publishable-test-key');
  const token = String(init.headers.Authorization || '').replace(/^Bearer /, '');
  if (token === 'supabase-down') throw new Error('network detail must not escape');
  if (token === 'supabase-500') return response({ error: 'internal secret detail' }, 500);
  if (token === 'invalid') return response({ error: 'invalid token detail' }, 401);
  if (token === 'unconfirmed') return response(remoteUsers.unconfirmed);
  return remoteUsers[token] ? response(remoteUsers[token]) : response({ email: 'nobody@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' });
};

async function request(path, token, headers = {}) {
  const requestHeaders = new Headers(headers);
  if (token !== undefined) requestHeaders.set('authorization', token);
  return api(new Request('https://test.local' + path, { headers: requestHeaders }), env);
}

async function body(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

try {
  const users = {};
  for (const name of ['student', 'teacher', 'admin', 'suspended']) {
    users[name] = await completeLogin(env, { provider: 'google', subject: 'mobile-' + name, email: `${name}@example.test`, name });
  }
  store.raw().prepare("INSERT INTO aula_teachers (email,name,role) VALUES ('teacher@example.test','Teacher','teacher')").run();
  store.raw().prepare("UPDATE aula_users SET suspended_at='2026-01-01T00:00:00Z' WHERE email='suspended@example.test'").run();

  const courses = [
    ['course-admin', 'admin@example.test', 'Admin course', 'A', '2026', '2026-01-01T00:00:01Z'],
    ['course-teacher', 'admin@example.test', 'Teacher course', 'B', '2026', '2026-01-01T00:00:02Z'],
    ['course-student', 'admin@example.test', 'Student course', 'C', '2026', '2026-01-01T00:00:03Z'],
    ['course-hidden', 'admin@example.test', 'Hidden course', 'D', '2026', '2026-01-01T00:00:04Z'],
  ];
  for (const [id, owner, name, group, period, created] of courses) {
    store.raw().prepare('INSERT INTO aula_courses (id,owner,name,group_name,intro,created,period,student_visible) VALUES (?,?,?,?,?,?,?,?)').run(id, owner, name, group, '', created, period, 1);
  }
  store.raw().prepare("UPDATE aula_courses SET student_visible=0 WHERE id='course-hidden'").run();
  store.raw().prepare("INSERT INTO aula_members (id,course,email,user_id,name,role) VALUES ('member-teacher','course-teacher','teacher@example.test',?,'Teacher','teacher')").run(users.teacher.id);
  store.raw().prepare("INSERT INTO aula_members (id,course,email,user_id,name,role) VALUES ('member-student','course-student','student@example.test',?,'Student','student')").run(users.student.id);
  store.raw().prepare("INSERT INTO aula_members (id,course,email,user_id,name,role) VALUES ('member-hidden','course-hidden','student@example.test',?,'Student','student')").run(users.student.id);

  for (const [header, expected] of [['', 401], ['Basic abc', 401], ['Bearer', 401], ['Bearer token with spaces', 401]]) {
    const res = await request('/api/mobile/v1/me', header);
    assert.equal(res.status, expected);
    checks++;
  }
  const unconfirmed = await request('/api/mobile/v1/me', 'Bearer unconfirmed');
  assert.equal(unconfirmed.status, 401);
  assert.deepEqual(await body(unconfirmed), { error: 'La sesión móvil no es válida.' });
  checks++;
  const invalid = await request('/api/mobile/v1/me', 'Bearer invalid');
  assert.equal(invalid.status, 401);
  assert.equal((await body(invalid)).error.includes('invalid token detail'), false);
  checks++;
  const unknown = await request('/api/mobile/v1/me', 'Bearer unknown');
  assert.equal(unknown.status, 403);
  checks++;
  const suspended = await request('/api/mobile/v1/me', 'Bearer suspended');
  assert.equal(suspended.status, 403);
  assert.equal((await body(suspended)).error.includes('2026-01-01'), false);
  checks++;

  for (const [token, role] of [['student', 'student'], ['teacher', 'teacher'], ['admin', 'admin']]) {
    const res = await request('/api/mobile/v1/me', 'Bearer ' + token);
    assert.equal(res.status, 200);
    const user = await body(res);
    assert.equal(user.email, `${token}@example.test`);
    assert.equal(user.role, role);
    assert.equal(user.photo, null);
    checks++;
  }
  const studentCourses = await body(await request('/api/mobile/v1/courses', 'Bearer student'));
  assert.deepEqual(studentCourses.map((course) => course.id), ['course-student']);
  assert.equal(studentCourses[0].canTeach, false);
  assert.deepEqual(Object.keys(studentCourses[0]).sort(), ['canTeach', 'groupName', 'id', 'name', 'term']);
  checks += 2;
  const teacherCourses = await body(await request('/api/mobile/v1/courses', 'Bearer teacher'));
  assert.deepEqual(teacherCourses.map((course) => course.id), ['course-teacher']);
  assert.equal(teacherCourses[0].canTeach, true);
  checks += 2;
  const adminCourses = await body(await request('/api/mobile/v1/courses', 'Bearer admin'));
  assert.deepEqual(adminCourses.map((course) => course.id), ['course-hidden', 'course-student', 'course-teacher', 'course-admin']);
  assert(adminCourses.every((course) => course.canTeach === true));
  checks += 2;

  const failed = await request('/api/mobile/v1/me', 'Bearer supabase-500');
  assert.equal(failed.status, 401);
  assert.equal((await body(failed)).error.includes('internal secret detail'), false);
  const unavailable = await request('/api/mobile/v1/me', 'Bearer supabase-down');
  assert.equal(unavailable.status, 503);
  assert.equal((await body(unavailable)).error.includes('network detail'), false);
  checks += 4;
  console.log(`OK: ${checks} comprobaciones de API móvil`);
} finally {
  globalThis.fetch = originalFetch;
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
