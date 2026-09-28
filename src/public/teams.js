/* Equipos en lote: crea una categoría completa de equipos a partir de la lista del curso. */

function shuffled(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Reparte alumnos en equipos de tamaño equilibrado (difieren a lo más en 1).
 * mode 'count': `value` equipos. mode 'size': equipos de `value` integrantes como máximo.
 */
function makeTeams(students, { mode, value, order, prefix = 'Equipo', random = Math.random }) {
  const n = Math.floor(Number(value));
  if (!students.length || !Number.isFinite(n) || n < 1) return [];
  const sorted = order === 'alpha' ? [...students].sort((a, b) => a.name.localeCompare(b.name, 'es')) : shuffled(students, random);
  const count = Math.min(sorted.length, mode === 'size' ? Math.ceil(sorted.length / n) : n);
  const base = Math.floor(sorted.length / count);
  const extra = sorted.length % count;
  const teams = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    teams.push({ title: `${prefix} ${i + 1}`, members: sorted.slice(start, start + size).map((s) => s.id) });
    start += size;
  }
  return teams;
}

/** Lista pegada "equipo, correo" (en cualquier orden, separada por tabulador, coma o punto y coma). */
function parseTeamList(text, students) {
  const byEmail = new Map(students.map((s) => [String(s.email || '').toLowerCase(), s]));
  const teams = new Map();
  const errors = [];
  const used = new Set();
  String(text || '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      const cells = line.split(line.includes('\t') ? '\t' : /[;,]/).map((c) => c.trim()).filter(Boolean);
      if (index === 0 && cells.some((c) => /^(equipo|correo|e-?mail)$/i.test(c))) return;
      const email = cells.find((c) => c.includes('@'))?.toLowerCase();
      const team = cells.find((c) => !c.includes('@'));
      const student = email && byEmail.get(email);
      if (!team || !email) errors.push(`Fila ${index + 1}: falta el equipo o el correo.`);
      else if (!student) errors.push(`Fila ${index + 1}: ${email} no está inscrito en el curso.`);
      else if (used.has(student.id)) errors.push(`Fila ${index + 1}: ${email} aparece dos veces.`);
      else {
        used.add(student.id);
        if (!teams.has(team)) teams.set(team, []);
        teams.get(team).push(student.id);
      }
    });
  return { teams: [...teams].map(([title, members]) => ({ title, members })), errors };
}

function bulkTeamsModal() {
  const students = current.members.filter((m) => m.role === 'student');
  let proposal = [];
  modal(
    'Crear equipos en lote',
    field('Nombre de la categoría', 'category', 'Equipos de laboratorio', 'text', 'required maxlength="100"') +
      `<label>Cómo formarlos<select name="teamsMethod">
         <option value="count">Número de equipos</option>
         <option value="size">Integrantes por equipo</option>
         <option value="list">Pegar lista (equipo y correo)</option>
       </select></label>
       <div class="teams-auto">
         ${field('Cantidad', 'teamsValue', '5', 'number', 'min="1" max="100"')}
         <label>Reparto<select name="teamsOrder"><option value="random">Aleatorio</option><option value="alpha">Por orden alfabético</option></select></label>
         ${field('Nombre de cada equipo', 'teamsPrefix', 'Equipo', 'text', 'maxlength="60"')}
       </div>
       <label class="teams-list" hidden>Lista<textarea name="teamsList" spellcheck="false" placeholder="Equipo 1	ana.perez@alumno.buap.mx"></textarea></label>
       <div class="teams-preview" id="teamsPreview" aria-live="polite"></div>
       <button type="button" class="secondary" id="teamsShuffle">Revolver</button>`,
    async (f) => {
      if (!proposal.length) throw new Error('No hay equipos para crear. Revisa la cantidad o la lista.');
      const { created } = await request('/api/groups/bulk', { course: current.course.id, category: f.get('category'), groups: proposal });
      return `Se ${created === 1 ? 'creó 1 equipo' : `crearon ${created} equipos`} en "${f.get('category')}".`;
    },
    'Crear equipos',
  );
  // Los campos se crean de nuevo en cada apertura del diálogo: la escucha va en su contenedor, no en el formulario.
  const box = $('#fields').firstElementChild;
  const get = (name) => box.querySelector(`[name="${name}"]`).value;
  const preview = $('#teamsPreview');
  const nameOf = (id) => esc(students.find((s) => s.id === id)?.name || '');
  const update = () => {
    const method = get('teamsMethod');
    box.querySelector('.teams-auto').hidden = method === 'list';
    box.querySelector('.teams-list').hidden = method !== 'list';
    $('#teamsShuffle').hidden = method === 'list' || get('teamsOrder') !== 'random';
    let errors = [];
    if (method === 'list') ({ teams: proposal, errors } = parseTeamList(get('teamsList'), students));
    else proposal = makeTeams(students, { mode: method, value: get('teamsValue'), order: get('teamsOrder'), prefix: get('teamsPrefix').trim() || 'Equipo' });
    const assigned = new Set(proposal.flatMap((t) => t.members));
    const without = students.filter((s) => !assigned.has(s.id));
    preview.innerHTML =
      (errors.length ? `<p class="error">${errors.slice(0, 3).map(esc).join('<br>')}${errors.length > 3 ? `<br>y ${errors.length - 3} más.` : ''}</p>` : '') +
      (proposal.length
        ? `<p><strong>${proposal.length} ${proposal.length === 1 ? 'equipo' : 'equipos'}</strong></p><ol>${proposal
            .map((t) => `<li><strong>${esc(t.title)}</strong> (${t.members.length}): ${t.members.map(nameOf).join(', ')}</li>`)
            .join('')}</ol>`
        : '<p class="muted">La vista previa aparecerá aquí.</p>') +
      (proposal.length && without.length ? `<p class="muted">Sin equipo: ${without.map((s) => esc(s.name)).join(', ')}.</p>` : '');
  };
  box.addEventListener('input', update);
  $('#teamsShuffle').onclick = update;
  update();
}

function deleteCategoryModal(category) {
  if (!category) return toast('Elige primero una categoría en el filtro.');
  const count = records('group').filter((g) => g.data.category === category).length;
  modal(
    'Eliminar categoría',
    `<p>Se eliminarán los ${count} equipos de <strong>${esc(category)}</strong>. Los alumnos siguen inscritos y conservan sus entregas y calificaciones.</p>` +
      field('Escribe el nombre de la categoría para confirmar', 'confirm', '', 'text', 'required autocomplete="off"'),
    async (f) => {
      await request('/api/groups/category', { course: current.course.id, category, confirm: f.get('confirm') }, 'DELETE');
      return `Categoría "${category}" eliminada.`;
    },
    'Eliminar equipos',
  );
  $('#formSave').classList.add('danger-button');
}

// ---- Entregas por equipo ----

function teamFor(task, memberId) {
  if (!task?.data.groupCategory) return null;
  return records('group').find((g) => g.data.category === task.data.groupCategory && g.data.members.includes(memberId)) || null;
}

function teamNames(group) {
  return group.data.members.map((id) => current.members.find((m) => m.id === id)?.name).filter(Boolean).join(', ');
}

function teamBannerHtml(task) {
  const mine = myMember();
  const team = mine && teamFor(task, mine.id);
  return team
    ? `<p class="team-banner">Entrega por equipo: <strong>${esc(team.data.title)}</strong> (${esc(teamNames(team))}). Lo que entregue cualquier integrante cuenta para todos.</p>`
    : `<p class="team-banner warning">Esta actividad es por equipo y todavía no tienes equipo en "${esc(task.data.groupCategory)}". Pide a tu docente que te agregue.</p>`;
}
