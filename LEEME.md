# Enlace · versión 12.51

Plataforma académica independiente para docentes y alumnos de cualquier academia (nació en la Academia de Física de la BUAP), con interfaz inspirada en Brightspace.
No es el código de D2L Brightspace ni una plataforma oficial de la BUAP.

Esta versión se despliega en **tu propia cuenta de Cloudflare** (Workers + D1 + R2, plan gratuito) y ya no depende de ChatGPT Sites.

## Novedades de la versión 12.51 (calificación máxima por columna)

- **Requiere migración** (0037, solo agrega la columna `max_score` a `aula_tasks`; `npm run configurar` la aplica con respaldo previo).
- En el libro, el menú ⌄ de cada actividad tiene «Calificación máxima…». Si un examen fue sobre 9, pones 9 y capturas los puntos tal cual: 6 de 9 se guarda como 6.67 sobre 10, igual que en Brightspace. El encabezado dice «sobre 9».
- Las calificaciones ya capturadas conservan sus puntos y se recalculan: un 6 que ya estaba pasa a 6 de 9 = 6.67. Si después cambias el máximo a 12, queda 6 de 12 = 5. Cada cambio queda en el historial de calificaciones («calificación máxima»).
- El promedio, los rubros, los colores y lo que ve el alumno usan el valor sobre 10.

## Novedades de la versión 12.50 (bloques por rubro en el libro)

- En el libro de calificaciones, las actividades se agrupan por rubro, como en Brightspace (T1, T2…): por ejemplo «Parcial 1 · Tareas» y «Parcial 1 · Laboratorio» tienen cada uno su bloque, con sus actividades juntas y una columna **Subtotal** al final del bloque (es la misma casilla de rubro de antes: puedes capturarla a mano).
- Con el botón ⊟ / ⊞ del encabezado se contrae un bloque para ver solo su subtotal; se recuerda por curso en tu navegador.
- Las actividades sin rubro quedan en un bloque «Sin rubro» al final.
- «Actividad no encontrada o repetida» ya no aparece: si una actividad se eliminó con la pantalla abierta, se ignora al guardar, y si algo está repetido, el mensaje dice cuál (actividad, evaluación o foro).

## Novedades de la versión 12.49 (fecha en el libro)

- En el libro de calificaciones, cada actividad muestra su fecha debajo del nombre.
- Al importar calificaciones con la fila «Fecha», la fecha del archivo ahora reemplaza la que ya tuviera la actividad (antes solo se ponía si no tenía fecha; por eso las actividades importadas en 12.46 conservaban la fecha de la importación). Vuelve a importar el archivo para corregirlas.

## Novedades de la versión 12.48 (faltas automáticas)

- Al cerrar el registro de asistencia (QR o código), los alumnos de la clase que no se registraron quedan como **falta** con la nota «No se registró». Si el registro vence sin cerrarlo, las faltas se completan la próxima vez que alguien abre la asistencia del curso.
- Cada registro se completa una sola vez: si después cambias una falta a justificada o asistencia, no se vuelve a poner. Las marcas que ya capturaste a mano no se tocan.
- Los registros que ya cerraste antes de esta versión también se completan al abrir la asistencia (sin migración).

## Novedades de la versión 12.47 (importar con fecha)

- El archivo de calificaciones puede traer una fila **«Fecha»** debajo de los encabezados (en la columna de los alumnos dice «Fecha» y en cada actividad su fecha, por ejemplo 2026-09-03). Esa fila no se toma como alumno.
- La fecha llega a las 23:59 de ese día:
  - las actividades nuevas la toman como su fecha;
  - una actividad que ya existía **sin fecha** también la recibe;
  - si ya tenía fecha, no se cambia.
- En la vista previa de la importación se ve la fecha de cada columna. Si una columna no trae fecha, toma la de la importación.

## Novedades de la versión 12.46

- **Administrar calificaciones → «Qué cuenta en cada categoría»:** ahora tiene el filtro de grupos. Con un grupo elegido solo se ven sus actividades, evaluaciones y foros, y los de todo el curso. Lo que no se ve conserva su categoría al guardar.
- **Importar calificaciones:** cada actividad nueva que se crea al importar lleva como fecha el día y la hora de la importación. Antes quedaba sin fecha.

## Novedades de la versión 12.45 (cada grupo con sus propias actividades)

- **Qué pasaba:** al importar calificaciones eligiendo una sección (por ejemplo 5CV), cada columna se unía sola a la actividad del mismo nombre que ya existía en otra sección (5BV), y esa actividad quedaba compartida por los dos grupos. Por eso, al eliminarla desde un grupo, desaparecía también del otro.
- **Importar:** con una sección elegida, solo se une una columna a una actividad que sea exactamente de esa sección. Si no hay ninguna, se propone una actividad nueva solo para ese grupo. En «Va a» todavía puedes elegir a mano otra actividad.
- **Eliminar una actividad compartida** con el libro filtrado a un grupo: primero pregunta si quieres quitarla **solo de ese grupo**. Las demás secciones la conservan con sus entregas y calificaciones. Si cancelas, ofrece eliminarla para todas.
- **Recuperar lo eliminado:** nada se borra. Ve a Administración del curso → Papelera → «Restaurar» en cada actividad. Vuelven con sus entregas y calificaciones y con sus secciones de antes.

## Novedades de la versión 12.44 (parcial en curso)

- Un parcial cuenta en el **promedio parcial** solo cuando todos sus rubros tienen calificación. Por ejemplo, el Parcial 2 con tareas pero sin examen aún no se promedia: ya no aparece como un 5 que baja el promedio. Mientras falten rubros:
  - el alumno lo ve como «En curso» en «Por parcial»;
  - en el libro de calificaciones también dice «En curso» (al pasar el cursor se ve lo que lleva);
  - el promedio parcial sale solo de los parciales completos.
- Si todavía ningún parcial está completo (al empezar el semestre), el promedio usa lo que lleva cada uno, como antes.
- La **calificación final** no cambia: cada parcial conserva su peso y los rubros vacíos cuentan 0.

## Novedades de la versión 12.43 (colores de las actividades en el libro)

- Cada casilla de actividad se colorea según la calificación, como en Brightspace:
  - un 10 sale en verde intenso, y el verde se aclara conforme baja la calificación hasta la mínima aprobatoria;
  - debajo de la mínima, la casilla pasa a naranja y luego a rojo;
  - si el alumno no entregó y la fecha ya venció (con su prórroga o la de su sección), la casilla sale en rojo («Sin entregar»).
- Quedan sin color lo entregado sin calificar y lo que aún no vence. La cifra reprobatoria sigue subrayada, así que no depende solo del color.

## Novedades de la versión 12.42

- El libro de calificaciones y su exportación a Excel muestran a los alumnos en orden alfabético por nombre (sin distinguir acentos ni mayúsculas). Las demás listas no cambian.

## Novedades de la versión 12.41 (revisión con ui-ux-pro-max)

- **Botones y casillas más fáciles de tocar en el celular.** Los controles miden ahora al menos 44 px: botones de texto, casillas del libro, campana, perfil, asistencia, menús y fechas. En la computadora, ningún enlace o botón mide menos de 24 px de alto. Los controles chicos pasaron de unos 300 a 59, y los que quedan ya tienen 44 px de alto, solo son angostos (por ejemplo, las fechas de asistencia).
- **Textos de al menos 12 px.** Antes medían 11 px los contadores, las etiquetas de estado («sin revisar», «tardía», «borrador»), el pie de página y los nombres de la barra inferior.
- **Lector de pantalla:** ya no se vuelve a leer toda la pantalla con cada cambio. Al pasar a otra pantalla, el foco va a su título.
- **Contenido en el celular (docente):** el título del material, «Completado por…» y «Visible para alumnos / Editar» se encimaban. Ahora las acciones van en su propia fila.
- Sin migraciones.

## Novedades de la versión 12.40

- La raya gruesa del libro ahora va a la derecha de «Calificación final»: la separa de los rubros que siguen (Parcial 1 · Exámenes…), no de Parcial 2.

## Novedades de la versión 12.39 (calificación final después de los parciales)

- En el libro de calificaciones, la columna **Calificación final** va ahora después de Parcial 1 y Parcial 2, separada con una raya más gruesa.
- Su encabezado dice de dónde sale:
  - «Promedio de Parcial 1 y Parcial 2» si los parciales pesan igual;
  - «Ponderado: Parcial 1 40 % y Parcial 2 60 %» si pesan distinto o hay rubros de toda la materia.
- El cálculo no cambia. Sin migraciones.

## Novedades de la versión 12.38 (tu 12.30 local + 12.37, redondeo y colores del libro)

- **Una sola versión.** La 12.30 que estaba publicada salió de una copia local (sobre la 12.29) que nunca llegó a GitHub, con cambios propios. Esta versión los junta con todo lo de 12.30 a 12.37 de GitHub, y desde ahora se publica **solo desde la versión de GitHub**. Se conservan de la copia local:
  - ocultar un curso a los alumnos;
  - los índices para leer menos de D1 (migraciones 0033 a 0036, que ya están aplicadas en producción);
  - mover las columnas del libro;
  - escribir a mano la calificación de un rubro;
  - la configuración reforzada del examen y el aviso sobre Gemini y Google Assistant;
  - traer alumnos de otro curso.
- **Examen: la versión de GitHub, más una protección de tu copia local.** Del cambio de pregunta se queda la de GitHub (12.31 y 12.32): confirmación dentro de la página y respeto de Safe Exam Browser. De tu copia local se agrega una protección: abrir un menú de opciones (relacionar u ordenar) ya no cuenta como salida ni como salida de pantalla completa.
- **Redondeo de la calificación final y de cada parcial** (siempre entero):
  - reprobatoria: baja al entero (5.9 → 5);
  - aprobatoria: sube si la parte decimal pasa de .55 (6.56 → 7) y baja de .00 a .55 (6.55 → 6).
- **Libro de calificaciones:**
  - cada casilla se pinta en rojo (debajo de la mínima aprobatoria) o en verde (aprobada), como en Brightspace;
  - la reprobatoria además va subrayada;
  - la columna de nombres queda fija con fondo sólido y ya no se encima con las demás al desplazarse a los lados.
- **Publicar:** sin migraciones nuevas. Descarga el ZIP de GitHub (rama `claude/plataforma-enlace-project-9ugeud`) y corre `npm run configurar` **desde esa carpeta**. Al publicar debe decir 12.38.0, no 12.30.

## Novedades de la versión 12.37 (rediseño visual «Colección»)

Enlace tiene una imagen nueva. Solo cambia la apariencia: funciones, textos y datos son los mismos, y no hay migraciones.
- **Cada curso es un tomo de una colección**, con su propia tinta de imprenta (cobalto, verdete, granza, ciruela, ocre o musgo; es el color que ya tenía asignado cada curso o el que elegiste en «Editar curso y portada»). Dentro de un curso, la barra, las pestañas y el botón principal toman esa tinta, así se sabe de un vistazo en qué grupo estás.
- **Mis cursos** es un estante de portadas: el nombre del curso en grande sobre su tinta, con el lomo a la izquierda. Toda la portada abre el curso.
- **Logotipo nuevo**: tres lomos de colores que forman una E. También cambian el ícono de la pestaña y el de la app instalada en el celular (puede tardar en actualizarse hasta que el teléfono vuelva a cargar Enlace).
- **Tipografía nueva** (Archivo), servida desde Enlace mismo: títulos condensados y fuertes, cifras alineadas en las tablas. La página pesa menos que antes.
- Los contadores de avisos van en amarillo, y en el libro de calificaciones solo lo reprobatorio va en rojo.

Antes de publicar, revisa en tu navegador Mis cursos, un curso, el libro de calificaciones y un examen en el celular.

## Novedades de la versión 12.36 (revisión de diseño con impeccable)

Cambios de la revisión de diseño (`.impeccable/critique/`, calificación inicial 26/40). Solo interfaz; sin cambios de servidor ni de base de datos.

**Evaluaciones en el celular**
- El encabezado del intento (tiempo restante, «3 de 5 contestadas» y guardado) se queda fijo arriba mientras el alumno baja por las preguntas.
- Avisos cuando quedan 5 minutos y 1 minuto (también para lectores de pantalla).
- Antes de enviar, Enlace pregunta y dice cuántas preguntas faltan; el envío automático cuando se acaba el tiempo no pregunta.
- Al enviar, la pantalla lleva directamente al resultado del intento (antes solo salía un aviso que desaparecía).
- Las opciones de respuesta son más grandes y toda la fila se marca al elegirla; el enunciado ya no queda montado sobre el borde.

**Qué sigue (alumno)**
- El número de la pestaña Actividades del celular ahora es el mismo que «Por entregar» del inicio (antes contaba también lo vencido hace tiempo y actividades que no se entregan).
- En Actividades el alumno ve primero lo que está por entregar (lo más próximo arriba), después lo vencido («Venció el …») y al final lo entregado. «Sin calificar» reemplaza a «Pendiente».

**Docente**
- Libro de calificaciones: la tabla usa el alto de la ventana, su encabezado queda fijo y la ayuda empieza plegada (recuerda si la abres). Si el curso tiene «lo no entregado cuenta como 0», la columna de calificación final lo indica.
- «Visible para alumnos» se ve discreto (es lo normal); destacan «Oculto» y «Programado». «Retirar» alumno aparece en rojo y separado de «Editar».
- En cada evaluación, Duplicar, Exportar a Excel y Guardar en el banco están en «Más acciones». «Seguimiento en vivo» solo aparece en modo examen.
- Los reactivos muestran los datos por alumno como variables (*F*, *m*) y la respuesta como fórmula. Los materiales tienen ícono según su tipo (enlace o simulador, archivos, texto).

**Accesibilidad**: anillo de foco visible al usar el teclado, y el contador de avisos, las iniciales y el número del menú inferior con contraste suficiente.

**Pendiente de tu decisión**: el rediseño visual completo (nuevo estilo y logo) que elegiste en la revisión. *impeccable* primero define contigo la nueva dirección visual antes de tocar pantallas.

## Novedades de la versión 12.35 (revisión de diseño y accesibilidad)

Ajustes de apariencia tras revisar las pantallas principales en computadora y en teléfono; no cambia nada de cómo funciona:
- **Textos grises más legibles**: los textos secundarios (fechas, conteos, el pie de página, «Aula virtual · BUAP») ahora tienen el contraste mínimo de accesibilidad (WCAG AA). También las etiquetas pequeñas sobre fondos grises.
- **Calificaciones**: la pantalla tiene su título y la explicación de cómo se calcula queda en un apartado que se puede plegar (en el teléfono empieza plegado, para ver la tabla de inmediato). Las pestañas ya no se apilan en el teléfono.
- **Contenido en el teléfono**: las unidades son una fila que se desliza, así los materiales se ven desde el inicio.
- **Detalles**: el nombre largo del curso termina en «…» en el teléfono; «1 material» en singular; ya no aparece «0 archivos» en materiales sin archivos; en Actividades, «17 calificadas» ya no se separa; enlaces y botones de texto más fáciles de tocar; el pie de página queda siempre al fondo.

Nota: en el libro de calificaciones, un alumno sin entregas vencidas aparece con **0.0** en la calificación final cuando el curso tiene activada la regla «lo no entregado cuenta como 0» (Administrar calificaciones). Es correcto: el promedio parcial sí muestra «—».

## Novedades de la versión 12.34 (revisión de seguridad)

Se hizo una revisión de seguridad completa (servidor, interfaz y repositorio público). No se encontró nada que permita entrar sin cuenta, ver otro curso, ni secretos en el repositorio. Se corrigió lo siguiente; no hay migraciones ni cambios de base de datos:
- **Cursos archivados**: un alumno o co-docente podía seguir escribiendo en un curso archivado con una solicitud armada a mano (por ejemplo, volver a entregar y borrar su calificación). Ahora un curso archivado es de solo lectura sin excepción.
- **Enviar una evaluación sin «Comenzar»**: en evaluaciones sin tiempo límite ni modo examen se podía enviar fuera de fechas o sin el código de la sección. Ahora se revisan siempre las fechas, y con código hay que empezar el intento.
- **Códigos y PIN**: el tope de códigos equivocados (examen, desbloqueo y PIN de asistencia) se podía rebasar mandando muchas solicitudes al mismo tiempo. Ahora cada intento se cuenta antes de compararlo.
- **Cuotas de archivos**: varias subidas al mismo tiempo podían rebasar los 300 MB por alumno (y llenar el almacenamiento). Ahora el lugar se aparta antes de guardar el archivo.
- **Co-docentes**: un co-docente podía quitar o convertir en alumno a otro co-docente desde la lista de alumnos. Ahora solo el propietario cambia a los co-docentes; volver a importar la lista no los toca.
- **Exportaciones CSV de administración** (reporte y respaldo de archivos): un nombre de archivo que empiece con `=`, `+`, `-` o `@` ya no se ejecuta como fórmula al abrirlo en Excel.
- Detalles menores: el calendario `.ics` descargado, pesos de actividades ocultas que llegaban al alumno, y errores 500 por direcciones mal formadas.

**Importante sobre Safe Exam Browser (límite conocido)**: con «Exigir Safe Exam Browser», Enlace arma la configuración de SEB y comprueba que cada solicitud traiga la llave de esa configuración. Esa llave se calcula con datos que no son secretos (el código de Enlace es público), así que **un alumno con conocimientos técnicos podría imitarla y presentar desde un navegador normal**. Es la misma limitación de la configuración automática de Moodle. Úsalo como medida **disuasiva** (detiene a la gran mayoría y deja registro), no como garantía. Pegar la Config Key de un archivo .seb propio en «Avanzado» tampoco lo cierra por ahora, porque la llave de Enlace se sigue aceptando. Si en algún examen necesitas certeza total, combínalo con vigilancia presencial (salón y monitor), o pide que se agregue la opción de exigir solo la Browser Exam Key de tus equipos.

## Novedades de la versión 12.33 (importar preguntas con imágenes)

**Importar con imágenes**: en «Importar examen» (Evaluaciones) y en «Importar al banco» ahora se puede elegir un **.zip** con las preguntas y sus imágenes, como el paquete de Brightspace:
- el CSV de Brightspace con su renglón `Image` (o la imagen dentro del enunciado en HTML);
- un Word, Excel o texto con «Imagen: figura1.png» (en Excel, la columna Imagen).

En un **Word**, la imagen que pongas debajo de la pregunta se importa con ella; el logotipo del encabezado no cuenta. En la vista previa aparece la miniatura de cada imagen. Las imágenes se suben como material del curso al pulsar «Agregar» (o «Guardar en el banco»), y una imagen que usan varias preguntas se sube una sola vez.

**Grupos desde el archivo**: en Word, Excel o texto, «Grupo: Vectores» (columna Grupo en Excel) pone la pregunta en ese grupo para sortear. Así se arma un banco con preguntas al azar sin capturar nada a mano.

No requiere migración.

## Novedades de la versión 12.32 (pasar de pregunta sin «salidas», revisar en rojo, calificar en bloque y copiar la configuración)

**Examen en el celular**: con «una pregunta a la vez» y «sin regresar», al pasar a la siguiente pregunta el navegador mostraba su propia ventana de confirmación. En el celular esa ventana le quita el foco a la página, y Enlace lo contaba como una salida; con tres salidas se bloqueaba el examen. Ahora la confirmación aparece dentro de la página y pasar de pregunta ya no cuenta como salida. Además, un parpadeo del foco de menos de 0.6 s (al tocar la pantalla o abrir el teclado) no se cuenta. Lo demás se cuenta igual:
- cambiar de aplicación o de pestaña, o bloquear el teléfono, cuenta en ese momento aunque dure un instante;
- pantalla dividida, ventana flotante o bajar las notificaciones cuentan desde el primer instante si duran más de 0.6 s;
- sigue el bloqueo a la 3.ª salida corta;
- recargar la página o cerrar el navegador no quita el bloqueo.

Se probó con Android y iPhone emulados en el navegador; conviene confirmarlo en un teléfono real antes de un examen.

**Libro de calificaciones**: una entrega que **aún no revisas** (sin calificación, o entregada de nuevo después de calificarla) aparece **en rojo**, con la leyenda «sin revisar». Cada columna dice cuántas le faltan por revisar. En la página de la actividad dice «Entregado · sin revisar».

**Calificar en bloque**: en el menú ⌄ de cada columna del libro, o con el botón «Calificar en bloque» de la actividad. Eliges a todo el grupo, solo a quienes no tienen calificación, o a los alumnos que marques. Escribes una calificación y, si quieres, un comentario; decides si queda publicada o como borrador. Las calificaciones ya capturadas **no se reemplazan** salvo que marques la casilla. Queda en el historial de calificaciones.

**Aplicar la configuración a otros grupos**: en Calificaciones → Administrar calificaciones, el botón **«Aplicar a otros grupos»** copia la configuración a los grupos que elijas:
- parciales, categorías (pesos, distribución y calificaciones que no cuentan) y reglas de la calificación final;
- la categoría, el valor y el peso de cada actividad, y la categoría de cada evaluación, cuando se llamen igual en el otro grupo.

La configuración de esos grupos se reemplaza: sus categorías que no existan en el curso de origen se quitan, pero una categoría con el mismo nombre se conserva, junto con sus actividades. Las calificaciones capturadas no se tocan. Las secciones de un mismo curso ya comparten la configuración: esto es para grupos que son cursos distintos.

No requiere migración.

## Novedades de la versión 12.31 (sin bloqueos falsos dentro de Safe Exam Browser y resumen de la evaluación)

**Safe Exam Browser**: dentro de SEB, tocar su barra, sus avisos o cualquier parte de su ventana hacía que la página «perdiera el foco», y eso se contaba como salida y bloqueaba el examen. Ahora, cuando el alumno presenta dentro de Safe Exam Browser (verificado por Enlace), **no se cuentan salidas ni se bloquea**: SEB ya impide salir del examen. Tampoco se pide pantalla completa (SEB ya la ocupa). Fuera de SEB todo sigue igual.

**Resumen en la evaluación** (para ti, en toda evaluación, no solo en modo examen): arriba de las preguntas aparece «Seguimiento en vivo» (o «Resumen de la evaluación» cuando ya cerró), que se actualiza solo cada 10 segundos:
- cuántos **terminaron**, cuántos están **contestando**, **bloqueados** y los que **no han empezado**, el **promedio** y cuántos **aprobaron**;
- la lista de **quienes ya terminaron con su calificación** (la mejor si tuvo varios intentos), aciertos, intentos y hora de envío;
- los nombres de quienes no han empezado.

No requiere migración.

## Novedades de la versión 12.30 (salidas cortas, duplicar evaluaciones, Safe Exam Browser en el teléfono)

**Salidas cortas repetidas**: con «Bloquear si sale de la página», una salida más corta que la tolerancia (por ejemplo, ver otra pestaña 3 segundos) solo se registraba, y un alumno podía hacerlo muchas veces. Ahora **a la 3.ª salida el examen se bloquea aunque todas hayan sido cortas** (después de que le des el código, la cuenta vuelve a empezar). Consejo: para exámenes importantes elige la tolerancia «Ninguna».

**Duplicar una evaluación**: botón **«Duplicar»** en la página de la evaluación. Copia preguntas, preguntas al azar y toda la configuración. Puedes crearla en este curso o en otro donde también enseñes (las imágenes se copian; las secciones, la categoría de calificación y las condiciones no, porque son del curso de origen). La copia queda **oculta y sin intentos**: revisa sus fechas y publícala.

**Safe Exam Browser en el teléfono**: si Enlace pide Safe Exam Browser a mitad del examen (por ejemplo, porque el alumno empezó en su celular), ahora aparece el aviso completo con el botón y dónde descargarlo, no solo un mensaje. En **Android** explica que Safe Exam Browser no existe ahí y que debe presentar desde una computadora, un iPad o un iPhone. En iPhone lleva a la App Store.

No requiere migración.

## Novedades de la versión 12.29 (corrección urgente: «ya usaste tus intentos»)

**El problema**: con «El tiempo empieza a la hora de inicio, igual para todos», el límite es el mismo para todos: *hora de inicio + tiempo límite* (por ejemplo, abre 7:00 con 30 minutos → todos terminan a las 7:30), aunque la evaluación cierre más tarde. Si un alumno tocaba «Comenzar examen» después de esa hora, Enlace abría un intento ya vencido, lo cerraba en 0 y, en el mismo toque, hacía lo mismo con los demás intentos. Por eso decía «Ya usaste tus 2 intentos» sin haber contestado nada.

**Ya corregido**:
- Un intento nunca se abre ya vencido. El alumno ve por qué: «El tiempo de esta evaluación terminó a las …: se cuenta desde la hora de inicio». No se le descuenta nada.
- Al guardar una evaluación con esa casilla y una fecha final más tarde, Enlace te avisa a qué hora terminan todos y te pregunta si así la quieres.
- En la evaluación aparece **«Devolver intentos sin respuestas»** cuando hay intentos que se cerraron sin ninguna respuesta. Los quita para que esos alumnos puedan volver a presentar. Los intentos con respuestas no se tocan.

**Qué hacer con el examen afectado**:
1. En «Editar evaluación», **desmarca** «El tiempo empieza a la hora de inicio» (así cada alumno tiene sus 30 minutos desde que empieza). Si ya pasó la fecha final, amplíala.
2. En la evaluación, toca **«Devolver intentos sin respuestas»**.

No requiere migración.

## Novedades de la versión 12.28 (Safe Exam Browser con un solo botón)

Ya no necesitas preparar un archivo .seb ni copiar llaves:
- **Tú**: en la evaluación marca **«Exigir Safe Exam Browser»** y guarda. Nada más.
- **Tus alumnos** (con Safe Exam Browser instalado, gratis para Windows, Mac o iPad) ven en la evaluación el botón **«Abrir en Safe Exam Browser»**: se abre SEB directamente en esa evaluación; entran con su cuenta y la presentan. Desde otro navegador no aparece el botón para empezar y Enlace no lo permite (salvo que alguien imite la llave a mano: ver «límite conocido» en la 12.34).
- Enlace arma la configuración de cada evaluación (en `/seb/<evaluación>.seb`) y comprueba en cada paso (empezar, guardar, enviar) que la solicitud venga de SEB con esa configuración, como lo hace Moodle.
- Si ya tienes tu propio archivo .seb, puedes seguir usándolo: en «Avanzado» pega su Config Key.
- Al entrar a Enlace desde un enlace a una evaluación (o desde SEB), después de iniciar sesión se llega a esa evaluación y no al inicio.

Antes del primer examen real, haz una prueba con una evaluación de práctica y un alumno: Safe Exam Browser es un programa aparte que no pude probar aquí (lo simulé con sus mismas cabeceras). En particular, confirma que el inicio de sesión (Google o Microsoft) funcione dentro de SEB.

No requiere migración.

## Novedades de la versión 12.27 (evaluaciones al estilo Brightspace)

Se integró al sistema de evaluaciones de Enlace lo que faltaba del módulo de Brightspace. No es un sistema aparte: tus evaluaciones, bancos, calificaciones y exámenes de siempre siguen igual.

**Importar el CSV de Brightspace** (el de la biblioteca de preguntas):
- En una evaluación: «Importar examen (Brightspace, Word, Excel o texto)» o, dentro del editor, «Importar preguntas». Puedes elegir **varios archivos a la vez**.
- En el banco de preguntas: «Importar preguntas»; cada archivo queda en su tema (o por el ID de Brightspace, por ejemplo QUIM-P01).
- Se reconocen los 8 tipos: elección múltiple (con crédito parcial por opción), verdadero/falso, selección múltiple, coincidencia, ordenamiento, respuesta corta, para completar y respuesta escrita. También puntos, pista, retroalimentación y comentarios por opción.
- Subíndices y superíndices (H₂O, ψ²) y acentos se conservan, también si vienen en HTML.
- Antes de agregar ves cuántas se entendieron y, de las que no, el renglón y el motivo.
- Con el banco de Química: 121 preguntas, 0 errores, 12 grupos.

**Grupos al azar con puntos**: en «Preguntas al azar» eliges, por grupo, cuántas recibe cada alumno y cuántos puntos vale cada una (o para todos los grupos a la vez). Se muestra el **total de puntos**: 12 grupos × 5 preguntas × 1 punto = 60.

**Vista previa** (en la página de la evaluación): un sorteo nuevo cada vez, tal como lo recibiría un alumno. Puedes contestarla y revisar tus respuestas. No se guarda nada.

**Preguntas por página** (Configuración): por ejemplo, de 5 en 5.

**Las respuestas se guardan solas en cualquier evaluación** (antes solo en el modo examen). Si el alumno recarga la página o se le va el internet, vuelve a entrar y sigue con las mismas preguntas y sus respuestas. Si se acaba el tiempo, el intento se envía con lo que tenía guardado.

**Safe Exam Browser** (opcional): la evaluación puede exigirlo. Pega la Config Key de tu archivo .seb (en la herramienta de configuración de SEB: «Exam» → «Use Browser Exam Key and Config Key»). Desde otro navegador no se puede empezar, guardar ni enviar.

**Código para empezar**: además del bloqueo a los 10 intentos, ahora hay un máximo de 5 códigos equivocados por minuto. El código sigue siendo visible solo para ti; los alumnos nunca lo reciben.

También:
- Selección múltiple califica «por opción», como «Respuestas correctas» de Brightspace.
- Coincidencia admite una respuesta que es pareja de varios elementos.
- Respuesta corta puede tener tolerancia numérica.
- Una evaluación admite hasta 300 preguntas.

Requiere la migración **0032**: agrega dos columnas al registro de códigos equivocados. No borra ni modifica datos.

## Novedades de la versión 12.26 (parciales, categorías y qué cuenta en cada una)

En **Calificaciones → Administrar calificaciones** (con «Usar categorías con pesos»):

**Parciales**: botón **«Dividir por parciales»** (2, 3 o 4). Cada parcial tiene un peso en la calificación final y sus propias categorías (Exámenes, Tareas…), cuyo peso es sobre ese parcial. Las categorías que no son de un parcial (por ejemplo **Laboratorio** o la asistencia) quedan en «Toda la materia» y pesan directo en la final. Arriba de todo se ve si cada suma da 100 %.
- Al dividir, tus categorías actuales se copian a cada parcial; lo que ya estaba en ellas queda en el Parcial 1.
- Se pueden agregar o quitar parciales, renombrarlos y mover una categoría de parcial.
- En el libro aparece una columna por parcial; el alumno ve su calificación por parcial en «Mis calificaciones»; el Excel también la incluye.

**Categorías**: agrega las que quieras (Laboratorio, Proyecto, Participación…; al escribir el nombre salen sugerencias). En «Opciones» de cada categoría:
- **Distribución**: cada elemento pesa según su valor, o todos pesan igual.
- **No contar las más bajas / más altas**: por ejemplo, se descarta la peor tarea de cada alumno.

**Qué cuenta en cada categoría**: la tabla de abajo ahora incluye **actividades, evaluaciones y foros**. Al elegir una categoría para un foro se crea su actividad «Participación» para calificarlo. En las evaluaciones también se elige qué intento cuenta.

**Desde la actividad**: el editor de cada actividad tiene **«Libro de calificaciones»**, para elegir su categoría (con su parcial) y su valor sin salir de ahí.

Requiere la migración **0031**: agrega columnas para los parciales y las opciones de categoría. No borra ni modifica datos; los cursos existentes se calculan igual.

## Novedades de la versión 12.25 (editar curso y portada, corregir datos de alumnos)

**Editar el curso**: botón **«✎ Editar curso y portada»** en el inicio del curso (y en el menú ⋯ de su tarjeta en «Mis cursos»). Ahí cambias el nombre de la materia, el grupo, el periodo y la presentación (antes solo estaba escondido en Administración del curso → Información del curso).
- **Color de la portada**: eliges uno de seis, o «Auto».
- **Imagen de portada**: una foto propia (JPG, PNG o WEBP). Se reduce en tu dispositivo antes de subirla (máximo 1.5 MB) y la ven solo las personas del curso, en su tarjeta y en el inicio del curso. Se puede cambiar o quitar cuando quieras.
- Al copiar un curso a otro periodo se copia el color, pero no la imagen.

**Corregir los datos de un alumno**: en Alumnos, botón **«Editar»** en cada fila, para arreglar un nombre mal escrito, la matrícula, el correo o la sección.
- Si corriges el correo, la inscripción se liga a la cuenta con el correo correcto: el alumno ya ve el curso cuando entra.
- Sus entregas, calificaciones y asistencia se conservan.
- No deja poner un correo que ya es de otra persona del curso.

Requiere la migración **0030**: agrega al curso la portada y el color. No borra ni modifica datos.

## Novedades de la versión 12.24 (asistencia, importar lista y calificaciones, libro de calificaciones)

**Cambiar el estado después de pasar lista**: en el resumen de Asistencia, toca cualquier casilla (P, R, F, J o «·») y elige **Presente, Retardo, Falta o Justificada**, con una nota opcional (por ejemplo, «constancia médica»). Se guarda al momento, también sin internet (se envía al reconectar). En el teléfono, la columna del alumno ocupa menos espacio para que se vean y se toquen las fechas.

**La ubicación ya no marca a quien está en el salón**. Dentro de edificios, el GPS de un teléfono (el tuyo o el del alumno) puede equivocarse cientos de metros; por eso se marcaban alumnos «a 650 m». Ahora:
- el teléfono escucha la ubicación unos segundos y se queda con la lectura más precisa, en lugar de la primera (que suele venir de la red);
- se cuenta toda la imprecisión que reportan los dos teléfonos (hasta 1 km cada uno) antes de decir que alguien está lejos;
- se compara con el grupo: si todos aparecen a la misma distancia de tu punto, el que quedó mal es tu punto, y no se marca a nadie. Al cerrar el registro, los primeros en registrarse se revisan otra vez contra el grupo;
- en la misma red que tú (el Wi-Fi de la escuela) y a menos de 1.5 km, una lectura dudosa no se marca.

Quien de verdad está lejos (por ejemplo, en su casa) sigue quedando «por revisar».

**Importar pase de lista** (Asistencia → «Importar lista»): un Excel o CSV con un alumno por fila (matrícula, correo o nombre, en cualquier orden) y una columna por clase con la fecha (2026-09-01 o 01/09/2026). En las casillas van P, R, F o J (o «Presente», «Retardo», «Falta», «Justificada», 1 o 0). Se crean las clases que falten y antes de guardar ves cuántos alumnos se reconocieron. Sirve el archivo de «Exportar a Excel».

**Importar calificaciones** (Calificaciones → «Importar calificaciones»): del Excel que exporta **Brightspace** o de uno propio. Cada columna va a una actividad existente o a una nueva, y se convierte a la escala de 0 a 10 según sus puntos máximos (Brightspace los trae en el encabezado). Puedes elegir si se publican y si reemplazan lo ya capturado; todo queda en el historial de calificaciones.

**Libro de calificaciones**:
- La calificación se escribe **directamente en la tabla**; Enter pasa al siguiente alumno.
- Un ícono de documento en cada casilla abre **la entrega del alumno** (o la pantalla para calificar con rúbrica y comentarios).
- Cada actividad tiene un menú **⌄** con «Ver entregas», «Editar actividad», «Ingresar calificaciones» y «Ver las estadísticas» (promedio, mediana, aprobados y distribución).
- Hay columna de **Asistencia** (%) y **foto** de cada alumno. El alumno también ve su porcentaje de asistencia en «Mis calificaciones».

No requiere migraciones.

## Novedades de la versión 12.23 (evaluaciones, foros completos y condiciones de liberación)

**Importar un examen completo**: en Evaluaciones, botón **«Importar examen (Word, Excel o texto)»**. Eliges un archivo **.docx**, **.xlsx**, **.csv** o **.txt** (o pegas el texto) y ves cómo se entendió cada pregunta antes de agregarla. El título se toma del nombre del archivo. También está dentro del editor de cualquier evaluación («＋ Importar preguntas»).
- Formato: preguntas numeradas (1., 2., …, o la lista automática de Word) y opciones a), b), c)…
- La correcta lleva **\*** (o «(correcta)»), o se indica con «Respuesta: b». En Word basta con ponerla en **negritas**.
- Varias correctas → selección múltiple. Sin opciones: «Respuesta: Verdadero/Falso» → verdadero o falso; un número → aritmética; un texto → respuesta corta (varias aceptadas con |); nada → respuesta escrita. Con [[ ]] en el enunciado → para completar.
- Opcionales: «Puntos: 2», «Retroalimentación: …» y «Comentario: …» debajo de una opción.
- En Excel: columnas Tipo, Pregunta, A a F, Respuesta, Puntos y Retroalimentación. En «Cómo escribirlas» hay una **plantilla de Excel** para descargar.

**Evaluaciones**:
- **Puntos por pregunta** (0.1 a 100): la calificación se pondera con ellos.
- **Retroalimentación**: una explicación por pregunta y un comentario por opción. El alumno los ve al revisar su intento, si la evaluación muestra «Qué preguntas acertó». En sus intentos anteriores tiene «Ver revisión».
- **Corregir la clave con intentos ya enviados**: ahora se puede cambiar la respuesta correcta, la tolerancia, las respuestas aceptadas y los puntos. **Al guardar se vuelven a calificar todos los intentos.** Se conservan las respuestas escritas ya calificadas y tus ajustes a mano. El enunciado, las opciones y el orden aleatorio siguen sin poder cambiarse.
- **Estadísticas por pregunta**: acierto promedio, discriminación (si la aciertan más quienes salen mejor) y cuántos eligieron cada opción.
- **Exportar a Excel**: un libro con tres hojas: resultados por alumno, respuestas por pregunta y estadísticas.
- Se corrigió un error de la 12.21: al abrir para editar una evaluación, las preguntas de los tipos nuevos aparecían como opción múltiple.

**Foros completos**:
- **Hilos con respuestas**: cada hilo tiene sus respuestas. Hay búsqueda y orden por última actividad, más recientes o sin respuesta.
- Lo **nuevo** desde tu última visita se marca en cada hilo.
- **Seguir** un foro o un hilo: sus publicaciones nuevas llegan a la campana y al resumen por correo. Las respuestas a tus propios hilos siempre te llegan.
- Reglas por foro:
  - **anónimo**: tus compañeros no ven tu nombre; tu docente sí;
  - **publica primero**: cada alumno ve lo de sus compañeros hasta que publica lo suyo;
  - **cerrado**: ya no recibe publicaciones.
- El docente puede **fijar** un hilo arriba o **cerrarlo**.
- **Calificar la participación**: crea la actividad «Participación: …» en el libro de calificaciones. Ahí eliges su categoría o ponderación. Los alumnos no entregan nada en ella. En el foro ves los hilos y respuestas de cada alumno y pones su calificación.

**Condiciones de liberación** (como en Brightspace): en unidades, materiales, foros, evaluaciones y actividades, la sección «Condiciones de liberación» define qué debe hacer el alumno antes de verlos:
- completar o abrir un material;
- entregar una actividad o sacar al menos cierta calificación en ella;
- contestar una evaluación o sacar al menos cierto puntaje.

Pueden ser «todas» o «cualquiera». Mientras no las cumple, el alumno no ve el elemento en ningún lado (curso, descargas, pendientes, calendario, avisos ni correo). Tú lo ves con la etiqueta «🔒 Con condiciones». Si borras el elemento de una condición, aparece «⚠ Condición rota» hasta que la corrijas. Al copiar el curso, las condiciones apuntan a lo copiado.

Requiere la migración **0029**:
- crea la tabla de seguimiento de foros (qué sigue cada quien y qué ya leyó);
- agrega a las actividades el foro que califican y sus condiciones.

No borra ni modifica datos.

## Novedades de la versión 12.22 (acceso especial, fechas en español y pulido visual)

**Acceso especial** (como en Brightspace), en actividades y en evaluaciones: botón **«Acceso especial»** en la página de la actividad o de la evaluación. También está en cada alumno de «Envíos en carpeta» (antes «Prórroga»).
- Se eligen **varios alumnos a la vez**: con filtro por sección, búsqueda y «todos los que se ven». Solo aparecen alumnos de las secciones a las que va dirigida.
- **Actividades**: «Disponible desde», «Vence» y «Cierre de entregas» propios. Sirve para volver a abrir una actividad ya cerrada solo para esos alumnos.
- **Evaluaciones**: horario propio («Se abre», «Se cierra»), **minutos extra** en el tiempo límite e **intentos adicionales**. Cuentan también en el modo examen, en el bloqueo de la plataforma y en el monitor del docente. El alumno ve el aviso «Tienes acceso especial…».
- **«Solo los alumnos con acceso especial ven esta actividad/evaluación»**: para reposiciones o exámenes extemporáneos. Los demás no la ven en ningún lado (curso, pendientes, calendario, avisos, correo, descargas) ni les cuenta en la calificación. Al copiar el curso a otro periodo esta marca no se copia.
- El motivo (por ejemplo, «justificante médico») solo lo ven los docentes.
- Lo que se deja vacío usa la fecha de la sección del alumno o la general. Un acceso especial manda sobre las dos.

**Fechas y horas en español en toda la plataforma**: cada campo de fecha abre un calendario propio:
- mes con lunes a domingo, hoy marcado y el día elegido resaltado;
- hora y minutos, con atajos (07:00, 12:00, 18:00, 23:59);
- botones «Hoy», «Borrar» y «Listo».

En el teléfono se abre como hoja desde abajo. El campo muestra, por ejemplo, «30 sep 2026 · 18:00» en lugar del formato del navegador (antes aparecía «mm/dd/yyyy» en inglés). Al elegir un día sin hora se propone 07:00 para «desde» y 23:59 para lo demás.

**Pulido visual**:
- Se midió en cada pantalla, en computadora y en teléfono, qué botones cambiaban de tamaño o de lugar al pasar el mouse o presionarlos. Ya no se mueve ninguno. Antes, todos los botones bajaban al presionarlos y las tarjetas de los cursos y de las unidades subían al pasar el mouse, arrastrando sus botones.
- **Editor de actividad**: «Visible» y «¿Para qué secciones?» pasaron a la columna lateral. La barra fija de abajo solo tiene «Guardar y cerrar», «Cancelar» y «Eliminar», y ya no tapa la página.
- **Tablas**: todo alineado a la mitad de la fila.
- **Asistencia**: la foto, el nombre y el porcentaje van juntos (el nombre quedaba separado).
- **En el teléfono**: los botones de las barras de herramientas quedan en dos columnas del mismo ancho, y «Crear curso» va primero en el inicio.
- Otros detalles: el filtro de secciones, los paneles plegables con flecha moderna y «Material del docente» sin el hueco vacío.

**Más rápido en el teléfono**: el navegador ya no descarga toda la interfaz (≈770 KB) en cada visita. Cada archivo lleva una huella (ETag): el navegador solo pregunta si cambió y recibe un «no cambió» sin volver a bajarlo. Cuando publiques una versión nueva, se descarga sola.

Requiere la migración **0028**:
- crea la tabla del acceso especial en evaluaciones;
- agrega a las actividades la marca «solo con acceso especial»;
- agrega la fecha «desde» al acceso especial de las actividades.

No borra ni modifica datos. Las prórrogas que ya diste siguen igual (ahora se llaman «acceso especial»).

## Novedades de la versión 12.21 (tipos de reactivos)

El editor de evaluaciones (y el banco de preguntas) tiene ahora 11 tipos de pregunta, como Brightspace. Se elige en «Tipo» de cada pregunta:

| Tipo | Cómo contesta el alumno | Cómo se califica |
|---|---|---|
| Elección múltiple | Una opción | Correcta o incorrecta (como antes) |
| Verdadero o falso | Verdadero / Falso | Correcta o incorrecta |
| Para completar | Escribe en los espacios del enunciado. El docente los marca con dobles corchetes: `el [[newton\|N]]` | Cada espacio vale lo mismo |
| Selección múltiple | Marca todas las correctas | Todo o nada, o parcial (correctas menos incorrectas) |
| Coincidencia | Relaciona cada elemento con su pareja; puede haber respuestas de más | Parcial (cada pareja) o todo o nada |
| Ordenamiento | Pone el lugar de cada elemento (llegan revueltos) | Parcial (cada elemento en su lugar) o todo o nada |
| Respuesta escrita | Escribe un texto | **La califica el docente** |
| Respuesta corta | Escribe una palabra o frase | Contra la lista de respuestas aceptadas |
| Aritmética | Un número (datos distintos por alumno) | Con tolerancia (como antes) |
| Cifras significativas | Un número con cierto número de cifras | Valor con tolerancia; descuento si las cifras no son las pedidas |
| Varias respuestas cortas | Varias respuestas, cada una en su espacio | Cada espacio vale lo mismo; repetir una no suma |

Las respuestas escritas no distinguen mayúsculas ni acentos, salvo que marques «Distinguir mayúsculas y acentos».

Cada pregunta vale lo mismo y ahora puede dar **crédito parcial**; la calificación sigue siendo sobre 10.

**Respuestas escritas**:
- Mientras no las califiques cuentan 0, y el alumno ve «Falta que tu docente califique…».
- En la página de la evaluación, el botón **«Revisar respuestas escritas (n por calificar)»** muestra lo que escribió cada alumno (y tu guía, si la pusiste). Ahí pones un puntaje de 0 a 100 % y, si quieres, un comentario.
- Al guardar, se actualiza la calificación del intento (también en el libro de calificaciones) y el alumno ve tu comentario. El comentario le llega aunque la evaluación no muestre «qué preguntas acertó», pero no si la calificación está oculta.

Las evaluaciones que ya existen no cambian: mismas preguntas, mismo orden y misma calificación.

No requiere migración.

## Novedades de la versión 12.20 (accesos, evaluaciones por sección con código)

**Accesos** (Listado de alumnos → «Accesos», o Administración del curso → «Accesos de alumnos y docentes»). Para cada docente y cada alumno del curso muestra:
- **Inicios de sesión**: veces que entró a Enlace con su cuenta mientras el curso ha estado activo, desde que se creó hasta hoy o hasta que se archivó. Una sesión dura 14 días en cada dispositivo, así que quien no cierra sesión tiene pocos inicios aunque entre a diario.
- **Ingresos al curso**: veces que abrió el curso. Volver después de 30 minutos cuenta como otro ingreso.
- La fecha del último inicio de sesión y del último ingreso.
- Cuántos alumnos entraron en los últimos 7 días y cuántos nunca han entrado.

Tiene filtro por sección, orden (por ejemplo, «Menos ingresos primero» para encontrar a quien no entra) y descarga en CSV. Solo lo ven quienes enseñan el curso y la administración.

Hasta ahora Enlace solo guardaba las sesiones de los últimos 14 días. Desde esta versión guarda cada inicio de sesión, y al publicar copia al historial los inicios que todavía existen. Lo anterior no se puede recuperar, así que los números empiezan a crecer desde hoy.

**Evaluaciones por sección**: en el editor de la evaluación, arriba, está el bloque **«Secciones y horarios»**. En cada sección:
- marcas si la presenta (las demás no la ven ni les cuenta en la calificación);
- pones su horario («Se abre», «Se cierra»);
- opcionalmente, un **código para empezar**. El botón «Generar» crea uno de 6 caracteres fácil de dictar.

Con código, el alumno solo puede empezar si escribe el de **su** sección (el de otra sección no sirve). Tras 10 errores se bloquea hasta que el docente lo desbloquee, igual que la contraseña del examen. El código nunca llega al navegador del alumno. En la página de la evaluación, el docente ve el horario y el código de cada sección. Funciona con o sin modo examen; en modo examen, el código de la sección manda sobre la contraseña general.

Requiere la migración **0027**:
- crea dos tablas (historial de inicios de sesión e ingresos por curso);
- agrega una columna a las fechas por sección (el código);
- copia al historial las sesiones actuales.

No borra ni modifica datos.

## Novedades de la versión 12.19 (avisos por correo con Gmail)

Enlace ahora puede mandar correos a alumnos y docentes desde una cuenta de Gmail solo para Enlace (por ejemplo `avisos.mi-academia@gmail.com`).

- **Resumen diario**: cada tarde a las **7 p.m.** (hora del centro de México) cada persona recibe **un solo correo** con lo nuevo en sus cursos:
  - noticias, materiales, evaluaciones y actividades publicadas;
  - calificaciones publicadas;
  - lo que vence en las próximas 24 horas y aún no entrega;
  - para los docentes, las entregas nuevas por calificar.
  
  Respeta secciones, publicación programada y prórrogas, igual que la campana de avisos. Quien no tiene nada nuevo no recibe correo.
- **Noticia urgente**: al crear o editar una noticia, el docente puede marcar «Enviar también por correo ahora». Le llega de inmediato solo a los alumnos a los que va dirigida (su sección), y **una sola vez**: editarla después no la vuelve a enviar.
- **Apagarlo**: cada persona lo desactiva en «Mi perfil» → «Recibir por correo un resumen diario».
- **Panel en Reportes** (solo administración): muestra la cuenta remitente, los correos enviados hoy y el último problema. Tiene dos botones: «Enviarme un correo de prueba» y «Enviar el resumen ahora».

Requiere la migración **0026**: crea una tabla pequeña (conteo de correos por día) y agrega dos columnas a los usuarios (si quieren el resumen y cuándo se envió el último). No borra ni modifica datos.

**Cómo activarlo (una vez)**:
1. En la cuenta de Gmail de Enlace, activa la verificación en dos pasos y crea una **contraseña de aplicación** (16 letras).
2. En tu computadora, en la carpeta de Enlace, ejecuta `configurar.cmd` como siempre (o solo `npm run correo`).
3. Cuando lo pida, escribe la cuenta de Gmail y pega la contraseña de aplicación. Se guardan como secretos de Cloudflare (`CORREO_AVISOS`, `GMAIL_APP_PASSWORD`); la contraseña no se muestra, no queda en el repositorio y **no debe enviarse por chat ni correo**.
4. Entra a Enlace → Reportes → «Enviarme un correo de prueba».

**Cambiar de cuenta**: crea la contraseña de aplicación en la cuenta nueva y vuelve a ejecutar `npm run correo`. Si revocas la contraseña en Google, los envíos se detienen hasta que pongas otra.

**Límites**: Gmail permite unos 500 destinatarios al día. Enlace se detiene en **450** (puedes cambiarlo con la variable `MAIL_DAILY_LIMIT`). Si no alcanza, quienes se quedaron sin correo lo reciben al día siguiente sin perder avisos. Si algún día tienes dominio propio, con `RESEND_API_KEY` y `EMAIL_FROM` se usa Resend en lugar de Gmail.

**Horario**: está en `wrangler.toml`, en `[triggers] crons = ["0 1 * * *"]` (hora UTC: 01:00 UTC = 7 p.m. en la Ciudad de México). Por ejemplo, `"0 13 * * *"` sería a las 7 a.m.

## Novedades de la versión 12.18.1 (secciones, contenido por sección y foto de perfil)

Requiere las migraciones **0023**, **0024** y **0025**:
- **0023** crea dos tablas (secciones y fechas por sección) y agrega una columna a los alumnos y otra a las clases de asistencia. Además, cambia un índice de la asistencia para que dos secciones puedan tener clase a la misma hora. No borra ni modifica datos.
- **0024** agrega dos columnas a los usuarios (su foto).
- **0025** agrega una columna a las actividades (para qué secciones son).

`npm run configurar` descarga un respaldo y las aplica.

### Un curso para varios grupos (secciones)
- **Como en Brightspace:** en lugar de crear «Física I · 5AV», «Física I · 5BV» y «Física I · 5CV», creas un solo curso «Física I» con las secciones 5AV, 5BV y 5CV. El contenido, las actividades, los foros y los exámenes son los mismos para todos.
- **Crear secciones:**
  - al crear el curso (campo «Secciones»), o
  - en Alumnos → «Crear secciones» / «Secciones», donde también se renombran y se eliminan (solo las que no tienen alumnos ni clases).
- **Asignar alumnos a su sección:**
  - en el listado, con el selector de cada alumno;
  - al inscribir a uno;
  - al importar la lista: elige la sección para toda la lista, o agrega una fila de encabezado con una columna **Sección** (las que no existan se crean solas).
- **Juntar cursos que ya tenías separados:** en «Secciones» → «Traer alumnos de otro curso como sección». Solo se copia la lista. Las entregas, calificaciones y asistencia de ese curso se quedan en él; archívalo para conservarlas.
- **Cada docente registra sus propias secciones** en cada uno de sus cursos (las que tenga, con el nombre que quiera): no hay secciones fijas.
- **Para todas las secciones o solo para algunas:** al crear o editar una unidad, un material, una noticia, un foro, una actividad o una evaluación, en «¿Para qué secciones?» eliges «Para todas» o marcas algunas.
  - Los alumnos de otras secciones no lo ven ni les llega el aviso; tampoco pueden descargarlo, entregarlo, contestarlo ni publicar en ese foro (lo revisa el servidor).
  - En la calificación solo cuenta a los alumnos de esas secciones: en el libro de calificaciones las demás celdas aparecen rayadas y en la exportación dicen «n/a».
  - En las listas del docente se ve la etiqueta «Solo 5AV, 5BV».
- **Filtro «Secciones»** (con casillas y buscador, como en Brightspace: elige una, varias o todas, y pulsa «Aplicar») en las pantallas del docente, recordado por curso:
  - Alumnos, Calificaciones (y su exportación, con columna Sección), Envíos de cada actividad, Revisión en secuencia.
  - Asistencia, Progreso, Equipos en lote.
  - Resultados y monitor de los exámenes.
- **Fechas por sección** («Fechas por sección» en el editor de actividades y de evaluaciones):
  - Cada grupo puede entregar o presentar a su hora; lo vacío usa la fecha general.
  - El alumno ve solo sus fechas, también en pendientes y en el calendario.
  - En los exámenes, cada sección se abre y se cierra a su hora: el examen activo, el bloqueo de la plataforma y el monitor usan la hora de su sección.
  - Una prórroga individual sigue mandando.
  - Consejo: pon «Mostrar resultados a partir de» después de que presente el último grupo.
- **Asistencia por sección:**
  - Cada clase puede ser de una sección (o de todo el curso); dos secciones pueden tener clase a la misma hora.
  - Al pasar lista solo aparecen sus alumnos, y el registro con código o QR rechaza a alumnos de otra sección.
  - El porcentaje de cada alumno cuenta solo sus clases.
- **Al copiar el curso a otro periodo** se copian los nombres de las secciones (sin alumnos ni fechas), y lo que era solo para una sección sigue siendo solo para ella en el curso nuevo.
- **Los cursos sin secciones funcionan igual que antes.**

### Foto de perfil
- **Obligatoria para los alumnos.** La primera vez que un alumno entra (y si su docente le quita la foto), antes de ver cualquier otra cosa se abre la cámara para que se tome una foto de frente, como en una credencial.
  - Lo exige el servidor: sin foto no recibe cursos ni nada más.
  - Si el navegador no puede usar la cámara, se ofrece tomarla con la cámara del teléfono.
  - Un examen ya empezado no se interrumpe.
  - Para quitar la obligación, cambia `FOTO_OBLIGATORIA = "1"` a `"0"` en `wrangler.toml` y vuelve a publicar.
- **Dónde se ve:** en el listado de alumnos, al pasar lista, en la tabla de asistencia y en los envíos de cada actividad. La ven la persona, sus docentes y la administración; **los compañeros no**.
- **Docentes:** suben o cambian la suya desde «Mi perfil». Pueden **quitar la foto de un alumno** (Alumnos → «Quitar foto») si no es adecuada; al volver a entrar, el alumno tendrá que tomarse otra.
- **Cómo se guarda:** la foto se recorta en cuadrado y se reduce en el navegador (unos 30 KB). Al cambiarla se borra la anterior.
- **A tener en cuenta:**
  - La foto es un dato personal. Te recomiendo mencionarla en el aviso de privacidad («foto de perfil para identificar al alumno al pasar lista y en exámenes»).
  - El respaldo de archivos de Administración no incluye las fotos; si se perdieran, cada alumno se toma otra al entrar.

## Novedades de la versión 12.17.1 (resultados de exámenes cuando hay varios grupos)

No requiere migración: basta con publicar.

- **«Qué preguntas acertó» viene desmarcado en las evaluaciones nuevas.** Con esa casilla marcada, el alumno ve los enunciados que le tocaron con ✓ y ✗, y podría pasárselos a un grupo que aún no presenta. Las evaluaciones que ya existen conservan lo que tenían.
- **Nueva opción «Mostrar resultados a partir de»** (en «Qué ve el alumno al terminar»): pon la fecha y hora en que termina el último grupo. Hasta entonces nadie ve su calificación, sus aciertos ni los enunciados (dice «Verás tu resultado a partir del …»). Al llegar la fecha se muestra solo lo que indiquen las casillas, sin que tengas que regresar a activarlo. Tú siempre ves todo.

## Novedades de la versión 12.17 (banco de preguntas y preguntas al azar)

Requiere la migración **0022**: solo crea una tabla nueva (el banco de preguntas) y no modifica datos. `npm run configurar` descarga un respaldo y la aplica.

- **Banco de preguntas** (Evaluaciones → pestaña «Banco de preguntas», solo docentes):
  - Guarda preguntas por tema (por ejemplo «Cinemática») para usarlas en cualquier curso y semestre: opción múltiple o numéricas, con imagen, fórmulas y datos aleatorios.
  - Tres formas de llenarlo: «Nueva pregunta» en el banco; «Guardar en el banco» en la página de una evaluación que ya tengas (puede usar el grupo de cada pregunta como tema); y las repetidas no se duplican.
  - Buscar por texto y filtrar por tema; renombrar un tema; editar o borrar preguntas.
  - **Compartir con tu academia:** al compartir un tema, lo ven y lo pueden usar (sin modificarlo) los docentes de tu misma academia. Quien no ha indicado su academia no ve lo compartido (se indica en Inicio, «Completa tu registro»).
  - Una evaluación guarda su propia copia de cada pregunta: cambiar o borrar una pregunta del banco no altera las evaluaciones que ya la usan ni sus intentos.
  - Las imágenes de una pregunta usada en otro curso no se copian en el almacenamiento: el nuevo curso apunta al mismo archivo (como al copiar un curso).
- **Agregar desde el banco** (en el editor de la evaluación): elige tus preguntas o las de tu academia, filtra por tema, marca todas las que ves y agrégalas. Llegan con su tema como **grupo**.
- **Preguntas al azar:**
  - Cada pregunta puede tener un grupo. En «Preguntas al azar» eliges cuántas recibe cada alumno de cada grupo (por ejemplo, 3 de las 10 de Cinemática). Las preguntas sin grupo le tocan a todos.
  - Cada alumno recibe otras, y en cada intento se sortean de nuevo. La calificación es sobre las que recibió (3 de 3 correctas = 10).
  - Con intentos registrados no se puede cambiar el sorteo (igual que las preguntas).
  - La lista de evaluaciones dice «5 de 12 (al azar)», y la página de la evaluación explica cuántas recibe cada alumno de cada grupo.
- **El alumno ya no recibe las preguntas antes de empezar.** Antes, aunque la pantalla no las mostraba, llegaban al navegador del alumno (sin respuestas) y alguien con conocimientos podía leerlas antes del examen. Ahora solo sabe cuántas son; recibe las suyas al empezar, y después solo ve las que contestó (para sus ✓ y ✗).
- **Correcciones de la 12.16:**
  - La limpieza de archivos sin uso (Administración → Reportes) no tomaba en cuenta las imágenes de las preguntas: después de 7 días las habría ofrecido para borrar. Ahora las respeta (de evaluaciones y del banco). Si ya usaste la limpieza desde la 12.16, revisa que las imágenes de tus preguntas se sigan viendo.
  - Con «ocultar la calificación», al enviar la evaluación aparecía un error aunque el envío sí se guardaba. Ahora dice «Tu docente publicará la calificación».

## Novedades de la versión 12.16 (examen estricto: contraseña, plataforma bloqueada, un solo dispositivo, imágenes y fechas)

Requiere la migración **0021**: solo agrega una columna y un índice y no modifica datos. `npm run configurar` descarga un respaldo y la aplica.

- **Contraseña y bloqueo al salir juntos.** La contraseña se pide solo para empezar; al retomar un examen ya empezado («Continuar examen») no se vuelve a pedir.
- **Plataforma bloqueada mientras contesta** (opción nueva del modo examen, activada por omisión):
  - Desde que empieza hasta que envía (o se acaba el tiempo), Enlace solo le responde ese examen.
  - No puede abrir otros cursos, materiales, foros, avisos, calendario ni archivos, ni empezar otra evaluación.
  - Lo hace cumplir el servidor: aunque abra otra pestaña, recargue o vuelva a iniciar sesión, lo único que ve es el examen.
- **Un solo dispositivo:**
  - Si vuelve a iniciar sesión (en otro teléfono, otra computadora o el mismo navegador), el examen pasa a esa sesión **bloqueado**, y necesita el código de su docente para seguir.
  - La sesión anterior ya no puede guardar ni enviar nada, y muestra «El examen continúa en otro dispositivo».
  - En el monitor, el bloqueo dice «otro dispositivo».
- **Capturas de pantalla:**
  - Cada pregunta lleva una marca de agua con el nombre y el correo del alumno y la hora, así que una captura que circule lo identifica.
  - En computadora, la tecla de captura (Impr Pant; Win+Mayús+S; Cmd+Mayús+3/4/5) tapa el examen, intenta vaciar el portapapeles y queda registrada. En la integridad del intento aparece «intentó una captura de pantalla».
  - El examen no se puede imprimir.
  - **Límite:** ninguna página web puede impedir la captura de un teléfono, porque la hace el sistema operativo y el navegador ni se entera. Por eso la marca de agua, más el bloqueo al salir, son la protección real en el celular.
- **Opciones en orden aleatorio** (nueva casilla): además del orden de las preguntas, cada alumno ve las opciones en distinto orden. Se califica bien y el orden real nunca llega al navegador.
- **Imágenes en las preguntas:**
  - En el editor, «Agregar imagen» en cada pregunta; se comprime en el navegador.
  - Solo se descargan cuando la evaluación está publicada y, en modo examen, después de que el alumno empezó. No se pueden ver antes del examen.
- **Fechas y disponibilidad** (como en Brightspace):
  - Fecha y hora de inicio y de final: antes de abrir dice «Abre el…», y después de cerrar ya no se puede empezar.
  - El final corta el tiempo de quien siga contestando.
  - **Temporizador a hora fija:** el tiempo cuenta desde la hora de inicio para todos. Si alguien entra tarde, tiene menos tiempo.
- **Qué ve el alumno al terminar:** mostrar u ocultar la calificación (queda «Pendiente» hasta que la actives) y mostrar u ocultar el detalle de sus respuestas.
- **Se acabó el tiempo sin enviar:** ahora se califica lo que dejó guardado, en vez de un cero.

## Novedades de la versión 12.15 (examen: bloqueo al salir de la página)

Requiere la migración **0020**: solo agrega cinco columnas y no modifica datos. `npm run configurar` descarga un respaldo y la aplica.

- **Nueva opción del modo examen: «Bloquear si sale de la página».** Pensada para exámenes en el celular.
- **Qué pasa si el alumno sale:** si cambia de aplicación (WhatsApp, calculadora, navegador), bloquea el teléfono o cambia de pestaña, al volver el examen queda **bloqueado**. Aparece «Examen bloqueado · pide a tu docente el código».
- **El código:** es de 6 cifras, distinto para cada alumno y cada vez. Solo aparece en el **monitor del examen** del docente (en la página de la evaluación), junto al nombre, en grande, para dictárselo en persona. El monitor se actualiza solo cada 10 s.
- **«Permitir continuar»:** el docente puede desbloquear desde el monitor sin dictar el código; el teléfono del alumno se desbloquea solo en unos segundos.
- **Tolerancia:** se elige al configurar el examen (ninguna, 5, 15 o 30 segundos), para que una notificación o un toque sin querer no bloqueen. Por omisión, 5 s.
- **Lo hace cumplir el servidor, no solo la pantalla:**
  - Mientras está bloqueado no se guardan respuestas ni se puede enviar el examen.
  - Recargar la página no lo desbloquea.
  - Si el alumno cerró el navegador fuera del examen, al volver a entrar ya está bloqueado.
  - Lo contestado antes se conserva.
- **Límite de intentos:** a los 5 códigos equivocados, solo el docente puede desbloquear.
- **El tiempo sigue corriendo** mientras está bloqueado, y la introducción del examen lo avisa (junto con «silencia las notificaciones»).
- **En los resultados:** la integridad dice «se bloqueó 2 veces», y el detalle muestra cada bloqueo y cómo se desbloqueó (con código o por el docente).
- **Límite de lo que puede hacer una página web:** no puede impedir que el alumno salga ni ver otras aplicaciones. Lo que sí hace es que salir tenga consecuencia y que el docente se entere en el momento.

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
3. Doble clic en `configurar.cmd` (Windows) o `configurar.command` (Mac), o `npm run configurar`. Encuentra tu base `enlace-db` y tu almacenamiento, usa el correo de administración y la dirección `.workers.dev` de la vez anterior (desde la versión 12.11 los recuerda; la primera vez te los pregunta y revisa que el correo ya haya entrado a Enlace), descarga un respaldo, aplica las migraciones pendientes (0003: asistencia y borradores; 0004: registro con QR; 0005: categorías, rúbricas y equipos; 0006: sesiones; 0007: papelera; 0008: registro de docentes; 0009: aviso de privacidad; 0010: periodos y archivo; 0011: prórrogas; 0012: intentos de evaluaciones; 0013: avisos; 0014: historial de calificaciones; 0015: asistencia con código; 0016: modo examen; 0017: usuarios y registro de acciones; 0018: avisos leídos; 0019: seguimiento del contenido; 0020: bloqueo del examen; 0021: examen estricto; 0022: banco de preguntas; 0023: secciones; 0024: foto de perfil; 0025: contenido por sección; 0026: correo de avisos; 0027: accesos y código por sección; 0028: acceso especial), pregunta la cuenta de Gmail para los avisos (si aún no está) y publica. No cambia tus claves. Al pasar a la versión 12.1 cada persona vuelve a entrar con Google una vez (las sesiones ahora se registran en el servidor).

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
- `test-bloqueo-examen.mjs`: bloqueo al salir (tolerancia, sin guardar ni enviar mientras está bloqueado, código solo para el docente, 5 intentos, desbloqueo del docente, al retomar tras cerrar el navegador).
- `test-acceso-especial.mjs`: acceso especial (actividad cerrada que se abre a varios alumnos, fecha «desde» propia, alumnos de otras secciones rechazados, «solo con acceso especial» en curso, entregas, descargas, pendientes, calendario, avisos y correo; evaluaciones con otro horario, minutos e intentos extra, examen activo y monitor; se conserva al editar y no se copia a otro periodo).
- `test-reactivos.mjs`: tipos de reactivos (validación de cada tipo, lo que recibe el alumno sin claves ni respuestas, crédito parcial y todo o nada, cifras significativas, respuesta escrita calificada por el docente y sus comentarios, examen retomado con respuestas de todos los tipos y banco).
- `test-accesos.mjs`: accesos (historial de inicios que no se borra con las sesiones vencidas, inicios contados solo durante el curso, ingresos con visita nueva tras 30 min y a lo más una escritura cada 5 min, reporte solo para quien enseña).
- `test-correo.mjs`: avisos por correo (resumen diario por sección y persona, prórrogas, lo ya entregado, preferencia en el perfil, cupo diario sin perder avisos, noticia urgente una sola vez, rutas de administración, mensaje MIME sin inyección de encabezados y la conversación SMTP con un Gmail simulado).
- `test-secciones.mjs`: secciones (evaluación solo para algunas secciones, con horario y código de cada una sin que el código llegue al alumno; crear sin repetir, alumnos por lista, a mano o de otro curso, fechas de actividades y exámenes por sección con la prórroga encima, examen activo con el cierre de su sección, asistencia por sección, eliminar solo vacías, copia a otro periodo).
- `test-foto.mjs`: foto de perfil (obligatoria para alumnos con `FOTO_OBLIGATORIA`, solo imágenes reales y pequeñas, quién la ve, cambiarla borra la anterior, el docente puede quitarla).
- `test-banco.mjs`: banco de preguntas (guardar sin duplicar, compartir solo con la propia academia, usar preguntas de un colega en otro curso con su imagen, editar y borrar sin tocar evaluaciones), preguntas al azar por grupo, el alumno sin preguntas antes de contestar e imágenes de preguntas que no cuentan como archivos sin uso.
- `test-examen-estricto.mjs`: contraseña con bloqueo, plataforma bloqueada mientras contesta (ni otros cursos, materiales, avisos ni archivos), un solo dispositivo (volver a iniciar sesión bloquea y la sesión anterior ya no guarda), opciones aleatorias bien calificadas, imágenes que no se adelantan, capturas registradas, fechas, temporizador fijo y qué ve el alumno al terminar.
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
