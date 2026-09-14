// physics.js — integración Euler + AABB. Stateless: una función pura por
// cada cosa. La GameSession llama `step()` cada frame con el Dino y la lista
// de obstáculos activos.
//
// Por qué separado del Dino: la entidad solo expone estado (vy, grounded) y
// acciones (jump). El "cómo" se mueve y "cómo" colisiona vive aquí, lo que
// facilita testear el sistema en aislamiento (no necesitas instanciar Pixi
// para validar la matemática).

import {
    GRAVITY,
    GROUND_OFFSET_PX,
    DINO_X,
    DINO_SIZE,
    DINO_HITBOX_PADDING,
    DUCK_SIZE,
    DUCK_HITBOX_PADDING,
    JUMP_VELOCITY,
    JUMP_CUT_MULTIPLIER,
    FAST_FALL_MULTIPLIER,
    COYOTE_TIME_S,
    OBSTACLE_HITBOX_PADDING,
} from '../config.js';

/**
 * Calcula `groundY` en stage coords, dado la altura del viewport.
 * groundY es la coordenada Y del SUELO (no de la base del Dino) — es donde
 * los obstáculos se asientan también.
 */
export function computeGroundY(viewportHeight) {
    return viewportHeight - GROUND_OFFSET_PX;
}

/**
 * Integra una unidad de tiempo sobre el Dino: gravedad variable, movimiento,
 * clamp al suelo, flag `grounded` y timers de feel (coyote / jump buffer).
 * Mutación in-place del Dino — ahorramos GC pressure en el frame loop.
 *
 * Gravedad variable (rediseño Jul 2026):
 *   - Subiendo con el botón ya soltado → gravedad × JUMP_CUT_MULTIPLIER
 *     (soltar pronto = salto corto; mantener = salto completo).
 *   - fast-fall (↓ en el aire) → gravedad × FAST_FALL_MULTIPLIER, y anula el
 *     corte de salto (la intención "bajar YA" gana).
 *
 * @param {import('../entities/Dino.js').Dino} dino
 * @param {number} dt        Delta time en segundos.
 * @param {number} groundY   Coordenada Y del suelo (= computeGroundY(viewportHeight)).
 */
export function integrateDino(dino, dt, groundY) {
    let g = GRAVITY;
    if (dino.fastFall) {
        g = GRAVITY * FAST_FALL_MULTIPLIER;
    } else if (dino.vy < 0 && !dino.jumpHeld) {
        g = GRAVITY * JUMP_CUT_MULTIPLIER;
    }

    // El "y" del Dino es la esquina superior. La base del Dino está en
    // `dino.y + DINO_SIZE.h`. Cuando esa base toca groundY, el Dino aterriza.
    dino.vy += g * dt;
    dino.y += dino.vy * dt;

    const baseY = dino.y + DINO_SIZE.h;
    if (baseY >= groundY) {
        dino.y = groundY - DINO_SIZE.h;
        dino.vy = 0;
        dino.grounded = true;
        dino.coyoteT = COYOTE_TIME_S;
        dino.fastFall = false;
    } else {
        dino.grounded = false;
        dino.coyoteT = Math.max(0, dino.coyoteT - dt);
    }

    // El jump buffer decae siempre; GameSession lo consume al aterrizar.
    if (dino.jumpBufferT > 0) {
        dino.jumpBufferT = Math.max(0, dino.jumpBufferT - dt);
    }
}

// --------------------------- Acciones del cuerpo ---------------------------
//
// La parte FÍSICA de las acciones del Dino vive aquí, no en la entidad (Ola 3).
// `Dino.jump()` añade encima solo lo visual (squash & stretch). Separarlo
// permite que el simulador headless de jugabilidad (`playability.js`) ejecute
// exactamente las mismas reglas que la partida real, sin instanciar Pixi. Si
// alguien retoca el coyote time o el salto, el simulador lo hereda solo — no
// hay una segunda copia de la física que se pueda desincronizar.
//
// "Cuerpo" = cualquier objeto con los campos de estado físico del Dino
// (`vy, y, grounded, ducking, fastFall, jumpHeld, coyoteT, jumpBufferT, dead`).

/**
 * Aplica el impulso de salto si el cuerpo está en el suelo o en coyote time.
 * Saltar cancela el agachado (el salto gana).
 *
 * @param {object} body
 * @returns {boolean} true si el salto se ejecutó.
 */
export function applyJump(body) {
    if (body.dead) return false;
    if (!body.grounded && body.coyoteT <= 0) return false;
    body.vy = -JUMP_VELOCITY;
    body.grounded = false;
    body.coyoteT = 0;
    body.jumpHeld = true;
    body.ducking = false;
    body.fastFall = false;
    return true;
}

/**
 * Empieza a agacharse: en el suelo baja el hitbox; en el aire activa fast-fall.
 * @param {object} body
 * @returns {boolean} true si pasó de pie a agachado (la entidad lo usa para el squash).
 */
export function applyDuckStart(body) {
    if (body.dead) return false;
    const wasStanding = !body.ducking;
    body.ducking = true;
    if (!body.grounded) body.fastFall = true;
    return wasStanding;
}

/** @param {object} body */
export function applyDuckEnd(body) {
    body.ducking = false;
    body.fastFall = false;
}

/**
 * Segundos desde el despegue hasta el ápice de un salto COMPLETO (botón
 * mantenido). Deriva de la física, no es una constante suelta: si se retunea
 * `JUMP_VELOCITY` o `GRAVITY`, todo lo que dependa de esto (el adelanto con el
 * que el spawner coloca los obstáculos) se reajusta solo.
 */
export function jumpApexTimeS() {
    return JUMP_VELOCITY / GRAVITY;
}

/**
 * Adelanto entre el instante musical de un evento (`chart.events[].t`, cuando
 * el jugador debe actuar) y el instante en que el centro del obstáculo cruza
 * al Dino.
 *
 * Por defecto es el tiempo al ápice del salto. Medido con la física real
 * (ver tests/js/playability.test.mjs): la pulsación que maximiza el margen de
 * error ante un cactus cae 0.355-0.36 s antes del cruce a 250, 350, 450 y 600
 * px/s — el ápice. Y para el ptero ese mismo adelanto queda holgado dentro de
 * su ventana. Un único adelanto para todo da una regla simple al jugador:
 * "actúa sobre el beat".
 *
 * Un kind futuro puede declarar `actionLeadS` propio en OBSTACLE_KIND si su
 * mecánica lo necesita.
 *
 * @param {{ actionLeadS?: number }} def  Entrada de OBSTACLE_KIND.
 */
export function actionLeadS(def) {
    return def.actionLeadS ?? jumpApexTimeS();
}

/**
 * X (borde izquierdo) de un obstáculo en un instante de canción dado.
 *
 * Es LA fórmula de la sincronía (Ola 3), compartida por el spawner real y por
 * el simulador de jugabilidad. La posición se DERIVA del reloj de audio en vez
 * de integrarse frame a frame:
 *   - No acumula deriva: aunque haya tirones, cada frame el obstáculo está
 *     exactamente donde la canción dice.
 *   - No depende del ancho de la ventana: el cruce con el Dino ocurre en el
 *     mismo instante musical en un portátil y en un ultrapanorámico. Antes el
 *     obstáculo nacía en el borde derecho EN su instante musical, así que
 *     llegaba 3-7 s tarde y ese retraso cambiaba con el monitor.
 *
 * Ola 5: con velocidad variable, "(cruce − ahora) · velocidad" pasa a ser la
 * distancia que el mundo recorre entre ambos instantes (ver speedProfile.js).
 * El cruce sigue ocurriendo exactamente en `crossT`.
 *
 * @param {{ w: number }} def
 * @param {number} crossT     Instante en que el centro del obstáculo cruza al Dino.
 * @param {number} songTime   Instante actual de canción.
 * @param {number | import('./speedProfile.js').SpeedProfile} speed
 *        Velocidad constante en px/s, o el perfil de velocidad del nivel.
 */
export function obstacleLeftX(def, crossT, songTime, speed) {
    const ahead = typeof speed === 'number' ? (crossT - songTime) * speed : speed.distanceBetween(songTime, crossT);
    return DINO_CENTER_X + ahead - def.w / 2;
}

/** true si el kind se esquiva agachándose (vuela) en vez de saltando. */
export function isDuckKind(def) {
    return def.altitude > 0;
}

// --------------------------- Hitboxes ---------------------------

/**
 * Rectángulo de colisión del Dino en coordenadas de stage.
 * Agachado EN EL SUELO usa el box bajo (anclado a los pies); en el aire o de
 * pie, el box normal. El padding hace que el hitbox perdone más que la silueta.
 *
 * `out` opcional: si se pasa, se rellena y se devuelve ese mismo objeto en vez
 * de crear uno. El simulador de jugabilidad lo usa para no asignar un objeto
 * por paso (decenas de miles por canción).
 *
 * @param {{ x: number, y: number, ducking: boolean, grounded: boolean }} body
 * @param {{ x: number, y: number, w: number, h: number }} [out]
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function dinoHitbox(body, out = { x: 0, y: 0, w: 0, h: 0 }) {
    if (body.ducking && body.grounded) {
        const p = DUCK_HITBOX_PADDING;
        const baseY = body.y + DINO_SIZE.h;
        const left = body.x + (DINO_SIZE.w - DUCK_SIZE.w) / 2;
        out.x = left + p.left;
        out.y = baseY - DUCK_SIZE.h + p.top;
        out.w = DUCK_SIZE.w - p.left - p.right;
        out.h = DUCK_SIZE.h - p.top - p.bottom;
        return out;
    }
    const p = DINO_HITBOX_PADDING;
    out.x = body.x + p.left;
    out.y = body.y + p.top;
    out.w = DINO_SIZE.w - p.left - p.right;
    out.h = DINO_SIZE.h - p.top - p.bottom;
    return out;
}

/**
 * Centro horizontal del hitbox del Dino de pie. Es el punto de referencia del
 * juego: un obstáculo "llega" al Dino cuando su centro cruza este x.
 * Constante porque el Dino nunca se mueve en horizontal.
 */
export const DINO_CENTER_X = DINO_X + DINO_HITBOX_PADDING.left
    + (DINO_SIZE.w - DINO_HITBOX_PADDING.left - DINO_HITBOX_PADDING.right) / 2;

/**
 * Y (esquina superior) de un obstáculo de cierto kind sobre el suelo dado.
 * @param {{ h: number, altitude: number }} def  Entrada de OBSTACLE_KIND.
 * @param {number} groundY
 */
export function obstacleTopY(def, groundY) {
    return groundY - def.h - def.altitude;
}

/**
 * Rectángulo de colisión de un obstáculo cuya esquina superior izquierda está
 * en (x, y).
 * @param {{ w: number, h: number }} def
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, w: number, h: number }} [out]  Ver `dinoHitbox`.
 */
export function obstacleHitbox(def, x, y, out = { x: 0, y: 0, w: 0, h: 0 }) {
    const p = OBSTACLE_HITBOX_PADDING;
    out.x = x + p.left;
    out.y = y + p.top;
    out.w = def.w - p.left - p.right;
    out.h = def.h - p.top - p.bottom;
    return out;
}

/**
 * AABB collision test entre dos hitboxes. Hitbox = { x, y, w, h } en stage coords.
 * @returns {boolean}
 */
export function aabbHit(a, b) {
    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
}

/**
 * Devuelve el primer obstáculo activo que choca con el Dino, o null.
 * No se sale del primer hit — single-hit = game over (decisión del Bloque 5).
 *
 * @param {{ getHitbox: () => any }} dino
 * @param {Array<{ getHitbox: () => any }>} obstacles
 * @returns {object | null}
 */
export function findCollision(dino, obstacles) {
    const dh = dino.getHitbox();
    for (let i = 0; i < obstacles.length; i++) {
        const oh = obstacles[i].getHitbox();
        // Early-exit horizontal: si el obstáculo ya está totalmente a la
        // izquierda o totalmente a la derecha del Dino, no puede chocar.
        if (oh.x + oh.w < dh.x) continue;
        if (oh.x > dh.x + dh.w) continue;
        if (aabbHit(dh, oh)) return obstacles[i];
    }
    return null;
}
