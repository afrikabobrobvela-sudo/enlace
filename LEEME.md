# Enlace · versión 12.14

Plataforma académica independiente para docentes y alumnos de cualquier academia (nació en la Academia de Física de la BUAP), con interfaz inspirada en Brightspace.
No es el código de D2L Brightspace ni una plataforma oficial de la BUAP.

Esta versión se despliega en **tu propia cuenta de Cloudflare** (Workers + D1 + R2, plan gratuito) y ya no depende de ChatGPT Sites.

## Novedades de la versión 12.14 (evaluaciones en la calificación, seguimiento y publicación programada)

Requiere la migración **0019**: solo agrega una tabla y no modifica datos. `npm run configurar` descarga un respaldo y la aplica.

- **Las evaluaciones en línea pueden contar en la calificación.** Al editar una evaluación, en *Calificación*:
  - Elige la categoría del curso en la que cuenta (por ejemplo, «Exámenes»).
  - Indica su valor en puntos dentro de esa categoría, igual que una actividad.
  - Con varios intentos, elige qué cuenta: el mejor, el último o el promedio.
  - Si un alumno no la contesta, no se toma como cero.
  - Requiere que el curso califique por categorías. Con pesos por actividad, la evaluación sigue siendo de práctica y el editor lo explica.
  - Se ve en el libro de calificaciones, en «Mis calificaciones» del alumno («cuenta en Exámenes · el mejor intento»), en Progreso y en la exportación.
- **Seguimiento del contenido.**
  - El alumno marca cada material como **completado**; abrirlo queda anotado solo («Ya lo abriste»).
  - Cada unidad muestra su avance («3 de 5 completados»).
  - El inicio del curso tiene **«Continuar donde te quedaste»**, que abre directamente el siguiente material pendiente.
  - Quien enseña ve en cada material «Completado por 10 de 18 · abierto por 15», y en *Progreso* una columna nueva, «Contenido completado», que también sale en la exportación.
- **Publicación programada.**
  - Unidades, materiales, noticias, foros y evaluaciones tienen «Publicar a partir de (opcional)».
  - Hasta esa fecha los alumnos no lo ven por ninguna vía: ni en el curso, ni en descargas, ni en avisos; tampoco pueden publicar en ese foro ni contestar esa evaluación.
  - Al llegar la fecha aparece solo y el aviso les llega como nuevo en ese momento.
  - El docente lo ve marcado «Programado · fecha».
- El curso de ejemplo muestra las tres cosas: una noticia programada, el cuestionario de la Unidad 2 contando en Exámenes y el avance de cada alumno.

## Novedades de la versión 12.13 (calendario y avisos)

Requiere la migración **0018**: solo agrega una tabla pequeña y no modifica datos. `npm run configurar` descarga un respaldo y la aplica.

- **Calendario** (botón *Calendario* en Mis cursos, para todos):
  - Junta en una sola vista las entregas y las clases (sesiones de asistencia) de todos los cursos activos.
  - Vista de **mes** o **agenda**; en el teléfono empieza en la agenda y el mes se ve como puntos de color por día.
  - Filtro por curso. Tocar un evento abre la actividad o la asistencia en su curso, y «Atrás» regresa al calendario.
  - **Alumnos:** cada actividad aparece con **su** fecha (incluida su prórroga) y su estado: por entregar, sin entregar, entregada o calificada. Los borradores de calificación no se ven como calificados. En cada clase ve si tuvo asistencia, retardo, falta o justificación.
  - **Docentes:** ven también las actividades ocultas (marcadas) y cuántas entregas faltan por calificar.
  - **Descargar para mi calendario (.ics):** agrega las entregas y clases del periodo a Google Calendar, Outlook o el calendario del teléfono. Es una copia de ese momento: si cambian las fechas, hay que descargarla otra vez.
- **Avisos más completos:**
  - **Uno por uno:** abrir un aviso lo marca como leído, solo ese. Antes, abrir la campana marcaba todos.
  - **«Marcar todo como leído»**, arriba del panel.
  - **Filtros:** por curso y «Solo sin leer».
  - **Si cambia, vuelve a ser nuevo:** si el docente edita una noticia o actividad, vuelve a aparecer sin leer.
  - **Historial de 60 días:** *Ver historial (60 días)*, hasta 150 avisos, con los mismos filtros.
- Siguen sin enviarse correos: los avisos solo se ven dentro de Enlace.

## Novedades de la versión 12.12 (usuarios y vista de un alumno concreto)

Requiere la migración **0017** (solo agrega una tabla y tres columnas; no modifica datos). `npm run configurar` descarga un respaldo y la aplica.

- **Usuarios** (botón nuevo en Mis cursos, solo administración): busca a cualquier persona que haya entrado a Enlace por nombre o correo y filtra por rol o por estado. La **ficha** muestra:
  - las cuentas con las que entra (Google, Microsoft o correo) y su último acceso;
  - las sesiones abiertas;
  - los cursos que imparte y en los que está inscrita;
  - su registro de acciones.
- **Suspender acceso.** Cierra todas sus sesiones y le impide entrar hasta que la reactives; al intentar entrar ve «Tu acceso a Enlace está suspendido». No se borra nada: cursos, entregas, calificaciones y asistencia se conservan. No se puede suspender la cuenta principal ni la propia. El motivo queda registrado.
- **Transferir un curso** (desde la ficha del docente, «Transferir…»): cambia la persona propietaria, por ejemplo cuando otro profesor toma el grupo.
  - Alumnos, contenido, entregas y calificaciones no cambian.
  - Quien lo tenía puede quedarse como co-docente (casilla marcada por omisión).
  - Solo a docentes que ya entraron a Enlace; también funciona con cursos archivados.
- **Ver lo que ve un alumno concreto.** En *Alumnos* de cada curso («Ver lo que ve») o en la ficha de la persona.
  - Muestra el curso exactamente como lo ve ese alumno: sus entregas, calificaciones publicadas (no los borradores), intentos, prórrogas y asistencia. Las pruebas comprueban que es idéntico a lo que el alumno recibe al entrar.
  - Es de solo lectura: el aviso naranja arriba indica a quién estás viendo y cualquier intento de guardar se rechaza.
  - La usan quienes imparten el curso y la administración.
  - Cada consulta queda registrada, una vez cada 30 minutos por alumno.
- **Registro de acciones** (*Usuarios → Registro de acciones*): quién consultó la vista de qué alumno, quién suspendió o reactivó un acceso y quién transfirió qué curso, con fecha.
- Se corrigió una prueba automática que fallaba al azar (≈1 de cada 4 veces) por un error de la propia prueba, no de Enlace.

## Novedades de la versión 12.11 (respaldos completos y publicación segura)

No requiere migraciones.

- **Respaldo de archivos.** *Reportes → Respaldo de archivos → «Respaldar archivos…»* copia tareas, presentaciones y evidencias (lo que vive en R2, que el respaldo de la base no incluía) a una carpeta de tu computadora. Elige una carpeta que se sincronice con Google Drive para escritorio o una memoria USB.
  - La primera vez descarga todo; después, solo lo nuevo.
  - La carpeta lleva `indice.csv` (nombre original, curso y fecha de cada archivo) y un `LEEME.txt`.
  - Si un archivo registrado ya no está en el almacenamiento, te lo dice.
  - Funciona en Chrome o Edge de computadora.
- **Restaurar archivos.** *«Restaurar archivos que falten…»* con la misma carpeta: Enlace pregunta cuáles faltan y sube solo esos. Nunca reemplaza un archivo que existe, solo acepta archivos que la base tiene registrados y exige el tamaño exacto.
- **Los respaldos de la base se comprueban.**
  - **El problema:** la exportación de Cloudflare no se podía cargar tal cual en una base vacía (fallaba con «no such table: aula_units»). Las instrucciones anteriores de restauración **no funcionaban**.
  - **Al respaldar:** `npm run respaldo` y el respaldo semanal de GitHub cargan el respaldo completo en una base temporal y confirman que se puede restaurar.
  - **Para restaurar:** el comando nuevo `npm run restaurar -- respaldos/ARCHIVO.sql` lo carga en una base **nueva**, se niega a escribir en una base con datos y compara las filas al terminar (ver *Respaldos*).
- **No se puede publicar con los valores de ejemplo.**
  - **Atajos bloqueados:** `npm run deploy` y `npm run db:migrate` se detienen con un mensaje claro si `wrangler.toml` tiene el `database_id` o el correo de ejemplo del ZIP.
  - **`npm run configurar` recuerda tus datos:** guarda tu base, tu correo y tu dirección en tu usuario de la computadora (carpeta `.enlace`). Una versión nueva descomprimida en otra carpeta ya no pregunta nada.
  - **Correo verificado:** si escribes un correo que nunca ha entrado a Enlace, te avisa antes de publicar. Así no te quedas sin la cuenta de administración.
  - **Vigilancia:** si de todos modos se publica con el correo de ejemplo, `/salud` responde con error y la vigilancia te avisa.
- **Simulacro hecho:** en una copia local se borraron la base y los archivos, y se restauraron. Base con las mismas filas en todas las tablas, archivos idénticos byte por byte y la alumna volvió a descargar su entrega.

## Novedades de la versión 12.10 (curso de ejemplo)

No requiere migraciones.

- **Botón «Curso de ejemplo»** en Mis cursos (docentes y administración). Crea a tu nombre la materia **Mecánica clásica (curso de ejemplo)**, lista para mostrar la plataforma:
  - 18 alumnos ficticios con matrícula;
  - temario en 4 unidades con fórmulas y simuladores PhET (una unidad oculta como borrador);
  - 3 noticias, 2 foros con participación de alumnos y 4 equipos de laboratorio;
  - 7 actividades: calificadas y publicadas, una con rúbrica, una por equipo, un examen capturado sin entrega, borradores sin publicar, entregas por calificar y una actividad abierta;
  - calificación por categorías (Tareas, Laboratorio, Exámenes y Asistencia);
  - una evaluación con resultados de 16 alumnos y otra abierta;
  - seis semanas de pases de lista con asistencias, retardos, faltas y justificantes.
- **Los alumnos del ejemplo no existen.** Sus correos terminan en `@ejemplo.invalid`, un dominio reservado que nunca recibe correo, y no tienen cuenta: nadie más ve el curso.
- **Se puede usar como cualquier otro curso.** Puedes calificar, pasar lista, editar, «Ver como alumno», copiarlo a otro periodo o eliminarlo.
- **Máximo 3 cursos de ejemplo a la vez por persona.** Al eliminar uno se puede crear otro.
- **Fechas relativas.** Se calculan a partir del día en que se crea, así siempre hay actividades vencidas, por calificar y abiertas.
- **Una sola operación.** Todo se escribe con 13 inserciones: si algo falla, no queda nada a medias.
- **Qué agrega fuera del curso.** Solo una rúbrica «Resolución de problemas (ejemplo)» en tu banco personal (no compartida).

## Novedades de la versión 12.9 (experiencia en el celular)

No requiere migraciones: solo cambia la interfaz. En computadora todo se ve igual que antes (salvo «Mis calificaciones» del alumno, que ahora es más clara también ahí).

- **El botón «Atrás» del teléfono funciona dentro de Enlace**: regresa a la pantalla anterior (de una actividad a la lista, de ahí al curso y a Mis cursos) en lugar de salir de la aplicación. Si hay una ventana abierta (entrega, formulario, vista previa, menú), «Atrás» la cierra; si ya se escribió algo, pregunta antes. En un examen, avisa que el tiempo sigue corriendo.
- **Cada pantalla tiene su dirección** (por ejemplo `…/#c=…&s=task&d=…`): al recargar, Enlace regresa a la misma pantalla, y se puede compartir el enlace directo a una actividad o evaluación (cada quien la ve según sus permisos).
- **Barra inferior** con Inicio, Contenido, Actividades y Notas (alumno) o Asistencia (docente), y **Más** con las demás secciones, «Ver como alumno», «Actualizar el curso» y «Todos mis cursos». La barra marca con un número las actividades por entregar (alumno) o por calificar (docente) y se oculta mientras se escribe o se contesta un examen.
- **Encabezado de una línea** con el nombre del curso; «Cerrar sesión» está en tu perfil (toca tu inicial).
- **Ventanas a pantalla completa** con los botones de guardar o enviar siempre a la vista.
- **Tablas como tarjetas**: actividades, evaluaciones, entregas, alumnos, foros, etc. se leen sin desplazarse de lado. El libro de calificaciones y la lista de asistencia (docente) se quedan como tabla, con la columna de nombres más angosta.
- **Mis calificaciones** (alumno): promedio parcial arriba, cada actividad con su calificación o estado (pendiente, por calificar, sin entrega) y los comentarios del docente, y el mejor intento de cada evaluación.
- **Tomar foto y unir en PDF**: al entregar desde el teléfono aparece «Tomar foto» (abre la cámara). Con dos o más fotos, Enlace las une en un solo PDF, una página por foto, en el propio teléfono (no usa tiempo del servidor). Si la actividad solo acepta PDF, las fotos se unen siempre, y cuentan como un archivo para el límite de la actividad.
- **Campos de 16 px** (en iPhone ya no acercan la pantalla al tocarlos), botones de al menos 44 px, pasar lista con los cuatro estados en una fila, Mis cursos en tarjetas compactas y márgenes para la muesca del teléfono cuando Enlace está instalado como aplicación.

Cómo se revisó: todas las pantallas de alumno y docente se recorrieron con Chromium a 360 y 390 px de ancho (tamaños de Android y iPhone), midiendo que nada se salga de la pantalla, que los botones tengan tamaño para el dedo y que los campos no provoquen zoom. Falta probarlo en teléfonos reales, sobre todo en iPhone.

## Novedades de la versión 12.8 (modo examen)

Requiere la migración **0016** (solo agrega columnas y una tabla).

En el editor de una evaluación, la sección **Modo examen**:
- **Pantalla completa, sin copiar ni pegar**, y registro de cada vez que el alumno sale de la página (otra pestaña, otra aplicación, bloquear el teléfono), con la hora y la duración. No lo impide (ninguna página web puede bloquear otras aplicaciones), pero deja constancia y disuade.
- **Contraseña para empezar** (opcional) que dictas en el salón. Tras 10 contraseñas equivocadas el alumno queda bloqueado hasta que lo desbloqueas. Si se le cierra la página, retoma sin volver a escribirla.
- **Una pregunta a la vez** y, si quieres, **sin regresar**: el servidor no acepta cambios a las preguntas que ya quedaron atrás, aunque se manipule la página.
- **Ubicación del salón**: pulsa *Usar mi ubicación actual como salón* estando en el salón y guarda. Quien empiece lejos o sin dar permiso aparece marcado en los resultados (nunca se le impide el examen; solo se guarda la distancia).
- **Respuestas guardadas mientras se contesta**: si se va la conexión o se cierra la página, el alumno continúa donde iba.
- Para ti: **Examen en curso** (quién contesta, cuántas lleva y sus salidas; *Actualizar*) y en los resultados la columna **Integridad** con el detalle por intento.

Un registro de salida no prueba por sí solo que hubo trampa (una llamada o una notificación también cuentan): úsalo como indicio para platicar con el alumno. Para bloqueo total en laboratorio de cómputo, el siguiente paso sería Safe Exam Browser.

## Novedades de la versión 12.7 (asistencia con código en el pizarrón)

Requiere la migración **0015** (solo agrega columnas). Al actualizar, cada persona vuelve a aceptar el aviso de privacidad, porque ahora menciona la ubicación.

- **Registro con código**, para salones sin pantalla. El registro con QR sigue igual. En *Pasar lista*, el botón *Registro con código* muestra un código de 6 caracteres (sin letras que se confunden) para escribirlo en el pizarrón. Los alumnos pulsan **Registrar asistencia** en su pantalla de inicio (o en *Mi asistencia*) y lo escriben desde su teléfono.
- **Filtro contra el código compartido por WhatsApp.** Tu teléfono da la ubicación del salón al abrir el registro y el de cada alumno la suya al registrarse. Si está a más de la distancia elegida (150 m por omisión, con margen por la imprecisión dentro de edificios), no dio permiso de ubicación o se conecta desde otra red, su registro queda **Por revisar** con el motivo (por ejemplo, "a 6.3 km del salón"). Con un toque lo confirmas (*Está en el salón*) o le pones falta. Si prefieres, puedes elegir que no se registre. Solo se guarda la distancia, nunca las coordenadas del alumno, y la ubicación del salón se borra al cerrar el registro.
- **Cambiar código** a media clase: el anterior deja de servir de inmediato.
- **Verificar 3 al azar** (en el registro con código y con QR): Enlace elige tres nombres de los registrados para que los nombres en voz alta; si alguien no está, *No está: falta*.
- Sigue valiendo que cada teléfono solo registra a un alumno por clase.
- Limitación: Bluetooth y el nombre de la red Wi-Fi no son accesibles desde una página web (Safari no lo permite); por eso se usan la ubicación y la red de internet.

## Novedades de la versión 12.6 (Microsoft, periodos, evaluaciones y más)

Requiere las migraciones **0009 a 0014** (`npm run configurar` las aplica después de descargar un respaldo). Todas son no destructivas: solo agregan tablas y columnas.

- **Acceso con Microsoft (correo institucional).** Botón *Continuar con Microsoft (correo BUAP)*, restringido al directorio de la BUAP y a sus dominios de correo. Quien ya entraba con Google con el mismo correo conserva su cuenta. Se activa al configurarlo (ver *Opcional: acceso con Microsoft*); mientras tanto el botón no aparece.
- **Aviso de privacidad** en `/privacidad` y enlace al pie de cada página. Cada persona lo acepta una vez al entrar (y otra vez si cambia la versión del aviso). **Es un borrador: pide que lo revise el área jurídica o de transparencia de la BUAP** antes de usarlo como definitivo (`src/public/privacidad.html`; al cambiarlo, sube `PRIVACY_VERSION` en `src/server/privacy.js`).
- **Respaldo automático semanal y vigilancia** con GitHub Actions (ver *Respaldos*). Nueva dirección `/salud` que confirma que el Worker y la base responden.
- **Periodos y archivo de cursos.** Cada curso puede tener un periodo (por ejemplo, *Otoño 2026*). *Copiar a un nuevo periodo* crea un curso nuevo con unidades, materiales, noticias, foros, evaluaciones, actividades, categorías y reglas (sin alumnos, entregas ni calificaciones; los archivos se comparten sin ocupar espacio extra; las fechas se vacían salvo que pidas conservarlas). *Archivar* deja el curso en solo lectura para todos; se puede desarchivar.
- **Co-docentes.** El propietario agrega a otro docente registrado de Enlace; puede editar y calificar, pero no borrar el curso ni agregar más co-docentes. Si deja de ser docente de Enlace, pierde también ese acceso.
- **Prórrogas individuales.** En la lista de entregas, *Prórroga* da a un alumno otra fecha de entrega y de cierre; cuenta para entregas tardías, riesgo, pendientes y calificación final.
- **Evaluaciones mejoradas.** Preguntas **numéricas** con tolerancia en porcentaje, unidad y **datos aleatorios por alumno** (variables con rango, por ejemplo `{h}` entre 5 y 45 m, y respuesta como fórmula `sqrt(2*h/g)`; se calculan en el servidor con un evaluador propio, sin `eval`). **Varios intentos** (hasta 10, cuenta el mejor), **tiempo límite** (se envía solo al terminar; si se cierra la página, el tiempo sigue corriendo) y orden aleatorio. El alumno nunca recibe respuestas ni fórmulas.
- **Mis pendientes.** La pantalla de inicio muestra lo que vence en los próximos 14 días (con prórrogas), las calificaciones nuevas y, para docentes, las entregas por calificar.
- **Avisos dentro de Enlace.** La campana del encabezado muestra noticias, materiales, actividades, evaluaciones, calificaciones publicadas y (docentes) entregas nuevas de los últimos 14 días. No se guarda un aviso por alumno: se calculan de lo publicado, sin gastar escrituras de la base.
- **Comprobante de entrega** con folio verificable (si la entrega cambia, el folio cambia); se puede imprimir o guardar como PDF.
- **Se instala como aplicación** (PWA) en el teléfono o la computadora: *Agregar a pantalla de inicio*. Nunca guarda datos del curso en el dispositivo.
- **Reportes por academia y unidad** (administración → *Reportes*): cursos activos y archivados, docentes, alumnos, actividades, entregas y espacio usado, con descarga CSV por curso.
- **Historial de calificaciones.** Cada cambio de calificación, publicación de borradores y reinicio por una nueva entrega queda registrado con quién y cuándo. En la pantalla de revisión: *Ver historial de esta calificación*. Empieza a registrar a partir de esta versión.
- **Limpieza de archivos sin usar** (en *Reportes*): lista los archivos de más de 7 días que nada enlaza, con su tamaño, y los borra solo después de escribir la confirmación. Lo que está en la papelera se conserva y los archivos compartidos con cursos copiados no se borran de R2 mientras alguna copia los use. Descarga un respaldo antes.

## Novedades de la versión 12.5 (vista como alumno)

Dentro de cualquier curso que impartes, el botón **Ver como alumno** (a la derecha del menú) muestra el curso tal como lo ven tus alumnos: solo unidades, materiales, actividades, foros y evaluaciones visibles, sin respuestas correctas ni datos de otros alumnos, y solo los archivos que ellos pueden descargar. No es una simulación: el servidor aplica exactamente los mismos filtros que a un alumno inscrito. Una franja naranja recuerda que estás en esa vista, y en ella **nada se guarda** (entregar, publicar o subir archivos muestra un aviso). *Volver a vista de docente* regresa a la vista normal. Cada docente registra **una sola academia y una unidad**. No hay migraciones nuevas.

## Novedades de la versión 12.4 (registro de docentes)

**Enlace abierto a docentes de cualquier academia, con aprobación.** Quien entra con su correo institucional (`@correo.buap.mx`) ve en *Mis cursos* el botón *Solicitar acceso de docente*: llena su nombre, **academia**, **unidad académica**, materias que imparte y un comentario. En *Docentes* aparece la solicitud (con un contador en el botón) y la administración la **aprueba** —la persona puede crear cursos de inmediato, sin volver a entrar— o la **rechaza** con un motivo que la persona ve y puede corregir. Cada docente da de alta sus propios cursos, y cada curso queda clasificado con la academia y unidad de quien lo crea.

**Catálogo de academias y unidades.** En *Docentes → Academias y unidades académicas* agregas las opciones (una por renglón, pegadas desde Excel), cambias nombres o desactivas las que ya no se usan. Los duplicados se detectan sin importar mayúsculas ni acentos. **Mientras el catálogo esté vacío, nadie puede enviar solicitudes**: primero carga las academias y unidades del Complejo Regional Centro.

**Docentes actuales.** La primera vez que entren después de la actualización (incluida la administración), Enlace les pide su academia y unidad.

Los correos que pueden solicitar acceso se configuran con `TEACHER_EMAIL_DOMAINS` en `wrangler.toml` (por omisión `correo.buap.mx`). Dar de alta docentes a mano desde *Docentes → Agregar docente* sigue funcionando con cualquier correo. Migración nueva: **0008** (solo agrega tablas y columnas).

## Novedades de la versión 12.3 (diseño)

Nueva apariencia en toda la plataforma: tipografía Inter (incluida en Enlace, sin servicios externos), logotipo, encabezado y menú fijos al desplazarse, pantalla de acceso nueva, y cada curso con su propio color e ilustración (cuadrícula, ondas u órbitas) que se repite en su página de inicio. Botones, tablas, ventanas y campos tienen un estilo uniforme, y se corrigió la casilla *Visible para alumnos*, que se desalineaba en las ventanas. El diseño vive en `src/public/tema.css`, cargado al final: no cambia el comportamiento. No hay migraciones nuevas.

## Novedades de la versión 12.2 (contenido)

**Texto con formato.** Unidades, materiales, noticias, foros, instrucciones de actividades y evaluaciones tienen una barra de formato: **negrita**, *cursiva*, títulos, listas con viñetas y numeradas, enlaces, fórmulas e imágenes, con *Vista previa* antes de guardar. Se guarda como texto sencillo (`**negrita**`, `- lista`, `[texto](https://…)`), así que todo lo que ya tenías se sigue viendo igual. Las fórmulas LaTeX funcionan como antes.

**Archivos en unidades e imágenes en el texto.** Las unidades ya aceptan archivos (programa, presentaciones), igual que los materiales. En materiales y unidades ahora puedes **quitar** un archivo ya subido y arrastrar archivos al editor. El botón *Imagen* sube una foto y la muestra dentro del texto.

**Visible u oculto con un toque.** Cada unidad, material y actividad muestra un interruptor *Visible para alumnos / Oculto para alumnos*; no hace falta abrir el editor. Si un material está visible pero su unidad está oculta, Enlace lo avisa.

**Fotos más ligeras.** Antes de subir, el navegador reduce las fotos (JPG, PNG, WEBP de más de 300 KB) a 2000 px en su lado mayor: una foto de celular de 8 MB queda en menos de 1 MB y se lee igual. Conserva el formato y el nombre; si no ahorra al menos 30 %, sube el original. También quita la ubicación GPS de las fotos. Aplica a entregas de alumnos y a material del docente.

No hay migraciones nuevas en esta versión.

## Novedades de la versión 12.1 (correcciones para uso con varios docentes)

**Papelera.** Ahora se pueden eliminar unidades, materiales, noticias, foros, evaluaciones y actividades (botón *Eliminar* en cada editor), y **moderar los foros**: el docente elimina cualquier publicación y cada alumno puede retirar la suya. Nada se borra de verdad: *Administración del curso → Papelera* muestra lo eliminado, quién y cuándo, y *Restaurar* lo devuelve con sus entregas, calificaciones e intentos. Una unidad con materiales no se elimina hasta vaciarla.

**Sesiones revocables.** *Salir* invalida la sesión en el servidor: una copia de la cookie ya no sirve. En *Mi perfil* hay *Cerrar sesión en todos mis dispositivos* (por ejemplo, si alguien pierde su teléfono). **Al publicar esta versión, todas las personas vuelven a entrar con Google una vez.**

**Retirar a un docente le quita el acceso a sus cursos** y cierra sus sesiones. Sus cursos no se borran: la administración los sigue viendo, sus alumnos conservan el acceso, y si se le vuelve a dar de alta los recupera.

**Nombres en los foros.** Los alumnos ya no pueden cambiar su nombre (antes cualquiera podía ponerse, por ejemplo, el nombre de un docente). En los foros aparecen con el nombre de la lista del curso; para corregirlo, vuelve a inscribir su correo con el nombre correcto.

**Cuotas de archivos.** Cada alumno puede subir hasta 300 MB por curso, y Enlace deja de aceptar archivos cuando el total llega a 9 GB (el nivel gratuito de R2 es de 10 GB), con un aviso claro.

**Respaldo antes de migrar.** `npm run configurar` y `npm run db:migrate` descargan un respaldo completo de la base antes de aplicar migraciones; si el respaldo falla, no tocan la base.

Migraciones nuevas: **0006** (sesiones) y **0007** (papelera). Ambas solo agregan una tabla o columnas; no modifican datos existentes.

## Novedades de la versión 12 (fase 2B)

**Categorías con pesos.** En *Calificaciones → Administrar calificaciones* eliges cómo se calcula: *pesos por actividad* (como hasta ahora; los cursos existentes no cambian) o *categorías con pesos* (por ejemplo, exámenes 60 %, tareas 30 %, asistencia 10 %). Enlace avisa en vivo si los pesos no suman 100 %. Cada actividad tiene un *valor* dentro de su categoría (con valor 2 cuenta el doble). Una categoría puede usar el **porcentaje de asistencia** llevado a escala de 10. Las actividades sin categoría no cuentan, y Enlace te dice cuántas hay.

**Calificación final.** Nueva columna en la tabla (solo la ve el docente) con las reglas que definas: decimales (entero, uno o dos), redondeo desde .5 hacia arriba o truncado, mínima aprobatoria, asentar 5 (o 0) a quien no aprueba, y si las actividades vencidas sin calificar cuentan como 0. El promedio parcial nunca cuenta lo que falta por calificar. *Exportar calificaciones* incluye la final y cada categoría, listas para capturar en el sistema institucional.

**Rúbricas.** Creas rúbricas en una cuadrícula (criterios × niveles, con puntos y descripción opcional por nivel) y las asignas en el editor de cada actividad. Al calificar, eliges un nivel por criterio con un toque, puedes comentar cada criterio, y Enlace propone la calificación (puntos obtenidos entre el máximo, en escala de 10), que puedes ajustar. El alumno ve el desglose cuando publicas. Tus rúbricas sirven en todos tus cursos; las que marcas como compartidas forman el **banco compartido** con tus colegas, que tus colegas pueden usar y copiar, pero solo tú editas. Las evaluaciones ya hechas conservan su detalle aunque la rúbrica cambie o se elimine.

**Entregas por equipo.** En el editor de la actividad, *Tipo de entrega → Por equipo* y eliges una categoría de equipos de *Grupos*. Lo que entrega cualquier integrante queda a nombre de todo su equipo (todos ven la entrega y sus archivos; otros equipos no). Al calificar, *Aplicar a todo el equipo* asigna la misma calificación, comentarios y rúbrica a cada integrante; si lo desmarcas, ajustas a una sola persona.

**Pendiente de la fase 2:** periodos, cursos maestros, altas masivas de cursos, notificaciones y app (2C).

## Novedades de la versión 11 (fase 2A)

**Asistencia con código QR (AulaPass).** En *Pasar lista*, el botón *Registro con QR* proyecta un código que los alumnos escanean con la cámara de su teléfono; Enlace se abre y registra su asistencia. Protecciones contra el fraude:

- El código se firma de nuevo cada 10 segundos y solo se acepta durante unos 30: una foto reenviada por WhatsApp deja de servir casi de inmediato.
- PIN de 4 dígitos (activado por omisión) que proyectas u ocultas para dictarlo. Tras 5 intentos fallidos el alumno queda bloqueado en esa clase y debes registrarlo tú.
- Un teléfono solo puede registrar a un alumno por clase.
- Solo pueden registrarse alumnos inscritos en el curso, y el registro se cierra solo al terminar el tiempo que elijas.
- Opcional: retardo automático después de N minutos. Al cerrar, puedes marcar falta a quien no se registró.

La pantalla muestra en vivo cuántos se han registrado y quiénes acaban de hacerlo, y tiene botón de pantalla completa para el proyector. Los alumnos conviene que inicien sesión en Enlace en su teléfono una vez al inicio del semestre: si tienen que iniciar sesión al escanear, el código puede expirar y basta con volver a escanearlo. El código QR lo genera Enlace mismo, sin servicios externos.

**Alumnos en riesgo.** La pantalla *Progreso* ahora señala a quién atender: asistencia debajo del mínimo del curso, dos o más actividades vencidas sin entregar, o promedio parcial menor a 6 (riesgo alto si cumple dos o más criterios). Se exporta a Excel para tutorías.

**Descargar entregas (ZIP).** En cada actividad, un botón descarga todas las entregas en un ZIP con una carpeta por alumno (nombre y matrícula), el texto de cada entrega y un `resumen.csv` con fecha, entrega tardía y calificación. El ZIP se arma en tu navegador (en el plan gratuito de Cloudflare el servidor no tiene tiempo de procesador para archivos grandes); hasta 1.5 GB por actividad.

## Novedades de la versión 10

**Pasar lista.** Nueva pestaña *Asistencia* en cada curso. *Generar calendario* crea las sesiones del semestre a partir de tus días de clase (sin duplicar fechas y saltando días inhábiles). *Pasar lista de hoy* abre la lista con cuatro botones grandes por alumno: Presente, Retardo, Falta y Justificada, más una nota opcional. Cada toque se guarda solo; si se va el internet, los cambios esperan en ese dispositivo y se envían al reconectar (no borres los datos del navegador antes de reconectar). El resumen muestra a cada alumno con su porcentaje y una alerta si baja del mínimo. En *Reglas* defines el mínimo (80 % por omisión), cuántos retardos equivalen a una falta y si las faltas justificadas cuentan como asistencia. *Exportar a Excel* descarga la tabla completa. Cada alumno ve solo su propia asistencia.

**Vista previa.** Junto a *Descargar* aparece *Vista previa* para PDF (con zoom y páginas que se cargan al desplazarte), imágenes (JPG, PNG, GIF y WEBP con zoom y giro; HEIC de iPhone solo en Safari), audio (MP3, M4A, WAV, OGG) y video (MP4, WEBM; MOV según el navegador). Word, Excel y PowerPoint por ahora solo se descargan. El servidor revisa el contenido real del archivo: una página web renombrada como .pdf nunca se muestra dentro de Enlace.

**Revisar en secuencia.** Al calificar, *‹ Anterior* y *Siguiente ›* (o las flechas del teclado) cambian de alumno sin volver a la lista, el PDF de la entrega se abre junto al formulario y *Guardar y siguiente* avanza solo. *Solo entregas sin calificar* salta a quienes faltan.

**Calificaciones en borrador.** Si desmarcas *Publicar al guardar*, la calificación y los comentarios quedan en borrador: el alumno no los ve. En *Calificaciones*, el botón *Publicar N borradores* de cada actividad los publica todos a la vez. Las calificaciones que ya existían siguen visibles.

**Equipos en lote.** En *Grupos*, *Crear equipos en lote* reparte a los alumnos en N equipos o en equipos de K integrantes (al azar o por orden alfabético, con tamaños equilibrados), o los toma de una lista pegada desde Excel con las columnas *equipo* y *correo*. Muestra la propuesta antes de crear y permite revolverla. *Eliminar categoría* borra todos los equipos de una categoría (los alumnos y sus calificaciones no se tocan).

**Fórmulas.** En instrucciones, materiales, noticias, foros, preguntas y comentarios puedes escribir LaTeX: `$v = v_0 + a t$` dentro del texto y `$$x(t) = x_0 + v_0 t + \tfrac{1}{2} a t^2$$` como ecuación centrada (también `\( … \)` y `\[ … \]`). Para unidades usa `$9.8\,\text{m/s}^2$`. Si necesitas un signo de pesos literal, escribe `\$`. Dentro de los campos de edición se ve el texto tal cual; la fórmula aparece al guardar.

**Entorno de pruebas, respaldos y GitHub.** Ver las secciones correspondientes más abajo.

## Actualizar tu Enlace ya publicado

1. Descarga la versión nueva en una carpeta **nueva** (no encima de la anterior), o `git pull` si trabajas desde GitHub.
2. Haz un respaldo desde esa carpeta: `npm run respaldo`, y de los archivos desde Enlace (ver *Respaldos*).
3. Doble clic en `configurar.cmd` (Windows) o `configurar.command` (Mac), o `npm run configurar`. Encuentra tu base `enlace-db` y tu almacenamiento, usa el correo de administración y la dirección `.workers.dev` de la vez anterior (desde la versión 12.11 los recuerda; la primera vez te los pregunta y revisa que el correo ya haya entrado a Enlace), descarga un respaldo, aplica las migraciones pendientes (0003: asistencia y borradores; 0004: registro con QR; 0005: categorías, rúbricas y equipos; 0006: sesiones; 0007: papelera; 0008: registro de docentes; 0009: aviso de privacidad; 0010: periodos y archivo; 0011: prórrogas; 0012: intentos de evaluaciones; 0013: avisos; 0014: historial de calificaciones; 0015: asistencia con código; 0016: modo examen; 0017: usuarios y registro de acciones; 0018: avisos leídos; 0019: seguimiento del contenido) y publica. No cambia tus claves. Al pasar a la versión 12.1 cada persona vuelve a entrar con Google una vez (las sesiones ahora se registran en el servidor).

**No publiques con `npx wrangler deploy` directamente**: el `wrangler.toml` del ZIP trae valores de ejemplo y quedarías sin la cuenta de administración (`npm run deploy` y `npm run db:migrate` ya lo impiden). Si prefieres hacerlo a mano: copia tu `database_id` y tu correo del `wrangler.toml` anterior al nuevo (y `ALLOWED_EMAIL_DOMAINS` si lo usabas) y ejecuta `npm install`, `npm run db:migrate` y `npm run deploy`, **en ese orden**: si publicas antes de migrar, Asistencia y Calificaciones fallarán hasta que apliques la migración.

## Entorno de pruebas

Una copia independiente de Enlace (`enlace-pruebas.TU-SUBDOMINIO.workers.dev`), con su propia base y sus propios archivos, para probar cambios antes de que los vean tus alumnos. Se configura una sola vez:

```
npx wrangler d1 create enlace-pruebas-db          (pega el id en [[env.pruebas.d1_databases]] de wrangler.toml)
npx wrangler r2 bucket create enlace-pruebas-archivos
npm run db:migrate:pruebas
npm run deploy:pruebas
npx wrangler secret put SESSION_SECRET --env pruebas         (un valor distinto al de producción)
npx wrangler secret put GOOGLE_CLIENT_ID --env pruebas
npx wrangler secret put GOOGLE_CLIENT_SECRET --env pruebas
```

Para generar un `SESSION_SECRET` aleatorio: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Puedes usar el mismo cliente de Google, pero agrega en *Authorized redirect URIs* la dirección `https://enlace-pruebas.TU-SUBDOMINIO.workers.dev/auth/google/callback`. Después, cada cambio se prueba con `npm run db:migrate:pruebas` y `npm run deploy:pruebas`, y solo entonces se publica con `npm run configurar`.

## Respaldos

- **Automáticos (D1 Time Travel).** Cloudflare guarda el historial de la base: puedes regresarla a cualquier minuto de los últimos 7 días en el plan gratuito. `npx wrangler d1 time-travel info enlace-db` muestra el estado actual y `npx wrangler d1 time-travel restore enlace-db --timestamp=2026-10-05T14:00:00Z` la regresa a ese momento (hora UTC). Todo lo posterior a ese momento se pierde, así que antes de restaurar descarga un respaldo.
- **Copias descargadas de la base.** `npm run respaldo` guarda la base completa (cursos, alumnos, calificaciones, asistencia y entregas) en `respaldos/enlace-db-FECHA.sql` y la comprueba: la carga completa en una base temporal de tu computadora y confirma que se puede restaurar. Hazlo cada semana y antes de cada actualización, fuera del horario de clases (en bases grandes, la exportación pausa las consultas unos segundos), y guarda una copia en Google Drive.
- **Copias de los archivos.** En Enlace, *Reportes → Respaldo de archivos → «Respaldar archivos…»* y elige siempre la misma carpeta (Chrome o Edge en computadora). Solo descarga lo nuevo. Hazlo junto con el respaldo de la base.
- **Restaurar la base desde una copia** (si la base se perdió o se dañó y ya pasaron los 7 días de Time Travel):
  1. `npm run restaurar -- respaldos/enlace-db-FECHA.sql`. Comprueba el respaldo en tu computadora, crea la base nueva `enlace-db-restaurada`, la carga y compara todas las filas. Nunca escribe en una base que ya tenga datos. Para otro nombre: `--destino NOMBRE`.
  2. En `wrangler.toml` (primera sección `[[d1_databases]]`) cambia `database_name` por `enlace-db-restaurada` y `database_id` por el id que muestra `npx wrangler d1 list`.
  3. `npm run deploy`. Si usas el respaldo semanal de GitHub, actualiza también el secret `D1_DATABASE_ID`.
  - La exportación de Cloudflare **no** se puede cargar tal cual con `wrangler d1 execute` en una base vacía (falla con «no such table»): usa siempre `npm run restaurar`, que la reordena. Para un simulacro en tu computadora: `npm run restaurar -- ARCHIVO.sql --local` con una base local vacía.
- **Restaurar archivos.** *Reportes → Respaldo de archivos → «Restaurar archivos que falten…»* y elige la carpeta del respaldo. Sube solo lo que falta; si también restauraste la base, hazlo después.
- **Respaldo automático semanal (GitHub Actions).** El flujo `.github/workflows/respaldo.yml` exporta la base cada domingo y la guarda comprimida en un almacenamiento R2 **privado** (`enlace-respaldos`); nunca como archivo de GitHub, porque el repositorio es público. Configuración única:
  1. `npx wrangler r2 bucket create enlace-respaldos` y, para que los respaldos de más de 180 días se borren solos: `npx wrangler r2 bucket lifecycle add enlace-respaldos --expire-days 180` (acepta las opciones que pregunte).
  2. En Cloudflare, *My Profile → API Tokens → Create Token* con permisos **D1: Edit** y **Workers R2 Storage: Edit** para tu cuenta.
  3. En GitHub, *Settings → Secrets and variables → Actions → New repository secret*: `CLOUDFLARE_API_TOKEN` (el token), `CLOUDFLARE_ACCOUNT_ID` (panel de Cloudflare, columna derecha) y `D1_DATABASE_ID` (el `database_id` de tu `wrangler.toml`).
  4. Pruébalo en *Actions → Respaldo semanal → Run workflow*. Cada respaldo se comprueba antes de guardarse. Para descargar uno: `npx wrangler r2 object get enlace-respaldos/NOMBRE.sql.gz --file NOMBRE.sql.gz --remote`, descomprímelo (7-Zip en Windows) y restáuralo con `npm run restaurar`.
- **Vigilancia.** `.github/workflows/vigilancia.yml` revisa cada hora `https://…/salud` (Worker, base de datos y que el correo de administración no sea el de ejemplo). Si Enlace deja de responder, GitHub te avisa por correo (*Settings → Notifications → Actions*). Los flujos con horario solo corren en la rama principal del repositorio.
- Los archivos adjuntos viven en R2, almacenamiento redundante de Cloudflare, pero eso no protege de un borrado por error: respáldalos desde Enlace como se indica arriba. La carpeta tiene trabajos de alumnos; guárdala en un lugar privado.

## GitHub

Crea un repositorio **privado** (tu `wrangler.toml` incluye tu correo) y sube esta carpeta sin `node_modules/` (el archivo `.gitignore` ya lo excluye). El flujo `.github/workflows/pruebas.yml` corre `npm test` en cada cambio: una palomita verde significa que todas las suites pasaron. La publicación automática desde GitHub es posible (en el panel de Cloudflare, en la configuración de *Builds* del Worker), pero mientras te familiarizas conviene publicar a mano con `npm run configurar`, que aplica las migraciones antes de publicar.

## Qué cambió respecto a la versión 8

**Inicio de sesión propio.** La identidad ya no viene de cabeceras `oai-authenticated-*` de ChatGPT Sites (ahora se rechazan). El Worker emite su propia cookie de sesión firmada con HMAC. La forma principal de entrar es "Continuar con Google", que funciona en `*.workers.dev` sin dominio propio. El acceso con enlace por correo está implementado, pero solo se activa si configuras Resend con un dominio verificado: sin dominio, Resend únicamente entrega a tu propio correo.

**Calificaciones en tablas propias.** Actividades, entregas, calificaciones, ponderaciones e intentos de evaluación pasan de JSON genérico en `aula_records` a las tablas `aula_tasks`, `aula_submissions`, `aula_grade_settings` y `aula_attempts`, con llaves foráneas y restricciones en la propia base (por ejemplo, una calificación fuera de 0–10 la rechaza SQLite aunque falle la validación del servidor). Cada calificación registra quién la puso y cuándo. La migración copia los datos sin borrar los originales.

**Administración de docentes desde la interfaz.** Botón "Docentes" en la página de inicio (solo administración): agregar, cambiar entre Docente y Administración, retirar, y ver cursos y último acceso de cada quien. `AULA_OWNER_EMAIL` solo define la cuenta principal.

**Inscripción masiva.** En "Alumnos", el botón "Importar lista" acepta una lista pegada desde Excel o un CSV (nombre, correo y matrícula en cualquier orden).

**Correcciones de la versión 8.**

- `GET /api/courses` hacía tres consultas por curso. En el plan gratuito de D1 el límite es de 50 consultas por solicitud, así que la cuenta de administración dejaba de cargar sus cursos a partir de unos 16. Ahora son 2 consultas sin importar cuántos cursos haya.
- Cada solicitud a la API hacía dos escrituras en la base (una recorría todas las entregas). Ahora hace una sola lectura; la vinculación de inscripciones ocurre al iniciar sesión.
- Un campo ausente en una solicitud (`undefined`) provocaba un error 500 en D1; ahora se trata como vacío y responde el error adecuado.
- El nombre de la cuenta principal estaba fijo en el código.

**Código legible.** Se eliminaron `prototype/`, los archivos de Sites y el código minificado. El servidor está dividido en módulos comentados.

## Estructura

```
src/worker.js              Punto de entrada del Worker (enruta /api, /auth y la interfaz)
src/server/http.js         Respuestas, validación, consultas a D1, tokens firmados
src/server/auth.js         Sesión, Google, enlace por correo, cierre de sesión
src/server/access.js       Permisos por curso
src/server/gradebook.js    Actividades, entregas, calificaciones (y borradores), ponderaciones, intentos
src/server/attendance.js   Asistencia: sesiones, registros, reglas y registro con QR
src/server/grading.js      Categorías, reglas de la calificación final y banco de rúbricas
src/server/api.js          Rutas de la API, equipos en lote y vista previa de archivos
src/public/                Interfaz (HTML, CSS, JS). Versión 10: attendance.js, preview.js, teams.js, math.js. Versión 12.1: trash.js. Versión 12.2: richtext.js, compress.js, contenido.css. Versión 12.3: tema.css. Versión 12.4: registro.js.
                           Versión 11: qr.js, checkin.js, zip.js, risk.js. Versión 12: grading.js, rubrics.js
src/public/vendor/         pdf.js, KaTeX y la fuente Inter, con sus licencias
src/generated/             Interfaz incrustada; la genera `npm run build` (no se edita)
drizzle/                   Migraciones SQL (0000 a 0008) y metadatos
db/schema.ts               Descripción del esquema con Drizzle
scripts/                   Compilación, configuración, respaldos y pruebas
.github/workflows/         Pruebas automáticas en GitHub
```

## Poner Enlace en tu cuenta de Cloudflare

Necesitas Node.js 22.13 o superior, una cuenta gratuita de Cloudflare y una cuenta de Google.

**1. Instalar dependencias.** En esta carpeta ejecuta `npm install` (no `npm ci`: el archivo de bloqueo se genera en este paso).

**2. Conectar Wrangler con tu cuenta.** `npx wrangler login` abre el navegador para autorizar.

**3. Crear la base de datos.**

```
npx wrangler d1 create enlace-db
```

Copia el `database_id` que imprime y pégalo en `wrangler.toml`.

**4. Crear el almacenamiento de archivos.**

```
npx wrangler r2 bucket create enlace-archivos
```

Si Cloudflare indica que R2 no está activo, actívalo primero desde el panel (sección R2). Puede pedir un método de pago aunque no rebases el nivel gratuito.

**5. Poner tu correo de administración.** En `wrangler.toml`, cambia `AULA_OWNER_EMAIL` por el correo de tu cuenta de Google. Debe ser exactamente ese correo: es con el que entrarás.

**6. Crear las tablas.** `npm run db:migrate`

**7. Primer despliegue.** `npm run deploy`. Al terminar muestra tu dirección, del tipo `https://enlace.TU-SUBDOMINIO.workers.dev`. Todavía no podrás entrar: faltan los pasos 8 y 9.

**8. Crear el acceso con Google** en [console.cloud.google.com](https://console.cloud.google.com):

1. Crea un proyecto (por ejemplo, "Enlace BUAP").
2. Entra a *Google Auth Platform*. En *Branding* pon el nombre "Enlace" y tu correo de soporte.
3. En *Audience* elige *External*.
4. En *Clients* → *Create client* → tipo *Web application*. En *Authorized redirect URIs* agrega:
   - `https://enlace.TU-SUBDOMINIO.workers.dev/auth/google/callback`
   - `http://localhost:8787/auth/google/callback` (para pruebas en tu computadora)
5. Guarda el *Client ID* y el *Client secret*.
6. La app empieza en modo *Testing*: solo pueden entrar los correos que agregues como usuarios de prueba (máximo 100). Para abrirla a todos los alumnos, en *Audience* pulsa *Publish app*. Como Enlace solo pide nombre y correo (`openid email profile`), Google no exige revisión para publicarla.

**9. Guardar los secretos en Cloudflare.**

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put SESSION_SECRET        (pega la cadena que imprimió el comando anterior)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

**10. Entrar.** Abre tu dirección, pulsa "Continuar con Google" con el correo del paso 5 y entrarás como administración. En "Docentes" agrega a tus colegas con el correo de su cuenta de Google.

Para cambios posteriores basta con `npm run deploy`. Si una versión futura trae una migración nueva, ejecuta antes `npm run db:migrate`.

### Opcional: solo correos institucionales

En `wrangler.toml` descomenta `ALLOWED_EMAIL_DOMAINS` (por ejemplo `alumno.buap.mx,correo.buap.mx`). Quien intente entrar con otro correo verá "Entra con tu correo institucional de la BUAP". Úsalo solo si todas las personas tienen su correo institucional como cuenta de Google.

### Opcional: acceso con Microsoft (correo institucional)

Si el correo de la BUAP está en Microsoft 365, el botón **Continuar con Microsoft (correo BUAP)** aparece arriba de Google. Solo acepta cuentas del directorio de la BUAP (no de otras organizaciones) y correos `@correo.buap.mx`, `@alumno.buap.mx` o `@buap.mx` (se cambia con `MICROSOFT_EMAIL_DOMAINS`). Quien antes entraba con Google con el mismo correo conserva su cuenta y sus cursos.

Hay que registrar Enlace en el directorio de la BUAP. Puede requerir que el área de TI de la BUAP lo apruebe o lo haga por ti:

1. En [portal.azure.com](https://portal.azure.com) → *Microsoft Entra ID* → *App registrations* → *New registration*.
2. Nombre: `Enlace`. *Supported account types*: **Accounts in this organizational directory only**.
3. *Redirect URI*: tipo **Web**, `https://enlace.TU-SUBDOMINIO.workers.dev/auth/microsoft/callback` (y `http://localhost:8787/auth/microsoft/callback` para pruebas locales).
4. En *Certificates & secrets* → *New client secret*; copia el **Value** (solo se muestra una vez; anota cuándo vence para renovarlo).
5. En *Overview* copia el **Application (client) ID** y el **Directory (tenant) ID**.
6. Guarda los datos:

```
npx wrangler secret put MICROSOFT_CLIENT_ID
npx wrangler secret put MICROSOFT_CLIENT_SECRET
```

y en `[vars]` de `wrangler.toml` agrega `MICROSOFT_TENANT_ID = "el Directory (tenant) ID"`. Publica con `npm run deploy`. Por seguridad, Enlace no activa Microsoft si el tenant es `common` u `organizations`.

**Pantalla de acceso con Microsoft activo:** solo aparece «Continuar con Microsoft (correo BUAP)». El acceso con Google sigue funcionando, pero ya no se ofrece en la pantalla: quien lo necesite (por ejemplo, la cuenta de administración si es de Gmail) entra por `https://enlace.enlace-academia.workers.dev/?acceso=google`. Una cuenta de Microsoft y una de Google con correos distintos son cuentas distintas en Enlace: si quieres administrar con tu correo BUAP, ponlo en `AULA_OWNER_EMAIL` o agrégalo como Administración en *Docentes*.

### Opcional: acceso con enlace por correo

Requiere un dominio propio verificado en [Resend](https://resend.com). Con el dominio listo:

```
npx wrangler secret put RESEND_API_KEY
```

y agrega en `[vars]` de `wrangler.toml` una línea `EMAIL_FROM = "Enlace <aula@tu-dominio.mx>"`. La pantalla de acceso mostrará el formulario de correo automáticamente. Cada enlace vence en 20 minutos y sirve una sola vez; se permiten 3 envíos por correo cada 15 minutos.

## Trabajar en tu computadora

```
cp .dev.vars.example .dev.vars        (y llena SESSION_SECRET, GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)
npm run db:migrate:local
npm run dev                           (abre http://localhost:8787)
```

La cookie de sesión usa el prefijo `__Host-`, que exige conexión segura. Chrome y Firefox tratan `localhost` como seguro; si en tu navegador la sesión no se conserva, usa `npx wrangler dev --local-protocol https`.

## Pruebas

`npm test` compila la interfaz y ejecuta veintiséis suites con una base SQLite temporal (con llaves foráneas activas, como D1). No tocan tu base real.

- `test-api.mjs`: todas las verificaciones de la versión 8 más sesiones firmadas, cabeceras falsificadas, ponderaciones, restricciones de la base, docentes, inscripción masiva y el límite de 50 consultas.
- `test-papelera.mjs`: eliminar y restaurar contenido, actividades (con sus entregas y calificaciones), evaluaciones y publicaciones de foro; permisos de moderación; nombres de alumnos en foros; cuotas de archivos.
- `test-registro.mjs`: catálogo de academias y unidades, solicitud con correo institucional, aprobación o rechazo, y clasificación de docentes y cursos.
- `test-contenido.mjs`: archivos en unidades (con permisos según la visibilidad) y mostrar u ocultar con un toque.
- `test-movil-ui.mjs`: direcciones de cada pantalla (botón «Atrás»), barra inferior y menú «Más», tablas como tarjetas, «Mis calificaciones» del alumno y el PDF que se arma con las fotos.
- `test-formato-ui.mjs`: texto con formato, fórmulas intactas y protección contra HTML, enlaces `javascript:` e imágenes externas.
- `test-auth.mjs`: flujo completo de Google y del enlace por correo con respuestas simuladas (estado, nonce, audiencia, correo verificado, dominios, redirecciones abiertas, uso único, revocación en el servidor, cierre de sesión por dispositivo y en todos los dispositivos).
- `test-migration.mjs`: genera datos con el servidor de la versión 8 real (`scripts/fixtures/server-v8.js`), aplica la migración 0002 y comprueba con la versión 9 que todo llegó idéntico.
- `test-fase1.mjs`: asistencia (permisos, calendario, registros, borrado en cascada), borradores de calificación, equipos en lote y vista previa (tipo real del archivo, descargas parciales para video, permisos).
- `test-fase2.mjs`: registro con QR (firma que caduca, códigos alterados o del futuro, PIN con intentos limitados, un teléfono por alumno, permisos robados, retardos, cierre y reapertura).
- `test-fase2b.mjs`: categorías (validaciones, borrado sin perder actividades), reglas finales, banco de rúbricas (propias, compartidas, solo el autor edita), evaluación con rúbrica oculta en borrador, y entregas por equipo (archivos visibles solo para el equipo, calificación de equipo y ajuste individual).
- `test-periodos.mjs`: copiar un curso a un nuevo periodo (contenido, actividades, reglas y archivos compartidos, sin alumnos ni entregas) y archivar en solo lectura.
- `test-codocentes.mjs`: co-docentes (alta, permisos, retiro) y prórrogas individuales.
- `test-evaluaciones.mjs`: evaluador de fórmulas seguro, preguntas numéricas con datos por alumno y tolerancia, intentos, tiempo límite y confidencialidad de respuestas.
- `test-pendientes.mjs`: mis pendientes, avisos (sin contenido oculto) y comprobante con folio.
- `test-reportes.mjs`: historial de calificaciones, reportes por academia y unidad y limpieza de archivos sin usar (incluidos los compartidos entre cursos copiados).
- `test-asistencia-codigo.mjs`: registro con código (ubicación sin guardar coordenadas, red, por revisar, modo estricto, cambio de código y QR intacto).
- `test-examen.mjs`: modo examen (contraseña con bloqueo, datos ocultos al alumno, ubicación, respuestas guardadas, sin regresar respetado por el servidor, salidas registradas y monitor).
- `test-curso-ejemplo.mjs`: curso de ejemplo completo en una solicitud, alumnos ficticios, permisos y límite.
- `test-configurar.mjs`: no se publica ni se migra con los valores de ejemplo; `configurar` verifica el correo contra la base y recuerda los datos entre versiones (con un wrangler simulado).
- `test-respaldo-archivos.mjs`: respaldo de archivos solo para administración, incremental, con índice; restauración solo de lo que falta y con el tamaño exacto.
- `test-restaurar.mjs`: la exportación de D1 se reordena y comprueba con el esquema real; `npm run restaurar` solo escribe en bases vacías.
- `test-programacion.mjs`: publicación programada por todas las vías (curso, descargas, foro, evaluación, avisos), evaluaciones en la calificación (validación y cálculo real: mejor, último, promedio) y seguimiento del contenido.
- `test-calendario.mjs`: calendario con fechas por alumno (prórrogas), estado de entrega, sin lo oculto ni lo archivado, vista del docente; avisos leídos uno por uno o todos, historial y archivo .ics.
- `test-usuarios.mjs`: la vista de un alumno es idéntica a la suya y queda registrada; directorio, suspender y reactivar sin perder datos, transferir cursos.
- `test-qr.mjs`: generador de QR. Sus huellas corresponden a códigos que se decodificaron con OpenCV; si una cambia, hay que volver a verificarlo.
- `test-auth-ui.mjs`, `test-admin-ui.mjs`, `test-teacher-files.mjs`, `test-workspace-ui.mjs`, `test-fase1-ui.mjs`, `test-fase2-ui.mjs`, `test-fase2b-ui.mjs`: interfaz (incluye las reglas del porcentaje de asistencia, el reparto de equipos, la revisión en secuencia, la exportación a Excel sin fórmulas inyectadas, que la firma del QR del navegador sea la que acepta el servidor, el ZIP verificado por un lector independiente, las reglas de riesgo, el cálculo por categorías y puntos, el redondeo de la calificación final y la evaluación con rúbrica).

## Datos de la versión 8

La base de ChatGPT Sites pertenece a ese alojamiento; este Worker no puede conectarse a ella. Como el inicio de sesión allí nunca funcionó, lo más probable es que no haya datos reales que traer. Si en algún momento tienes una base D1 con datos de la versión 8, `npm run db:migrate` aplica la migración 0002 y esta consulta confirma que no quedó nada sin copiar (las dos columnas deben coincidir):

```sql
SELECT r.kind,
       count(*) AS originales,
       CASE r.kind WHEN 'task' THEN (SELECT count(*) FROM aula_tasks)
                   WHEN 'submission' THEN (SELECT count(*) FROM aula_submissions)
                   WHEN 'attempt' THEN (SELECT count(*) FROM aula_attempts) END AS migrados
FROM aula_records r WHERE r.kind IN ('task', 'submission', 'attempt') GROUP BY r.kind;
```

Las cuentas de la versión 8 se conservan: al entrar con Google con el mismo correo, la persona recupera sus cursos, entregas y calificaciones.

## Límites del plan gratuito de Cloudflare

Workers: 100 000 solicitudes al día y 3 MB por Worker comprimido (Enlace ocupa cerca de 1.1 MB, incluidos pdf.js y KaTeX). D1: 5 GB, 5 millones de filas leídas y 100 000 escritas al día, 50 consultas por solicitud. R2: 10 GB sin costo por descarga. Para una academia con varios cientos de alumnos es holgado; las rutas se diseñaron para quedar muy por debajo de las 50 consultas.

## Estado conocido

- En producción está publicada la versión 11 (septiembre de 2026). La versión 12.1 pasó las pruebas automáticas y se recorrió en `wrangler dev` con D1 local y Chromium (papelera, moderación de foros, perfil de alumno, cierre de sesión). Las versiones 10, 11 y 12 pasaron todas las pruebas automáticas y se recorrieron en Chromium real (incluido el QR leído desde la pantalla y el registro desde un navegador de tamaño teléfono), pero no se han probado contra tu Cloudflare, tu Google ni en un iPad o iPhone reales: conviene probarlas primero en el entorno de pruebas o con un curso de prueba.
- Bibliotecas incluidas, sin modificar: pdf.js 5.6.205 (Apache 2.0), KaTeX 0.16.45 (MIT) y la fuente Inter 5.3.0 (SIL OFL 1.1), en `src/public/vendor/` junto con sus licencias.
- No hay integración con Turnitin.
- La versión 12.6 pasó las 23 suites y se recorrió en `wrangler dev` con D1 local y Chromium (también en tamaño teléfono). El acceso con Microsoft se probó con respuestas simuladas: la primera prueba real requiere el registro en el directorio de la BUAP.
- Siguientes pasos posibles: vista previa de Word, Excel y PowerPoint; dividir `app.js` y las capas de estilos antiguas en archivos por sección; pruebas en iPad y iPhone reales.
