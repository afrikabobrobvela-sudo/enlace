// Texto con formato (richtext.js): marcas, fórmulas intactas y seguridad frente a HTML o enlaces peligrosos.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const context = vm.createContext({ document: { addEventListener() {} }, Event: class {} });
vm.runInContext(readFileSync('src/public/richtext.js', 'utf8'), context);
const rich = (text, files = []) => vm.runInContext(`richText(${JSON.stringify(text)}, ${JSON.stringify(files)})`, context);
let checks = 0;
const has = (html, fragment, message) => {
  assert(html.includes(fragment), `${message}\n  esperado: ${fragment}\n  obtenido: ${html}`);
  checks++;
};
const lacks = (html, fragment, message) => {
  assert(!html.includes(fragment), `${message}\n  no debía contener: ${fragment}\n  obtenido: ${html}`);
  checks++;
};

// ---- Marcas ----
let html = rich('# Cinemática\n## Objetivos\nEl **movimiento** es *relativo*.\nSegunda línea.\n\nOtro párrafo.');
has(html, '<h3>Cinemática</h3>', 'Título');
has(html, '<h4>Objetivos</h4>', 'Subtítulo');
has(html, '<p>El <strong>movimiento</strong> es <em>relativo</em>.<br>Segunda línea.</p>', 'Negrita, cursiva y salto de línea');
has(html, '<p>Otro párrafo.</p>', 'Párrafos separados por línea vacía');
html = rich('- uno\n- dos\n1. primero\n2. segundo\n> cita\n---');
has(html, '<ul><li>uno</li><li>dos</li></ul><ol><li>primero</li><li>segundo</li></ol>', 'Listas');
has(html, '<blockquote>cita</blockquote><hr>', 'Cita y separador');
html = rich('Ver [simulador](https://phet.colorado.edu/es/) y https://buap.mx/fisica.');
has(html, '<a href="https://phet.colorado.edu/es/" target="_blank" rel="noopener noreferrer">simulador</a>', 'Enlace con texto');
has(html, '<a href="https://buap.mx/fisica" target="_blank" rel="noopener noreferrer">https://buap.mx/fisica</a>.', 'Enlace suelto sin el punto final');
has(rich('Texto de siempre, sin marcas: 3 * 4 = 12'), '<p>Texto de siempre, sin marcas: 3 * 4 = 12</p>', 'El texto anterior se ve igual');

// ---- Fórmulas: se conservan tal cual para KaTeX ----
html = rich('La posición es $x_0 + v_0 t + \\tfrac{1}{2} a t^2$ y **no** $a*b*c$.\n$$\nF = m a\n$$');
has(html, '$x_0 + v_0 t + \\tfrac{1}{2} a t^2$', 'Fórmula en línea intacta');
has(html, '$a*b*c$', 'Los asteriscos de una fórmula no se vuelven cursivas');
has(html, '$$\nF = m a\n$$', 'Fórmula en bloque de varias líneas intacta');
has(rich('Cuesta \\$50 y \\(v=d/t\\)'), '\\(v=d/t\\)', 'Delimitadores \\( \\)');
has(rich('$a < b$'), '$a &lt; b$', 'Lo que va dentro de una fórmula también se escapa');

// ---- Imágenes: solo archivos del propio elemento ----
html = rich('![Diagrama de fuerzas](archivo:abc-123)', ['abc-123']);
has(html, '<img class="rich-image" src="/api/file/abc-123?preview=1" alt="Diagrama de fuerzas" loading="lazy">', 'Imagen adjunta');
has(rich('![x](archivo:otro)', ['abc-123']), '[imagen no disponible]', 'Una imagen ajena no se muestra');
lacks(rich('![x](https://evil.test/rastreo.png)'), '<img', 'No se cargan imágenes externas');
has(rich('[![foto](archivo:abc-123)](https://phet.colorado.edu)', ['abc-123']), '<a href="https://phet.colorado.edu" target="_blank" rel="noopener noreferrer"><img class="rich-image"', 'Imagen con enlace');

// ---- Seguridad ----
const attacks = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[clic](javascript:alert(1))',
  '[clic](data:text/html,<script>alert(1)</script>)',
  '[x](https://ok.test/" onmouseover="alert(1))',
  'https://ok.test/"><script>alert(1)</script>',
  '![a" onerror="alert(1)](archivo:abc-123)',
  '**<b>x</b>**',
  '# <iframe src=//evil.test>',
  '- <svg onload=alert(1)>',
  '\u0001' + '0' + '\u0001 \u00000\u0000',
];
for (const attack of attacks) {
  html = rich(attack, ['abc-123']);
  assert(!/<(script|iframe|svg|b)[\s>]/i.test(html), 'Sin etiquetas del usuario: ' + attack + ' → ' + html);
  const tags = html.match(/<[a-z][^>]*>/gi) || [];
  assert(!tags.some((t) => /\son\w+\s*=/i.test(t.replace(/="[^"]*"/g, '=""'))), 'Sin atributos de evento: ' + attack + ' → ' + html);
  assert(!/href="(?!https?:)/i.test(html), 'Solo enlaces http(s): ' + attack + ' → ' + html);
  assert(!html.includes('undefined'), 'Sin marcadores internos: ' + attack + ' → ' + html);
  checks += 4;
}

console.log(`PASS: ${checks} verificaciones de texto con formato — títulos, listas, enlaces, imágenes propias, fórmulas intactas y sin HTML ni enlaces peligrosos.`);
