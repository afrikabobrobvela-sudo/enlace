/* Estadísticas por pregunta y exportación a Excel de los resultados de una evaluación (12.23), para quien enseña.
 * Se calculan en el navegador con los intentos que ya trae el curso (respetan el filtro de secciones). */

/** Alumno del curso que hizo un intento (con cuenta o alumno de ejemplo). */
const quizMemberOf = (author) => current.members.find((m) => m.user_id === author || `demo:${m.id}` === author);
const creditOf = (d) => (typeof d.credit === 'number' ? d.credit : d.correct ? 1 : 0);
const pctText = (x) => `${Math.round(x * 100)} %`;

function quizAttemptsInView(q) {
  return records('attempt')
    .filter((a) => a.data.quiz === q.id && inSelectedSection(quizMemberOf(a.author)))
    .sort((a, b) => a.data.name.localeCompare(b.data.name, 'es') || (a.data.attempt || 1) - (b.data.attempt || 1));
}

/** Correlación de Pearson (null si hay muy pocos datos o no varían). */
function correlation(pairs) {
  if (pairs.length < 3) return null;
  const mean = (k) => pairs.reduce((s, p) => s + p[k], 0) / pairs.length;
  const mx = mean(0);
  const my = mean(1);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 1e-12 && syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Texto de la respuesta de un alumno a una pregunta (para el docente). */
function answerText(question, d) {
  const a = d.answer;
  if (a === null || a === undefined || (Array.isArray(a) && a.every((x) => x === null || x === ''))) return '(sin respuesta)';
  const type = question?.type || 'choice';
  if (type === 'choice') return `${QUIZ_LETTERS[a] || '?'}. ${question.options[a] ?? ''}`;
  if (type === 'multi') return a.map((j) => MULTI_LETTERS[j] || '?').join(', ');
  if (type === 'truefalse') return a === true ? 'Verdadero' : 'Falso';
  if (type === 'matching') {
    const all = [...question.pairs.map((p) => p.right), ...(question.extra || [])];
    const rights = question.reuse ? [...new Set(all)] : all; // 12.27: respuestas repetidas aparecen una vez
    return question.pairs.map((p, i) => `${p.left} → ${a[i] === null || a[i] === undefined ? '—' : rights[a[i]] ?? '?'}`).join('; ');
  }
  if (type === 'ordering') return `Lugares: ${a.map((p) => (p === null ? '—' : p + 1)).join(', ')}`;
  return Array.isArray(a) ? a.join(' | ') : String(a);
}

/** Estadísticas de cada pregunta: cuántos la recibieron, acierto promedio, discriminación y respuestas elegidas. */
function quizQuestionStats(q, attempts) {
  const questions = q.data.questions;
  const weight = (i) => questions[i]?.points || 1;
  return questions.map((question, i) => {
    const rows = [];
    for (const a of attempts) {
      const details = a.data.details || [];
      const d = details.find((x) => x.index === i);
      if (!d) continue;
      let rest = 0;
      let restMax = 0;
      for (const o of details) {
        if (o.index === i || (o.manual && !o.reviewed)) continue;
        rest += weight(o.index) * creditOf(o);
        restMax += weight(o.index);
      }
      rows.push({ d, credit: creditOf(d), rest: restMax ? rest / restMax : null, pending: Boolean(d.manual && !d.reviewed) });
    }
    const graded = rows.filter((r) => !r.pending);
    const blank = rows.filter((r) => r.d.answer === null || r.d.answer === undefined).length;
    const type = question.type || 'choice';
    let choices = null;
    if (type === 'choice' || type === 'multi') {
      const correct = type === 'multi' ? question.correct : [question.correct];
      choices = question.options.map((o, k) => ({ label: `${(type === 'multi' ? MULTI_LETTERS : QUIZ_LETTERS)[k]}. ${o}`, correct: correct.includes(k), count: 0 }));
      for (const r of rows) for (const k of Array.isArray(r.d.answer) ? r.d.answer : r.d.answer === null || r.d.answer === undefined ? [] : [r.d.answer]) if (choices[k]) choices[k].count++;
    } else if (type === 'truefalse') {
      choices = [
        { label: 'Verdadero', correct: question.correct === true, count: rows.filter((r) => r.d.answer === true).length },
        { label: 'Falso', correct: question.correct === false, count: rows.filter((r) => r.d.answer === false).length },
      ];
    } else if (type === 'matching') {
      choices = question.pairs.map((p, k) => ({ label: `${p.left} ↔ ${p.right}`, correct: true, count: rows.filter((r) => r.d.marks?.[k]).length, accuracy: true }));
    } else if (['short', 'fill', 'multishort'].includes(type)) {
      // Respuestas más frecuentes (en «para completar» y «varias cortas», cada espacio por separado).
      const freq = new Map();
      for (const r of rows) {
        const list = Array.isArray(r.d.answer) ? r.d.answer : r.d.answer === null || r.d.answer === undefined ? [] : [r.d.answer];
        list.forEach((value, k) => {
          const text = String(value ?? '').trim();
          if (!text) return;
          const key = text.toLocaleLowerCase('es-MX');
          const entry = freq.get(key) || { label: text, count: 0, correct: type === 'short' ? r.credit === 1 : Boolean(r.d.marks?.[k]) };
          entry.count++;
          freq.set(key, entry);
        });
      }
      choices = [...freq.values()].sort((a, b) => b.count - a.count).slice(0, 6);
      if (choices.length) choices.common = true;
    }
    return {
      index: i,
      question,
      count: rows.length,
      pending: rows.length - graded.length,
      blank,
      average: graded.length ? graded.reduce((s, r) => s + r.credit, 0) / graded.length : null,
      discrimination: correlation(graded.filter((r) => r.rest !== null).map((r) => [r.credit, r.rest])),
      choices,
    };
  });
}

const discriminationText = (r) => (r === null ? 'sin datos suficientes' : r >= 0.3 ? 'buena' : r >= 0.2 ? 'aceptable' : r >= 0 ? 'baja' : 'revisar: la fallan más quienes salen mejor');
const difficultyText = (x) => (x === null ? '' : x >= 0.9 ? 'muy fácil' : x >= 0.7 ? 'fácil' : x >= 0.4 ? 'media' : x >= 0.2 ? 'difícil' : 'muy difícil');

function statBarsHtml(s) {
  const c = s.choices;
  if (!c?.length) return '';
  const base = c.accuracy || c.common ? s.count : s.count || 1;
  return `${c.common ? '<p class="muted stat-note">Respuestas más frecuentes:</p>' : ''}<div class="stat-bars">${c
    .map((x) => {
      const share = base ? x.count / base : 0;
      return `<div class="stat-bar ${x.correct ? 'is-correct' : ''}"><span class="stat-bar-label">${esc(x.label.length > 90 ? `${x.label.slice(0, 90)}…` : x.label)}${
        x.accuracy ? '' : x.correct ? ' <b class="stat-ok">✓ correcta</b>' : ''
      }</span><span class="stat-bar-track" aria-hidden="true"><span class="stat-bar-fill" style="width:${Math.round(share * 100)}%"></span></span><span class="stat-bar-value">${x.accuracy ? `${pctText(share)} la acierta` : `${x.count} · ${pctText(share)}`}</span></div>`;
    })
    .join('')}</div>`;
}

function quizStatsModal(quizId) {
  const q = find(quizId);
  const attempts = quizAttemptsInView(q);
  if (!attempts.length) return toast('Todavía no hay intentos en esta evaluación.');
  const stats = quizQuestionStats(q, attempts);
  const scores = attempts.map((a) => a.data.score).sort((a, b) => a - b);
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const median = scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2;
  const students = new Set(attempts.map((a) => a.author)).size;
  modal(
    `Estadísticas: ${q.data.title}`,
    `<div class="stat-summary"><div><b>${attempts.length}</b><span>${attempts.length === 1 ? 'intento' : 'intentos'} de ${students} ${students === 1 ? 'alumno' : 'alumnos'}</span></div><div><b>${mean.toFixed(2)}</b><span>promedio (de 10)</span></div><div><b>${median.toFixed(2)}</b><span>mediana</span></div><div><b>${scores[0].toFixed(2)} – ${scores.at(-1).toFixed(2)}</b><span>mínima y máxima</span></div></div>
    <p class="muted">Acierto: crédito promedio de quienes recibieron la pregunta. Discriminación: qué tanto aciertan más quienes salen mejor en el resto de la evaluación (0.3 o más es buena; si es negativa, revisa la clave o la redacción). Cuentan todos los intentos${courseSections().length ? ' de las secciones elegidas' : ''}.</p>
    ${stats
      .map(
        (s) => `<section class="stat-card"><h3>${s.index + 1}. ${esc(s.question.text.length > 160 ? `${s.question.text.slice(0, 160)}…` : s.question.text)} <span class="quiz-type-tag">${QUESTION_TYPE_NAME[s.question.type || 'choice']}</span>${pointsTag(s.question)}</h3>${
          s.count
            ? `<p class="stat-metrics"><span>Acierto <b>${s.average === null ? '—' : pctText(s.average)}</b>${s.average === null ? '' : ` · ${difficultyText(s.average)}`}</span><span>Discriminación <b>${s.discrimination === null ? '—' : s.discrimination.toFixed(2)}</b> · ${discriminationText(s.discrimination)}</span><span>La recibieron <b>${s.count}</b>${s.blank ? ` · ${s.blank} en blanco` : ''}${s.pending ? ` · ${s.pending} por calificar` : ''}</span></p>${statBarsHtml(s)}`
            : '<p class="muted">Nadie la ha recibido (preguntas al azar).</p>'
        }</section>`,
      )
      .join('')}`,
    null,
  );
}

/** Libro de Excel con resultados por alumno, respuestas por pregunta y estadísticas. */
function exportQuizResults(quizId) {
  const q = find(quizId);
  const attempts = quizAttemptsInView(q);
  if (!attempts.length) return toast('Todavía no hay intentos en esta evaluación.');
  const questions = q.data.questions;
  const withSections = courseSections().length > 0;
  const who = (a) => {
    const m = quizMemberOf(a.author);
    return [a.data.name, m?.matricula || '', m?.email || '', ...(withSections ? [sectionName(m?.section) || 'Sin sección'] : [])];
  };
  const round = (x) => Math.round(x * 100) / 100;
  const results = [
    ['Alumno', 'Matrícula', 'Correo', ...(withSections ? ['Sección'] : []), 'Intento', 'Enviado', 'Calificación (de 10)', 'Aciertos', 'Preguntas', 'Por calificar', ...questions.map((x, i) => `P${i + 1} (${x.points || 1} pts)`)],
    ...attempts.map((a) => {
      const byIndex = new Map((a.data.details || []).map((d) => [d.index, d]));
      return [
        ...who(a),
        a.data.attempt || 1,
        fmt(a.created),
        round(a.data.score),
        a.data.correct,
        a.data.total,
        a.data.pending || 0,
        ...questions.map((x, i) => {
          const d = byIndex.get(i);
          if (!d) return '';
          return d.manual && !d.reviewed ? 'por calificar' : round(creditOf(d) * (x.points || 1));
        }),
      ];
    }),
  ];
  const answers = [['Alumno', 'Intento', 'Pregunta', 'Tipo', 'Respuesta', 'Crédito (%)', 'Puntos obtenidos', 'Puntos posibles', 'Comentario del docente']];
  for (const a of attempts) {
    for (const d of a.data.details || []) {
      const x = questions[d.index];
      if (!x) continue;
      const pending = d.manual && !d.reviewed;
      answers.push([a.data.name, a.data.attempt || 1, `${d.index + 1}. ${x.text}`, QUESTION_TYPE_NAME[x.type || 'choice'], answerText(x, d), pending ? 'por calificar' : Math.round(creditOf(d) * 100), pending ? '' : round(creditOf(d) * (x.points || 1)), x.points || 1, d.feedback || '']);
    }
  }
  const stats = quizQuestionStats(q, attempts);
  const summary = [
    ['#', 'Pregunta', 'Tipo', 'Puntos', 'La recibieron', 'En blanco', 'Por calificar', 'Acierto promedio (%)', 'Discriminación', 'Respuestas elegidas'],
    ...stats.map((s) => [
      s.index + 1,
      s.question.text,
      QUESTION_TYPE_NAME[s.question.type || 'choice'],
      s.question.points || 1,
      s.count,
      s.blank,
      s.pending,
      s.average === null ? '' : Math.round(s.average * 100),
      s.discrimination === null ? '' : round(s.discrimination),
      (s.choices || []).map((c) => `${c.label}${c.correct && !c.accuracy ? ' (correcta)' : ''}: ${c.accuracy ? pctText(s.count ? c.count / s.count : 0) : c.count}`).join(' · '),
    ]),
  ];
  downloadXlsx(`${q.data.title} - resultados.xlsx`, [
    { name: 'Resultados', rows: results, widths: [30, 14, 28, ...(withSections ? [12] : []), 8, 18, 12, 10, 10, 12] },
    { name: 'Respuestas', rows: answers, widths: [30, 8, 50, 18, 40, 11, 10, 10, 40] },
    { name: 'Preguntas', rows: summary, widths: [5, 60, 18, 8, 12, 10, 12, 12, 13, 70] },
  ]);
  toast('Se descargó el libro de Excel con resultados, respuestas y estadísticas.');
}

document.addEventListener('click', (e) => {
  const stats = e.target.closest('[data-quiz-stats]');
  if (stats) return quizStatsModal(stats.dataset.quizStats);
  const exp = e.target.closest('[data-quiz-export]');
  if (exp) exportQuizResults(exp.dataset.quizExport);
});
