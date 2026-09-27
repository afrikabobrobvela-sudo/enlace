/* Generador de códigos QR para la asistencia (norma ISO/IEC 18004).
   Modo byte (UTF-8), corrección de errores L o M, versiones 1 a 10 (hasta 213 bytes con M).
   Verificado decodificando cientos de códigos con OpenCV; ver scripts/test-qr.mjs. */
const QR = (() => {
  // Por versión 1..10: palabras de corrección por bloque y número de bloques.
  const ECC = {
    L: { bits: 1, perBlock: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
    M: { bits: 0, perBlock: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
  };
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function rawModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const align = Math.floor(version / 7) + 2;
      result -= (25 * align - 10) * align - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }
  const dataCodewords = (version, ecl) => Math.floor(rawModules(version) / 8) - ECC[ecl].perBlock[version - 1] * ECC[ecl].blocks[version - 1];

  // Aritmética en GF(256) con el polinomio x^8 + x^4 + x^3 + x^2 + 1.
  function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
    }
    return result;
  }

  function alignmentPositions(version, size) {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  /** Devuelve { size, modules } donde modules[y][x] es true para un módulo oscuro. */
  function encode(text, ecl = 'M') {
    const bytes = [...new TextEncoder().encode(String(text))];
    let version = 1;
    while (version <= 10 && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version, ecl) * 8) version++;
    if (version > 10) throw new Error('El texto es demasiado largo para el código QR.');

    // Segmento en modo byte, terminador y relleno.
    const capacity = dataCodewords(version, ecl) * 8;
    const bits = [];
    const put = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    put(0b0100, 4);
    put(bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

    // Bloques con corrección de errores, intercalados.
    const blockCount = ECC[ecl].blocks[version - 1];
    const eccLength = ECC[ecl].perBlock[version - 1];
    const raw = Math.floor(rawModules(version) / 8);
    const shortBlocks = blockCount - (raw % blockCount);
    const shortLength = Math.floor(raw / blockCount);
    const divisor = rsDivisor(eccLength);
    const blocks = [];
    for (let i = 0, k = 0; i < blockCount; i++) {
      const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
      k += block.length;
      const ecc = rsRemainder(block, divisor);
      if (i < shortBlocks) block.push(0);
      blocks.push(block.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortLength - eccLength || j >= shortBlocks) codewords.push(block[i]);
      });
    }

    // Patrones de función.
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    const align = alignmentPositions(version, size);
    align.forEach((ax, i) =>
      align.forEach((ay, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
        if (corner) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }),
    );
    const drawFormat = (mask) => {
      const value = (ECC[ecl].bits << 3) | mask;
      let rem = value;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const format = ((value << 10) | rem) ^ 0x5412;
      const bit = (i) => ((format >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const info = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((info >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }

    // Datos en zigzag, de derecha a izquierda en pares de columnas.
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && index < codewords.length * 8) {
            modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
            index++;
          }
        }
      }
    }

    // Máscara con menor penalización (legibilidad).
    const applyMask = (mask) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
    };
    const penalty = () => {
      let score = 0;
      const lines = [...modules, ...modules.map((_, x) => modules.map((row) => row[x]))];
      for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && line[i] === line[i - 1]) run++;
          else {
            if (run >= 5) score += run - 2;
            run = 1;
          }
        }
        const pattern = line.map((d) => (d ? '1' : '0')).join('');
        for (const finderLike of ['10111010000', '00001011101']) {
          for (let at = pattern.indexOf(finderLike); at !== -1; at = pattern.indexOf(finderLike, at + 1)) score += 40;
        }
      }
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
        }
      }
      const dark = modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
      return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormat(mask);
      const score = penalty();
      if (score < bestScore) [best, bestScore] = [mask, score];
      applyMask(mask); // deshace (XOR)
    }
    applyMask(best);
    drawFormat(best);
    return { size, version, mask: best, modules };
  }

  /** SVG escalable con 4 módulos de margen blanco (necesario para que los teléfonos lo lean). */
  function svg(text, { ecl = 'M', label = 'Código QR' } = {}) {
    const { size, modules } = encode(text, ecl);
    const border = 4;
    const total = size + border * 2;
    let path = '';
    modules.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x + border} ${y + border}h1v1h-1z`)));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  return { encode, svg };
})();
