// Generador de QR (src/public/qr.js). Sin dependencias externas, para correr también en GitHub.
// Las huellas corresponden a códigos que se verificaron decodificándolos con OpenCV (estándar y Aruco):
// si una huella cambia, el código dejó de ser idéntico a uno comprobado y hay que volver a verificarlo.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const ctx = vm.createContext({ TextEncoder });
vm.runInContext(readFileSync('src/public/qr.js', 'utf8') + ';globalThis.QR = QR;', ctx);
const { QR } = ctx;
let checks = 0;
const fingerprint = (modules) => createHash('sha256').update(modules.map((r) => r.map(Number).join('')).join('\n')).digest('hex').slice(0, 16);

const golden = [
  ['A', 1, 3, 'bc9009ae87ca68f1'],
  ['https://enlace.enlace-academia.workers.dev/?a=Xk3_9aQz.l2v9k1.Qm0aZ-8r3cV1pT7w', 5, 2, '5d2ef3e1edbbea92'],
  ['Física ñandú', 2, 1, '926543415abac0d6'],
  ['x'.repeat(100), 6, 0, '898a791db8daf879'],
  ['y'.repeat(150), 8, 1, '230adb2b282df71c'],
  ['z'.repeat(213), 10, 1, 'f6862dc828d614e5'],
];
for (const [text, version, mask, hash] of golden) {
  const code = QR.encode(text, 'M');
  assert.deepEqual([code.version, code.mask, fingerprint(code.modules)], [version, mask, hash], `Huella de ${text.slice(0, 20)}`);
  checks++;
}

// Capacidad en modo byte con corrección M: 84 bytes caben en la versión 5; 85 necesitan la 6.
assert.equal(QR.encode('a'.repeat(84)).version, 5);
assert.equal(QR.encode('a'.repeat(85)).version, 6);
assert.equal(QR.encode('a'.repeat(14)).version, 1);
assert.equal(QR.encode('a'.repeat(15)).version, 2);
assert.throws(() => QR.encode('a'.repeat(214)), /demasiado largo/);
checks += 5;

// Estructura: patrones de localización, líneas de sincronía e información de formato con su BCH.
for (let length = 1; length <= 200; length += 13) {
  for (const ecl of ['L', 'M']) {
    const { size, modules, mask } = QR.encode('Enlace-'.repeat(30).slice(0, length), ecl);
    const finderOk = (cx, cy) => [...Array(7).keys()].every((dy) => [...Array(7).keys()].every((dx) => {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      return modules[cy + dy - 3][cx + dx - 3] === (ring !== 2);
    }));
    assert(finderOk(3, 3) && finderOk(size - 4, 3) && finderOk(3, size - 4), 'Patrones de localización');
    for (let i = 8; i < size - 8; i++) assert.equal(modules[6][i], i % 2 === 0, 'Sincronía horizontal');
    let format = 0;
    const firstCopy = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    firstCopy.forEach(([x, y], i) => (format |= (modules[y][x] ? 1 : 0) << i));
    format ^= 0x5412;
    let rem = format;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    assert.equal(rem, 0, 'El código BCH del formato es válido');
    assert.equal(format >>> 10, ((ecl === 'L' ? 1 : 0) << 3) | mask, 'El formato declara el nivel y la máscara usados');
    checks += 4;
  }
}

const svg = QR.svg('A'); // versión 1: 21 módulos + 4 de margen por lado = 29
assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 29 29"/);
assert(!/<script|on\w+=/i.test(svg), 'El SVG no contiene código ejecutable');
checks += 2;
console.log(`PASS: ${checks} verificaciones del generador de QR — huellas de códigos decodificados con OpenCV, capacidad por versión, patrones y formato.`);
