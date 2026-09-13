// SHA-256 del contenido de un audio — su identidad (Ola 3).
//
// El hash identifica una canción por sus BYTES, no por su nombre: es la clave
// de las cachés locales, la clave de deduplicado de niveles en el servidor
// (`levels.audio_sha256`) y la garantía de que un chart se juega con el mismo
// audio para el que se generó.
//
// Por qué hay una implementación propia además de `crypto.subtle`:
// `crypto.subtle` SOLO existe en contextos seguros (HTTPS o localhost). Daino
// en desarrollo corre en localhost, pero en cuanto alguien lo abre desde otro
// equipo de la red local por `http://192.168.x.x:8090`, `crypto.subtle` es
// `undefined`. Sin el fallback, esa persona perdería la caché y no podría
// guardar niveles. La versión nativa se usa siempre que está (más rápida); la
// propia solo cubre ese hueco. Ambas verificadas contra los vectores FIPS
// 180-2 en los tests.

/**
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Promise<string>} hash en hexadecimal minúsculas (64 caracteres)
 */
export async function sha256Hex(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const subtle = globalThis.crypto?.subtle;
    if (subtle !== undefined) {
        try {
            const digest = await subtle.digest('SHA-256', bytes);
            return toHex(new Uint8Array(digest));
        } catch {
            // Algunos navegadores exponen subtle pero lo rechazan fuera de
            // contexto seguro: caer al fallback en vez de romper.
        }
    }
    return toHex(sha256Fallback(bytes));
}

/**
 * Implementación de referencia de SHA-256 (FIPS 180-4) sobre bytes.
 * Exportada para los tests; el código de producción debe usar `sha256Hex`.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} 32 bytes
 */
export function sha256Fallback(bytes) {
    const K = SHA256_K;
    const h = new Int32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);

    const bitLen = bytes.length * 8;
    // Relleno: 0x80, ceros, y la longitud en bits (64 bits big-endian).
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    // JS no tiene enteros de 64 bits cómodos: parte alta y baja por separado.
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(padded.length - 4, bitLen >>> 0, false);

    const w = new Int32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s15 = w[i - 15];
            const s2 = w[i - 2];
            const r1 = ((s15 >>> 7) | (s15 << 25)) ^ ((s15 >>> 18) | (s15 << 14)) ^ (s15 >>> 3);
            const r2 = ((s2 >>> 17) | (s2 << 15)) ^ ((s2 >>> 19) | (s2 << 13)) ^ (s2 >>> 10);
            w[i] = (r1 + w[i - 7] + r2 + w[i - 16]) | 0;
        }

        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
            const t1 = (hh
                + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)))
                + ((e & f) ^ (~e & g))
                + K[i] + w[i]) | 0;
            const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)))
                + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g; g = f; f = e;
            e = (d + t1) | 0;
            d = c; c = b; b = a;
            a = (t1 + t2) | 0;
        }
        h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
        h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outView.setInt32(i * 4, h[i], false);
    return out;
}

function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
}

const SHA256_K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
