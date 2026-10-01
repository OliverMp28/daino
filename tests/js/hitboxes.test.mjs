// Colisiones que se ven (playtest de Oct 2026).
//
// "Perdió porque supuestamente chocó con el pájaro, pero al ver el juego parado
// el dino no lo toca." La caja del Dino de pie incluía el aire sobre su lomo y
// la del ptero, el de debajo de su cola: levantarse con la cola todavía encima
// era morir a 28 unidades de que nada se tocase.
//
// Regla: cuando el juego da choque, los dos dibujos se pisan, se tocan o les
// falta UNA celda. Se mide con los dibujos y la física reales, en todas las
// posturas del Dino y todas las posiciones (helpers/silhouettes.mjs). Un
// obstáculo o una postura nuevos que no la cumplan hacen fallar esta prueba.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DINO_SIZE, DINO_X, OBSTACLE_KIND, PIXEL_SCALE, STANDING_NOTCH, DINO_HITBOX_PADDING } from '../../resources/js/game/config.js';
import { SPRITES } from '../../resources/js/game/assets/sprites.js';
import {
    FIGURE, aabbHit, bodyFigure, bodyHitbox, bodyState, figureHit, obstacleHit, obstacleHitbox, obstacleRects, obstacleTopY,
} from '../../resources/js/game/systems/physics.js';
import { POSES, solidKindsFor, worstVisibleGap } from './helpers/silhouettes.mjs';

const GROUND = 1000;

/** Aire máximo a la vista en un choque, en celdas: 2 = queda una celda vacía entre los dibujos. */
const MAX_VISIBLE_GAP = 2;

test('cuando el juego da choque, los dibujos se tocan: ninguna postura con ningún obstáculo deja más de una celda de aire', () => {
    for (const pose of Object.keys(POSES)) {
        for (const kind of solidKindsFor(pose)) {
            const w = worstVisibleGap(pose, kind);
            assert.ok(
                w.gap <= MAX_VISIBLE_GAP,
                `${pose} contra ${kind}: ${w.gap} celdas de aire con el Dino a ${w.at?.height} y el obstáculo en x=${w.at?.obstacleX} (${w.at?.frames})`,
            );
        }
    }
});

test('regresión del playtest: con una caja por dibujo se moría a 7 celdas del ptero y a 3-4 de un cristal', () => {
    // La regla de antes: la caja entera del Dino contra la del obstáculo con el
    // relleno común. Documenta el defecto; la de ahora está en la prueba de arriba.
    const old = (figure, bounds, def, x, y, o) => {
        o.x = x + 6;
        o.y = y + (def.surface === 'ceiling' ? 4 : 6);
        o.w = def.w - 12;
        o.h = def.h - 10;
        return aabbHit(bounds, o);
    };
    assert.ok(worstVisibleGap('run', 'PTERO', old).gap >= 6, 'levantarse con la cola del ptero encima');
    assert.ok(worstVisibleGap('jump', 'PTERO', old).gap >= 5);
    assert.ok(worstVisibleGap('flipRise', 'CRYSTAL_FLOOR', old).gap >= 3);
    assert.ok(worstVisibleGap('run', 'PTERO').gap <= 1, 'ahora, el ptero y la cabeza se tocan');
});

test('levantarse cuando el cuerpo del ptero ya pasó de la cabeza no es chocar; con el ptero sobre la cabeza, sí', () => {
    const def = OBSTACLE_KIND.PTERO;
    const body = bodyState(GROUND);
    const box = bodyHitbox(body, { x: 0, y: 0, w: 0, h: 0 });
    const figure = bodyFigure(body);
    const scratch = { x: 0, y: 0, w: 0, h: 0 };
    const top = obstacleTopY(def, GROUND);
    const hitAt = (x) => obstacleHit(figure, box, def, x, top, scratch);
    // La cabeza del Dino empieza en la celda 11 (x = DINO_X + 44).
    const head = DINO_X + 11 * PIXEL_SCALE;
    // La cola del ptero (su caja acaba 20 antes que el dibujo) justo detrás de la cabeza: no toca.
    assert.equal(hitAt(head - (def.w - def.hitPad.right)), false, 'la cola acaba donde empieza la cabeza');
    assert.equal(hitAt(head - (def.w - def.hitPad.right) - 30), false, 'la cola sobre el lomo');
    // Con la caja de antes, ahí se moría.
    assert.equal(aabbHit(box, { x: head - 76 - 30 + 6, y: top + 6, w: def.w - 12, h: def.h - 10 }), true, 'antes, sí');
    // El ptero sobre la cabeza y llegando de frente: choca.
    assert.equal(hitAt(head - 40), true);
    assert.equal(hitAt(head - 2), true, 'el morro llegando a la cabeza');
});

test('el ptero sigue obligando a agacharse: de pie choca al cruzarlo y agachado no lo toca nunca', () => {
    const def = OBSTACLE_KIND.PTERO;
    const top = obstacleTopY(def, GROUND);
    const scratch = { x: 0, y: 0, w: 0, h: 0 };
    const sweep = (body) => {
        const box = bodyHitbox(body, { x: 0, y: 0, w: 0, h: 0 });
        const figure = bodyFigure(body);
        let hits = 0;
        for (let x = DINO_X - def.w - 40; x <= DINO_X + DINO_SIZE.w + 40; x += 2) if (obstacleHit(figure, box, def, x, top, scratch)) hits++;
        return hits;
    };
    const standing = bodyState(GROUND);
    // Recorre 2 unidades por muestra: cruzarlo de pie es chocar durante un buen tramo
    // (a 1000 px/s un paso de física son 8 unidades; no puede colarse entre dos).
    assert.ok(sweep(standing) * 2 >= 60, `de pie choca a lo largo de ${sweep(standing) * 2} unidades`);
    const ducking = bodyState(GROUND);
    ducking.ducking = true;
    assert.equal(sweep(ducking), 0, 'agachado pasa por debajo');
});

test('el hueco de la caja de pie es aire en todos los dibujos del Dino de pie', () => {
    const p = DINO_HITBOX_PADDING;
    for (const name of ['dinoRunA', 'dinoRunB', 'dinoJump', 'dinoDead', 'dinoJumpDead']) {
        const rows = SPRITES[name];
        let solid = 0;
        for (let y = 0; y < rows.length; y++) {
            for (let x = 0; x < rows[y].length; x++) {
                if (rows[y][x] === '.') continue;
                // Celda entera dentro del hueco.
                const x0 = x * PIXEL_SCALE;
                const y0 = y * PIXEL_SCALE;
                if (x0 >= p.left && x0 + PIXEL_SCALE <= p.left + STANDING_NOTCH.w && y0 >= p.top && y0 + PIXEL_SCALE <= p.top + STANDING_NOTCH.h) solid++;
            }
        }
        // La púa de la nuca asoma dos celdas: se perdona.
        assert.ok(solid <= 2, `${name}: ${solid} celdas dibujadas dentro del hueco`);
    }
});

test('figura de pie: solo deja de chocar lo que cabe entero en el hueco, también cabeza abajo', () => {
    const b = { x: 100, y: 200, w: 34, h: 59 };
    const n = STANDING_NOTCH;
    const inNotch = { x: 90, y: 190, w: 10 + n.w, h: 10 + n.h };
    assert.equal(figureHit(FIGURE.BOX, b, inNotch), true);
    assert.equal(figureHit(FIGURE.STANDING, b, inNotch), false, 'dentro del hueco');
    assert.equal(figureHit(FIGURE.STANDING, b, { ...inNotch, w: inNotch.w + 1 }), true, 'llega a la cabeza');
    assert.equal(figureHit(FIGURE.STANDING, b, { ...inNotch, h: inNotch.h + 1 }), true, 'baja hasta el lomo');
    assert.equal(figureHit(FIGURE.STANDING, b, { x: 300, y: 190, w: 10, h: 10 }), false, 'ni toca la caja');
    // Cabeza abajo el hueco está abajo.
    const low = { x: 90, y: b.y + b.h - n.h, w: 10 + n.w, h: n.h + 10 };
    assert.equal(figureHit(FIGURE.STANDING_INVERTED, b, low), false);
    assert.equal(figureHit(FIGURE.STANDING_INVERTED, b, { ...low, y: low.y - 1 }), true);
    assert.equal(figureHit(FIGURE.STANDING, b, low), true, 'de pie, ahí abajo hay cuerpo');
});

test('registro: las piezas y el relleno de cada kind caben en su caja, y su caja envuelve a sus piezas', () => {
    for (const [kind, def] of Object.entries(OBSTACLE_KIND)) {
        const box = obstacleHitbox(def, 0, 0);
        assert.ok(box.w > 0 && box.h > 0, `${kind}: caja con tamaño`);
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= def.w && box.y + box.h <= def.h, `${kind}: la caja no sale del kind`);
        const rects = obstacleRects(def, 0, 0);
        assert.ok(rects.length >= 1);
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        for (const r of rects) {
            assert.ok(r.w > 0 && r.h > 0, `${kind}: pieza con tamaño`);
            x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
        }
        assert.deepEqual([box.x, box.y, box.x + box.w, box.y + box.h], [x0, y0, x1, y1], `${kind}: la caja es la envolvente de sus piezas`);
        // Un paso de física a la velocidad máxima son ~8 unidades: la caja del Dino
        // (34 de ancho) no puede saltarse una pieza entre dos pasos.
        if (def.hitParts) assert.ok(def.hitParts.every((p) => p[2] >= 6), `${kind}: piezas de al menos 6 de ancho`);
    }
});

test('las piezas de lo que cuelga del techo se reflejan con su dibujo', () => {
    const floor = obstacleRects(OBSTACLE_KIND.CRYSTAL_FLOOR, 0, 0);
    const ceil = obstacleRects(OBSTACLE_KIND.CRYSTAL_CEIL, 0, 0);
    const h = OBSTACLE_KIND.CRYSTAL_FLOOR.h;
    assert.equal(floor.length, ceil.length);
    floor.forEach((r, i) => {
        assert.deepEqual([ceil[i].x, ceil[i].w, ceil[i].h], [r.x, r.w, r.h]);
        assert.equal(ceil[i].y, h - r.y - r.h, 'la aguja nace del techo');
    });
});
