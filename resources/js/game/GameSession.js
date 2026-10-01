// GameSession — orquestador de un run del juego. Recibe el engine (Pixi),
// el AudioEngine, el audio decodificado y el chart, y conecta todas las piezas:
// monta Dino + spawner + HUD + emisor de bursts, suscribe Input (salto,
// salto variable, agacharse), registra el tick en el ticker global de Pixi,
// escucha pause/resume del audio y alimenta el pulso de beat del shader.
//
// Una sola sesión activa a la vez. `start()` arranca; `stop({reason})`
// limpia. Reiniciar = stop() + new GameSession(...).
//
// Ola 3 — la sesión es la ÚNICA dueña del tiempo de la partida: arranca ella
// misma la reproducción al final de `start()`, cuando todo está montado, y lee
// el instante de canción OÍDO (`getSongTime`, con la latencia de salida
// descontada) cada frame. Los obstáculos se colocan a partir de ese instante,
// no se integran, así que no hay deriva posible entre lo que suena y lo que se ve.
//
// Secuencia de muerte (rediseño Jul 2026): impacto → hit-stop (mundo
// congelado HITSTOP_S, audio cortado en seco, estallido de partículas,
// flash blanco) → screen shake con decay → _end('collision'). Total ~0.45s
// de "golpe" antes del game over — el juice que el placeholder no tenía.
//
// Ola 5 — la partida vive la ESTRUCTURA de la canción, no solo su volumen:
//   - La velocidad del mundo cambia por tramos (world.speedChanges).
//   - Todo late con los beats reales: fondo, línea del suelo y obstáculos; el
//     primer tiempo de cada compás, más.
//   - Cada tramo tiene su intensidad (fondo, ecualizador, partículas) y el
//     clímax se enciende también en el HUD.
//   - En un drop: destello, golpe de cámara y ola de partículas justo en el
//     primer tiempo, que es donde el charter pone la acción.
//   - El cielo cuenta la canción (T01): de la tarde al atardecer, la
//     noche con el clímax y el amanecer con el final (scenes/skyClock.js).
//   - Pulsar exactamente en el golpe suelta un destello a los pies del Dino.
//   - Pasado el último obstáculo, "¡Superado!" mientras la canción termina.
//
// Afinado de velocidad (Sep 2026) — el mundo sube de marcha hacia el clímax y
// se ve venir: la barra de progreso lleva el mapa de la canción con cada
// acelerón marcado; en los compases previos a uno, el suelo late a doble
// tiempo y su chevrón parpadea; al llegar, ráfaga de líneas de velocidad y
// marcha nueva, y las líneas siguen más cuanto más rápido va el nivel.
//
// Ola 6 — modos de movimiento: los portales del chart cambian las reglas del
// Dino en su paso de física (antigravedad, vuelo). El vuelo trae su túnel
// (systems/flightCourse.js): la misma geometría se dibuja (FlightTunnel), se
// choca aquí y la valida el charter.
//
// Ola 6c — activadores (anillos de salto): se colocan con los obstáculos y, en el
// paso de física, el que toca el hitbox se aplica con las reglas del modo
// (physics.applyTrigger), igual que en el simulador del charter.

import { Dino } from './entities/Dino.js';
import { Obstacle } from './entities/Obstacle.js';
import { createSpawner } from './systems/spawner.js';
import { createBeatClock } from './systems/beatClock.js';
import { createSongDirector } from './systems/songDirector.js';
import { createSpeedCues } from './systems/speedCues.js';
import { planSky } from './scenes/skyClock.js';
import { resolveScene, sceneCycle } from './scenes/registry.js';
import { speedProfileOf } from './systems/speedProfile.js';
import { obstacleEvents } from './levels/chartFormat.js';
import { createBurstEmitter } from './entities/ParticleLayer.js';
import { createModeGates } from './entities/ModeGates.js';
import { createFlightTunnel } from './entities/FlightTunnel.js';
import { createFlightCourse } from './systems/flightCourse.js';
import { createHud } from '../ui/hud.js';
import { Input } from './systems/input.js';
import { BODY_EVENT, applyTrigger, bodyHitbox, ceilingYOf, computeGroundY, enterMode, integrateBody } from './systems/physics.js';
import { toSimTriggers } from './systems/playability.js';
import { createModeTimeline } from './systems/modeTimeline.js';
import { MOVEMENT_MODES } from './systems/modes/index.js';
import { createFixedStepper } from './systems/fixedStep.js';
import { createInputTimeline, songTimeOfEvent } from './systems/inputTimeline.js';
import { countMechanicSeen, countModeSeen } from '../ui/settings.js';
import {
    DT_CAP_S, DINO_SIZE, MODE_COLORS, OBSTACLE_KIND,
    SHAKE, HITSTOP_S, DEATH_FLASH, SCENERY, RUN_DUST,
    PHYSICS_STEP_S, MAX_PHYSICS_CATCHUP_S, DROP_FX, ON_BEAT, GEAR_FX, MODE_FX, FLY_JET, JUMP_RING_FX, DOUBLE_JUMP_FX,
} from './config.js';
import { request as apiRequest } from '../api/client.js';
import { Graphics } from 'pixi.js';

export class GameSession {
    /**
     * @param {object} cfg
     * @param {ReturnType<import('./engine.js').startEngine> extends Promise<infer T> ? T : never} cfg.engine
     * @param {import('./audio/AudioEngine.js').AudioEngine} cfg.audioEngine
     * @param {AudioBuffer} cfg.audioBuffer   Canción decodificada. La sesión la reproduce.
     * @param {import('./levels/chartFormat.js').Chart} cfg.chart  Ya normalizado.
     * @param {string} [cfg.title]            Nombre a mostrar en el HUD.
     * @param {number | null} [cfg.levelId]   Id del row `levels` en el servidor.
     *        Si != null y la run termina con 'win'|'collision', dispara
     *        POST /api/progress fire-and-forget. Anónimo: null → no llama.
     * @param {() => void} [cfg.onGameOver]   Callback cuando el run termina (lose/win).
     */
    constructor(cfg) {
        this.engine = cfg.engine;
        this.audioEngine = cfg.audioEngine;
        this.audioBuffer = cfg.audioBuffer;
        this.chart = cfg.chart;
        this.title = cfg.title ?? '';
        this.levelId = cfg.levelId ?? null;
        this.skinId = cfg.skinId ?? 'classic';
        this.onGameOver = cfg.onGameOver ?? (() => {});
        /** Número de intento de este nivel (reintentos sin salir): el HUD lo anuncia desde el 2. */
        this.attempt = cfg.attempt ?? 1;
        /** Enseñar los controles al empezar (primeras partidas del jugador). */
        this.showControls = cfg.showControls === true;

        this.dino = null;
        this.spawner = null;
        this.hud = null;
        this._bursts = null;
        this._flash = null;
        this._jumpHandler = null;
        this._jumpEndHandler = null;
        this._duckStartHandler = null;
        this._duckEndHandler = null;
        this._pauseHandler = null;
        this._resumeHandler = null;
        this._ticker = null;
        this._tickFn = null;
        this._isPaused = false;
        this._isRunning = false;
        /** Terminó (victoria o choque) pero sigue en pantalla bajo el panel de resultados. */
        this._ended = false;
        /** Suelo del frame anterior, en unidades de mundo (null antes de empezar). */
        this._groundY = null;
        this._hintsShown = false;
        this._attemptBanner = false;
        this._score = 0;
        this._dying = false;
        this._dieT = 0;
        this._dustT = 0;
        this._finalSongTime = 0;
        // Perfil de velocidad del nivel (Ola 5): constante en charts de formato 1.
        this._speed = speedProfileOf(this.chart);
        this._speedPxS = this._speed.base;
        // La partida dura lo que dura el audio REAL decodificado: es lo que
        // suena. El chart trae su propia duración, pero un decodificador
        // distinto puede diferir en unos ms de relleno del MP3.
        this._durationSec = this.audioBuffer.duration;
        // Pulso: los beats reales si el chart los trae (formato 2); si no, los
        // obstáculos, que ya caen sobre golpes (Ola 3).
        const beats = this.chart.music.beats ?? [];
        this._beatClock = beats.length >= 8
            ? createBeatClock(beats, this.chart.music.beatPeriodS, this.chart.music.downbeats ?? [])
            : createBeatClock(obstacleEvents(this.chart).map((e) => e.t), this.chart.music.beatPeriodS);
        this._director = createSongDirector(this.chart);
        // Hora del cielo de cada instante (T01): el plan se ancla a la
        // estructura del chart, con el ciclo de la escena vigente. Una historia
        // de autor (T02.6) lee también sus efectos de estructura (los drops).
        this._sky = planSky(
            {
                sections: this.chart.events.filter((e) => e.type === 'section'),
                fx: this.chart.events.filter((e) => e.type === 'fx'),
                durationSec: this._durationSec,
            },
            sceneCycle(this.engine.getScene?.() ?? resolveScene()),
        );
        /** Rótulos de la historia de autor (T02.6): instante de canción, texto y duración. */
        this._captions = this._sky.story?.captions ?? [];
        this._captionAt = -1;
        /**
         * Sus instantes clave (el destello verde) y sus rótulos: ahí las líneas
         * de velocidad se apartan.
         */
        this._storyHolds = [
            ...(this._sky.story?.holds ?? []),
            ...this._captions.map((c) => ({ t0: c.t, t1: c.t + c.holdS })),
        ];
        /** Epílogo del cielo tras superar el nivel (se pone el sol o sale). */
        this._skyEpilogue = null;
        /** Hora del cielo que se está viendo (de ella arranca el epílogo). */
        this._skyHourNow = this._sky.hourAt(0);
        // Marchas y acelerones (afinado de velocidad).
        this._speedCues = createSpeedCues(this.chart, this._speed);
        this._gearMomentAt = Infinity;
        /** Instantes de drops y lifts: una marcha que cae en uno no suma otro momento. */
        this._momentTimes = this.chart.events.filter((e) => e.type === 'fx').map((e) => e.t);
        // Modos de movimiento (Ola 6a): portales del chart, su línea de tiempo y
        // lo que el HUD anuncia antes de cada uno.
        this._modes = createModeTimeline(this.chart.events);
        this._modeIdx = 0;
        this._gates = null;
        /** Cómo se juega cada modo, solo para los que alguien aún está aprendiendo. */
        this._modeHints = {};
        this._modeCue = '';
        /**
         * Activadores que alguien aún está aprendiendo (Ola 6c): el primero de cada
         * kind, con su texto. Se anuncian como el portal de un modo.
         * @type {Array<{ t: number, label: string, hint: string, color: number }>}
         */
        this._mechanicCues = [];
        // Vuelo (Ola 6b): el túnel que dibujan las notas mantenidas.
        this._course = createFlightCourse(this.chart.events);
        this._tunnel = null;
        this._jetT = 0;
        this._jetColor = 0;
        this._wasThrusting = false;
        this._nozzle = { x: 0, y: 0 };
        this._climaxGlow = 0;
        this._dropT = Infinity;       // segundos desde el último drop/lift (∞ = ninguno)
        this._momentStrength = 1;     // 1 drop, < 1 lift
        this._momentColor = DROP_FX.overlayColor;
        this._dropOverlay = undefined; // destello del drop, se crea en el primero
        this._cleared = false;        // ya no quedan obstáculos por cruzar
        /** Obstáculos y notas del vuelo por instante de acción, para reconocer pulsaciones en el golpe. */
        this._onBeatTargets = [
            ...obstacleEvents(this.chart)
                .filter((e) => OBSTACLE_KIND[e.kind].trigger === undefined)
                .map((e) => ({ t: e.t, action: OBSTACLE_KIND[e.kind].action, claimed: false })),
            ...this._course.spans.flatMap((s) => s.holds.map((h) => ({ t: h.t, action: 'hold', claimed: false }))),
        ].sort((a, b) => a.t - b.t);
        this._onBeatCursor = 0;
        // Física a paso fijo sincronizada con el reloj de la canción.
        this._physics = createFixedStepper({ stepS: PHYSICS_STEP_S, maxCatchUpS: MAX_PHYSICS_CATCHUP_S });
        this._hitbox = { x: 0, y: 0, w: 0, h: 0 };
        /** Pulsaciones pendientes, fechadas en tiempo de canción. */
        this._inputs = createInputTimeline();
    }

    start() {
        if (this._isRunning) return;
        this._isRunning = true;

        const layers = this.engine.getLayers();
        const ticker = this.engine.getTicker();
        if (!layers || !ticker) {
            throw new Error('GameSession.start: engine sin layers/ticker — ¿startEngine se completó?');
        }
        this._ticker = ticker;
        this._layers = layers;

        const groundY = this._view().groundY;
        this._groundY = groundY;

        // Dino (con el skin elegido por el user en AJUSTES).
        this.dino = new Dino({ skinId: this.skinId, reducedMotion: this.engine.reducedMotion });
        this.dino.y = groundY - DINO_SIZE.h;
        layers.gameLayer.addChild(this.dino);

        // Spawner: coloca los obstáculos del chart a partir del tiempo de canción.
        this.spawner = createSpawner({
            events: this.chart.events,
            speed: this._speed,
            layer: layers.gameLayer,
            createObstacle: (kind) => new Obstacle(kind),
        });

        // Portales y techo de los modos, POR DETRÁS del Dino y los obstáculos:
        // el Dino atraviesa el portal, no pasa por delante.
        this._gates = createModeGates({ changes: this._modes.changes, speed: this._speed });
        layers.gameLayer.addChildAt(this._gates.container, 0);
        // Muros del vuelo, detrás de los portales (el aro se ve delante del túnel).
        this._tunnel = createFlightTunnel({ course: this._course, speed: this._speed });
        layers.gameLayer.addChildAt(this._tunnel.container, 0);

        // Bursts (polvo de aterrizaje, estallido de muerte) sobre el gameLayer.
        this._bursts = createBurstEmitter(layers.gameLayer);

        // HUD DOM (#hud-root). El hudLayer del canvas queda para el flash.
        this.hud = createHud();
        this.hud.update(0, 0, this._durationSec);
        if (this.title) this.hud.setSong(this.title);
        // Reintento: "Intento N" al arrancar (se retira solo en `_tick`).
        this._attemptBanner = this.attempt > 1;
        if (this._attemptBanner) this.hud.setBanner?.(`Intento ${this.attempt}`);
        if (this.showControls) {
            this.hud.setControls?.(true);
            this._hintsShown = true;
        }
        // Las primeras veces que alguien se encuentra un modo, su aviso explica
        // cómo se juega (en táctil, tocar; con teclado, la tecla). Cada modo lleva
        // su cuenta y su texto (systems/modes/).
        const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        for (const m of new Set(this._modes.changes.map((c) => c.mode))) {
            if (m === 'run' || countModeSeen(m) > MODE_FX.hintRuns) continue;
            const hint = MOVEMENT_MODES[m].hint;
            this._modeHints[m] = touch ? hint.touch : hint.keys;
        }
        const firstTrigger = new Map();
        for (const tr of toSimTriggers(this.chart.events)) if (!firstTrigger.has(tr.kind)) firstTrigger.set(tr.kind, tr);
        for (const [kind, tr] of firstTrigger) {
            const hint = tr.def.hint;
            if (hint === undefined || countMechanicSeen(kind) > MODE_FX.hintRuns) continue;
            this._mechanicCues.push({ t: tr.t, label: hint.label, hint: touch ? hint.touch : hint.keys, color: hint.color });
        }
        this.hud.setRoadmap?.({
            durationSec: this._durationSec,
            sections: this.chart.events.filter((e) => e.type === 'section'),
            speedUps: this._speedCues.ups.map((u) => u.at),
            // Los tramos con otras reglas, marcados en el mapa con su color.
            modes: this._modes.segments
                .filter((s) => s.mode !== 'run')
                .map((s) => ({ t0: s.t0, t1: Math.min(s.t1, this._durationSec), color: MODE_COLORS[s.mode] })),
        });
        this.hud.setGear?.(0);

        // El mundo scrollea a la velocidad de la canción; el fondo arranca con
        // la intensidad del primer tramo y el cielo a la hora del principio.
        this.engine.setWorldSpeed(this._speedPxS);
        this.engine.setMusicState?.({ intensity: this._director.intensity, climax: 0, flash: 0 });
        this.engine.setSkyHour?.(this._sky.hourAt(0));
        this.engine.setSpeedFx?.({ level: 0 });

        // Input. Las pulsaciones NO se aplican al leerse: se fechan en tiempo de
        // canción y cada paso de física aplica las suyas (ver inputTimeline.js).
        Input.setup();
        this._jumpHandler = (p) => this._queueInput('jump', p);
        this._jumpEndHandler = (p) => this._queueInput('jumpEnd', p);
        this._duckStartHandler = (p) => this._queueInput('duckStart', p);
        this._duckEndHandler = (p) => this._queueInput('duckEnd', p);
        Input.on('jump', this._jumpHandler);
        Input.on('jumpEnd', this._jumpEndHandler);
        Input.on('duckStart', this._duckStartHandler);
        Input.on('duckEnd', this._duckEndHandler);

        // Pausa/resume vienen del AudioEngine (statechange + Page Visibility).
        // Al volver, nada se da por mantenido: una tecla soltada con la pestaña
        // oculta no llega, y el Dino subiría solo hasta el techo del túnel.
        this._pauseHandler = () => { this._isPaused = true; };
        this._resumeHandler = () => {
            this._isPaused = false;
            if (this.dino !== null) this.dino.flyHeld = 0;
        };
        window.addEventListener('audio:pause', this._pauseHandler);
        window.addEventListener('audio:resume', this._resumeHandler);

        // Ticker.
        this._tickFn = (t) => this._tick(t);
        ticker.add(this._tickFn);

        // El reloj de la partida arranca AQUÍ, con todo montado. Cualquier
        // trabajo previo (crear sprites, instalar listeners) queda fuera del
        // tiempo de canción en vez de comerse los primeros milisegundos.
        this.audioEngine.play(this.audioBuffer);
    }

    /** Vista del mundo vigente (engine); sin engine con vista, la de la ventana a escala 1. */
    _view() {
        const v = this.engine.getView?.();
        if (v) return v;
        return { width: window.innerWidth, height: window.innerHeight, groundY: computeGroundY(window.innerHeight), scale: 1 };
    }

    _tick(tickerArg) {
        // Cap del dt — al volver de bg el deltaMS puede ser enorme y meter
        // al Dino bajo el suelo de un salto. DT_CAP_S protege la integración.
        const dt = Math.min(DT_CAP_S, tickerArg.deltaMS / 1000);

        // Terminada, bajo el panel de resultados: la escena no se congela a
        // medias. Las partículas del choque terminan de caer y, tras superar el
        // nivel, el Dino sigue trotando.
        if (this._ended) {
            this._bursts?.tick(dt);
            this.dino?.tickVisual(dt, SCENERY.menuSpeed * 2);
            this._tickSkyEpilogue(dt);
            return;
        }
        if (!this._isRunning || this._isPaused) return;

        // ---------- Secuencia de muerte (mundo congelado) ----------
        if (this._dying) {
            this._dieT += dt;

            // El estallido de partículas sigue animando durante el freeze.
            this._bursts.tick(dt);
            this.dino.tickVisual(dt, this._speedPxS);

            // Flash blanco con fade.
            if (this._flash) {
                const k = Math.min(1, this._dieT / DEATH_FLASH.durationS);
                this._flash.alpha = DEATH_FLASH.alpha * (1 - k);
            }

            // Screen shake tras el hit-stop, con decay lineal.
            if (this._dieT > HITSTOP_S) {
                const shakeT = this._dieT - HITSTOP_S;
                const k = Math.max(0, 1 - shakeT / SHAKE.durationS);
                const mag = SHAKE.magnitudePx * k;
                const dx = (Math.random() * 2 - 1) * mag;
                const dy = (Math.random() * 2 - 1) * mag;
                this._layers.gameLayer.position.set(dx, dy);
                this._layers.sceneryLayer.position.set(dx * 0.6, dy * 0.6);

                if (shakeT >= SHAKE.durationS) {
                    this._layers.gameLayer.position.set(0, 0);
                    this._layers.sceneryLayer.position.set(0, 0);
                    this._end('collision');
                }
            }
            return;
        }

        // ---------- Frame normal ----------
        const songTime = this.audioEngine.getSongTime();
        const shownTime = Math.max(0, songTime);
        const view = this._view();
        const groundY = view.groundY;
        // La vista cambió (resize, rotación): el suelo se mueve en unidades de
        // mundo y el Dino se mueve con él, en el aire o no. Sin esto, al subir
        // el suelo el Dino quedaría enterrado un paso y al bajar caería solo.
        if (this._groundY !== null && groundY !== this._groundY) this.dino.y += groundY - this._groundY;
        this._groundY = groundY;

        // Rótulo del intento y controles: fuera antes de que llegue la primera acción.
        if (this._attemptBanner && shownTime > 1.6) {
            this._attemptBanner = false;
            if (!this._cleared) this.hud.setBanner?.('');
        }
        if (this._hintsShown && (shownTime > 2.6 || this._inputs.size > 0)) {
            this._hintsShown = false;
            this.hud.setControls?.(false);
        }

        // Física a PASO FIJO hasta el instante de canción actual. Cada paso
        // integra el Dino y comprueba la colisión con los obstáculos en ese
        // mismo instante. Un frame de 160 ms ejecuta ~19 pasos; uno de 8 ms,
        // ninguno o uno. Así el salto nunca se queda atrás de la música.
        //
        // Va ANTES de `spawner.tick`: el spawner recicla al final del frame los
        // obstáculos que ya salieron por la izquierda, y un paso anterior de
        // este mismo frame todavía podría necesitarlos para la colisión.
        const collided = this._physics.advance(songTime, (t) => this._physicsStep(t, groundY));

        // Spawner: coloca cada sprite donde el tiempo de canción dice; los
        // portales y el techo del modo, con la misma fórmula.
        this.spawner.tick(songTime, dt, { width: view.width, groundY });
        this._gates.tick(songTime, dt, { width: view.width, groundY });
        this._tunnel.tick(songTime, { width: view.width, groundY });
        // El orbe al alcance del Dino en el aire se ilumina: "pulsa ahora".
        this.spawner.armTrigger(this.dino.grounded
            ? null
            : this.spawner.triggerAt(bodyHitbox(this.dino, this._hitbox), songTime, groundY));

        if (collided) {
            this._startDeath();
            return;
        }

        // Velocidad del mundo en este instante (portales de velocidad, Ola 5).
        this._speedPxS = this._speed.speedAt(shownTime);
        this.engine.setWorldSpeed(this._speedPxS);

        // Visual del Dino (frames de carrera, squash) y bursts vivos.
        this.dino.tickVisual(dt, this._speedPxS);
        this._bursts.tick(dt);

        this._tickStructure(songTime, shownTime, dt, groundY);

        // Polvo al correr: motita en los pies a intervalo fijo mientras pisa una
        // superficie — vende la velocidad sin coste (1 sprite por emisión).
        // Cabeza abajo, el polvo cae hacia el techo.
        if (this.dino.grounded) {
            this._dustT += dt;
            if (this._dustT >= RUN_DUST.periodS) {
                this._dustT = 0;
                const dir = this.dino.gravityDir;
                this._bursts.burst({
                    x: this.dino.x + 16,
                    y: dir > 0 ? groundY - 2 : ceilingYOf(groundY) + 2,
                    count: 1,
                    color: RUN_DUST.color,
                    speedMin: 15,
                    speedMax: 55,
                    gravity: 220 * dir,
                    lifeS: 0.3,
                    upBias: 0.35 * dir,
                });
            }
        }

        this._tickJetpack(dt);

        // Score: por ahora, score = floor(tiempo de canción * 100).
        this._score = Math.floor(shownTime * 100);
        this.hud.update(this._score, Math.min(shownTime, this._durationSec), this._durationSec);

        // Victoria: la canción terminó Y no queda ningún obstáculo por cruzar.
        // Antes bastaba con que acabara el audio, y como los obstáculos
        // llegaban tarde se ganaba con varios todavía en pantalla.
        if (songTime >= this._durationSec && !this.spawner.hasPendingCrossing(songTime) && songTime >= this._course.lastEnd) {
            this._finalSongTime = this._durationSec;
            this._end('win');
        }
    }

    /**
     * Estructura de la canción en este frame (Ola 5): pulso con acento, rebote
     * de obstáculos, drops, intensidad y progreso del fondo, fase del HUD y el
     * momento en que ya no quedan obstáculos.
     */
    _tickStructure(songTime, shownTime, dt, groundY) {
        let pulse = 0;
        let phase = 0;
        if (songTime >= 0) {
            phase = this._beatClock.phaseAt(songTime);
            pulse = Math.exp(-phase * 4.5) * (this._beatClock.isAccentAt(songTime) ? 1 : 0.7);
        }
        // Subida hacia un acelerón: en sus compases previos el suelo y el fondo
        // laten también a contratiempo, cada vez más. Los obstáculos no: su
        // rebote sigue marcando solo el pulso, que es donde se juega.
        const { ahead, next } = this._speedCues.aheadAt(shownTime);
        // Lo mismo en la subida hacia un drop (Ola 6c, efecto `build` del charter).
        const rise = Math.max(ahead, this._director.build);
        let worldPulse = pulse;
        if (rise > 0 && songTime >= 0) {
            const offbeat = Math.exp(-((phase * 2) % 1) * 4.5) * GEAR_FX.riserPulse;
            worldPulse = Math.max(pulse, offbeat * rise);
        }
        this.engine.setBeatPulse(worldPulse);
        const active = this.spawner.getActive();
        for (let i = 0; i < active.length; i++) active[i].setBeat?.(pulse);
        this._gates.setBeat(pulse);
        this._tunnel.setBeat(pulse);
        this._tickModeCue(shownTime);

        this._tickCaptions(shownTime);
        const fired = this._director.update(shownTime, dt);
        for (let i = 0; i < fired.length; i++) {
            if (fired[i].fx === 'drop') this._triggerMoment(groundY, 1);
            else if (fired[i].fx === 'lift') this._triggerMoment(groundY, DROP_FX.liftStrength);
        }

        // Acelerón: ráfaga de líneas y marcha nueva al instante (la pulsación
        // previa al primer tiempo); en ese primer tiempo, un momento discreto
        // si allí no cae ya un drop o un lift.
        const ups = this._speedCues.update(shownTime);
        const hush = this._storyHushAt(shownTime);
        for (let i = 0; i < ups.length; i++) {
            if (hush < 0.5) this.engine.setSpeedFx?.({ burst: true });
            this.hud.bumpGear?.();
            if (!this._momentTimes.some((t) => Math.abs(t - ups[i].at) < 0.05)) this._gearMomentAt = ups[i].at;
        }
        if (shownTime >= this._gearMomentAt) {
            this._gearMomentAt = Infinity;
            this._triggerMoment(groundY, GEAR_FX.strength);
        }
        // Con el pasillo de un modo en pantalla, las líneas de velocidad se
        // quedan por encima de él: una raya a la altura del techo se leería
        // como un obstáculo.
        // En un break (Ola 6c) el mundo contiene la respiración: sin líneas de velocidad.
        // Tampoco en los instantes clave de una historia de autor (T02.6): el
        // cielo es suyo.
        this.engine.setSpeedFx?.({
            level: this._speedCues.linesAt(shownTime) * (1 - this._director.calm) * (1 - hush),
            clearAbove: this._corridorNear(shownTime) ? MODE_FX.linesClearPx : 0,
        });
        this.hud.setGear?.(this._speedCues.gearAt(shownTime), { next: next?.gear ?? null, blink: ahead > 0 && phase < 0.5 });

        const climaxTarget = this._director.climax ? 1 : 0;
        const rate = climaxTarget > this._climaxGlow ? 5 : 1.5;
        this._climaxGlow += (climaxTarget - this._climaxGlow) * (1 - Math.exp(-dt * rate));

        // Destello (y, en un drop, golpe de cámara), con caída rápida.
        let flash = 0;
        if (this._dropT < DROP_FX.flashS) {
            this._dropT += dt;
            const k = Math.max(0, 1 - this._dropT / DROP_FX.flashS);
            flash = k * k * this._momentStrength;
            const full = this._momentStrength >= 1;
            if (this._dropOverlay && full) this._dropOverlay.alpha = DROP_FX.overlayAlpha * flash;
            if (full && !this.engine.reducedMotion) {
                const kick = DROP_FX.kickPx * Math.max(0, 1 - this._dropT / DROP_FX.kickS);
                this._layers.gameLayer.position.y = kick;
                this._layers.sceneryLayer.position.y = kick * 0.6;
            }
            if (this._dropT >= DROP_FX.flashS) {
                this._layers.gameLayer.position.y = 0;
                this._layers.sceneryLayer.position.y = 0;
                if (this._dropOverlay) this._dropOverlay.alpha = 0;
            }
        }

        this._skyHourNow = this._sky.hourAt(shownTime);
        this.engine.setSkyHour?.(this._skyHourNow);
        this.engine.setMusicState?.({
            intensity: this._director.intensity,
            climax: this._climaxGlow,
            flash,
            build: this._director.build,
            calm: this._director.calm,
            hue: this._director.hue,
        });
        this.hud.setPhase?.(this._cleared ? 'cleared' : (this._director.climax ? 'climax' : ''));

        // ¡Superado! Ningún obstáculo por cruzar: la canción termina de sonar.
        // (Un túnel de vuelo también hay que cruzarlo entero.)
        if (!this._cleared && this._onBeatTargets.length > 0 && !this.spawner.hasPendingCrossing(songTime - 0.15) && songTime - 0.15 >= this._course.lastEnd) {
            this._onCleared();
        }
    }

    /**
     * Aviso del próximo cambio de reglas y estado del modo vigente (Ola 6a). El
     * portal ya se ve venir por el mundo; el HUD lo nombra y, las primeras veces
     * que alguien juega un modo, dice cómo se juega.
     */
    _tickModeCue(shownTime) {
        if (this._modes.constant && this._mechanicCues.length === 0) return;
        const mode = this._modes.modeAt(shownTime);
        const next = this._modes.nextChange(shownTime);
        const beat = this.chart.music.beatPeriodS || 0.5;
        // Entrar en un modo se avisa con dos compases; volver a correr, con un
        // par de beats: si no, media antigravedad se pasa anunciando su final.
        let state = mode === 'run' ? '' : 'on';
        let shown = mode;
        const warnS = next?.mode === 'run' ? Math.max(1.5, 3 * beat) : Math.max(MODE_FX.warnMinS, MODE_FX.warnBeats * beat);
        if (next !== null && next.t - shownTime <= warnS) {
            state = 'warn';
            shown = next.mode;
        }
        // Sin cambio de reglas a la vista, el primer anillo de alguien que aún no
        // lo conoce se anuncia igual, un par de compases antes.
        let mechanic = null;
        if (state === '') {
            const ahead = Math.max(MODE_FX.warnMinS, MODE_FX.warnBeats * beat);
            mechanic = this._mechanicCues.find((c) => shownTime >= c.t - ahead && shownTime <= c.t + 0.3) ?? null;
        }
        const cue = mechanic !== null ? `mechanic:${mechanic.label}` : `${state}:${shown}`;
        if (cue === this._modeCue) return;
        this._modeCue = cue;
        if (mechanic !== null) {
            this.hud.setMode?.({ state: 'warn', label: mechanic.label, color: mechanic.color, hint: mechanic.hint });
            return;
        }
        this.hud.setMode?.({
            state,
            label: state === '' ? '' : MOVEMENT_MODES[shown].label,
            color: MODE_COLORS[shown] ?? MODE_COLORS.run,
            hint: state === 'warn' && shown !== 'run' ? (this._modeHints[shown] ?? '') : '',
        });
    }

    /** ¿Está el pasillo de un modo en pantalla o a punto de entrar? */
    _corridorNear(shownTime) {
        for (const s of this._modes.segments) {
            if (s.mode === 'run') continue;
            if (shownTime >= s.t0 - 4 && shownTime <= s.t1 + 1) return true;
        }
        return false;
    }

    /** El Dino cruza un portal: cambian las reglas y se nota. */
    _onModeChange(change, groundY) {
        const color = MODE_COLORS[change.mode] ?? MODE_COLORS.run;
        this._triggerMoment(groundY, MODE_FX.strength, color);
        if (this.engine.reducedMotion || this.dino === null) return;
        // Una columna de chispas en el portal, del suelo al techo del pasillo.
        const top = change.mode === 'run' ? groundY - 120 : ceilingYOf(groundY);
        for (let k = 0; k < 5; k++) {
            this._bursts.burst({
                x: this.dino.x + DINO_SIZE.w * 0.5,
                y: groundY - (groundY - top) * (k / 4),
                count: 4,
                color,
                speedMin: 80,
                speedMax: 240,
                gravity: 0,
                lifeS: 0.5,
                upBias: 0,
            });
        }
    }

    /**
     * Momento de la estructura en el primer tiempo de un tramo.
     *   drop (strength 1): destello de pantalla, golpe de cámara y ola de partículas.
     *   lift (strength < 1): el fondo se aviva y una ola más pequeña, sin destello
     *   ni golpe (entrar en un estribillo no debe sentirse como un clímax).
     *   portal (Ola 6a): lo mismo, con el color del modo que empieza.
     */
    _triggerMoment(groundY, strength, color = DROP_FX.overlayColor) {
        // Un drop que cae en el destello verde (T02.6) destella en verde.
        if (color === DROP_FX.overlayColor && (this.engine.getSky?.().flash ?? 0) > DROP_FX.greenFlashMin) color = DROP_FX.greenFlashColor;
        this._dropT = 0;
        this._momentStrength = strength;
        this._momentColor = color;
        if (this.engine.reducedMotion) return;
        // El destello cubre la PANTALLA (hudLayer, px); la ola recorre el MUNDO visible.
        const w = this._view().width;
        const full = strength >= 1;
        if (full) {
            if (this._dropOverlay === undefined) {
                this._dropOverlay = new Graphics();
                this._dropOverlay.blendMode = 'add';
                this._layers.hudLayer.addChild(this._dropOverlay);
            }
            // Se redibuja en cada drop: la ventana puede haber cambiado de tamaño.
            this._dropOverlay.clear().rect(0, 0, window.innerWidth, window.innerHeight).fill(color);
            this._dropOverlay.alpha = DROP_FX.overlayAlpha;
        }
        const bursts = full ? DROP_FX.waveBursts : Math.ceil(DROP_FX.waveBursts / 2);
        for (let k = 1; k <= bursts; k++) {
            this._bursts.burst({
                x: (w * k) / (bursts + 1),
                y: groundY - 2,
                count: 4,
                color: k % 2 === 0 ? 0xff5d7e : 0x8fe0ff,
                speedMin: 90,
                speedMax: 280,
                gravity: 420,
                lifeS: 0.6,
                upBias: 0.9,
            });
        }
    }

    /** Pasado el último obstáculo: rótulo y estallido de celebración. */
    _onCleared() {
        this._cleared = true;
        this.hud.setBanner?.('¡Superado!');
        if (this.engine.reducedMotion || this.dino === null) return;
        const x = this.dino.x + DINO_SIZE.w * 0.5;
        const y = this.dino.y + DINO_SIZE.h * 0.3;
        for (const color of [0x8fe0ff, 0xff5d7e, 0xffd166]) {
            this._bursts.burst({ x, y, count: 12, color, speedMin: 120, speedMax: 380, gravity: 520, lifeS: 0.9, upBias: 0.8 });
        }
    }

    /**
     * ¿La pulsación cae en el golpe de un obstáculo de su tipo? Solo visual: un
     * destello a los pies del Dino. Enseña sin palabras que el nivel está hecho
     * sobre la música y que pulsar SOBRE el golpe es la jugada.
     *
     * En antigravedad cualquier botón invierte y en vuelo cualquiera sube, así
     * que en esos modos cualquiera cuenta.
     */
    _checkOnBeat(input, at) {
        const targets = this._onBeatTargets;
        const matches = (action) => (action === 'flip' || action === 'hold' ? true : action === (input === 'duckStart' ? 'duck' : 'jump'));
        while (this._onBeatCursor < targets.length && targets[this._onBeatCursor].t < at - ON_BEAT.windowS) this._onBeatCursor++;
        for (let i = this._onBeatCursor; i < targets.length && targets[i].t <= at + ON_BEAT.windowS; i++) {
            const target = targets[i];
            if (target.claimed || !matches(target.action)) continue;
            target.claimed = true;
            if (this.engine.reducedMotion || this.dino === null) return;
            this._bursts.burst({
                x: this.dino.x + DINO_SIZE.w * 0.5,
                y: this.dino.y + DINO_SIZE.h - 4,
                count: 8,
                color: ON_BEAT.color,
                speedMin: 110,
                speedMax: 190,
                gravity: 0,
                lifeS: 0.28,
                upBias: 0.05,
            });
            return;
        }
    }

    /** true cuando ya no queda ningún obstáculo por cruzar (la canción puede seguir sonando). */
    get cleared() {
        return this._cleared;
    }

    /**
     * Termina como victoria una partida ya superada (salir desde la pausa
     * durante la outro no debe perder el nivel completado).
     * @returns {boolean} true si se dio por ganada.
     */
    finishCleared() {
        if (!this._isRunning || !this._cleared || this._dying) return false;
        this._finalSongTime = this._durationSec;
        this._end('win');
        return true;
    }

    /**
     * Encola una acción del jugador fechada en el instante en que se pulsó.
     *
     * @param {'jump'|'jumpEnd'|'duckStart'|'duckEnd'} action
     * @param {{ timeStamp?: number }} [payload]  Marca del evento del navegador.
     * @param {number} [songT]  Instante de canción explícito (herramientas y
     *        pruebas); si se da, sustituye a la conversión desde `timeStamp`.
     */
    _queueInput(action, payload, songT) {
        if (!this._isRunning || this.dino === null) return;
        // Empezar un salto o agacharse requiere partida viva; SOLTAR siempre se
        // registra, o un botón soltado durante la pausa quedaría "pulsado".
        const starts = action === 'jump' || action === 'duckStart';
        if (starts && (this._isPaused || this._dying)) return;

        const nowMs = performance.now();
        const at = songT ?? songTimeOfEvent(
            this.audioEngine.getSongTime(),
            payload?.timeStamp ?? nowMs,
            nowMs,
            this._physics.time ?? -Infinity,
        );
        this._inputs.push(action, at);
        if (starts) this._checkOnBeat(action, at);
    }

    /**
     * Un paso fijo de física en el instante de canción `t`.
     *
     * Orden (el mismo que el simulador del charter, playability.js): el portal
     * que toque, las pulsaciones fechadas hasta aquí y la integración con las
     * reglas del modo vigente.
     *
     * @returns {boolean} true si el Dino chocó en este paso.
     */
    _physicsStep(t, groundY) {
        const dino = this.dino;
        const changes = this._modes.changes;
        while (this._modeIdx < changes.length && changes[this._modeIdx].t <= t) {
            const change = changes[this._modeIdx++];
            enterMode(dino, change.mode);
            this._onModeChange(change, groundY);
        }

        this._inputs.drainUntil(t, (action) => dino.input(action));
        const events = integrateBody(dino, PHYSICS_STEP_S, groundY);

        // Aterrizaje (en el suelo o en el techo): squash, polvo y la pulsación
        // guardada, que la física ya ha ejecutado (BUFFERED) y aquí solo se ve.
        if (events & BODY_EVENT.LANDED) {
            dino.onLand();
            const dir = dino.gravityDir;
            this._bursts.burst({
                x: dino.x + DINO_SIZE.w * 0.5,
                y: dir > 0 ? groundY : ceilingYOf(groundY),
                count: 6,
                color: 0x8b9aff,
                speedMin: 30,
                speedMax: 120,
                gravity: 500 * dir,
                lifeS: 0.35,
                upBias: 0.4 * dir,
            });
            if (events & BODY_EVENT.BUFFERED) dino.onGesture(dino.mode === 'flip' ? 'flip' : 'jump');
        }

        let box = bodyHitbox(dino, this._hitbox);
        // Activador atravesado (anillo): la física decide si hay pulsación que aplicar.
        const trigger = this.spawner.triggerAt(box, t, groundY);
        if (trigger !== null) {
            const gesture = applyTrigger(dino, trigger.def);
            if (gesture !== null) {
                this.spawner.markTriggerUsed(trigger);
                dino.onGesture(gesture);
                this._onTriggerFired();
                box = bodyHitbox(dino, this._hitbox);
            }
        }
        const hit = this.spawner.collisionAt(box, t, groundY) !== null
            // Muros del túnel del vuelo, con la anchura del hitbox (flightCourse.js).
            || (!this._course.empty && this._course.collisionAt(box, t, groundY, this._speed.speedAt(t)));
        // Herramienta de dev (ui/devTools.js, solo en `import.meta.env.DEV`): con
        // el interruptor activo el choque igual se detecta (el destello y el
        // resto de feedback de "en el golpe" siguen vivos) pero no corta la
        // partida — así se puede probar un nivel entero sin que la primera
        // colisión lo corte. Se lee en vivo, así el panel puede activarlo o
        // desactivarlo a mitad de partida sin tocar GameSession.
        if (hit && window.__daino?.godMode === true) return false;
        return hit;
    }

    /**
     * Propulsor (modo vuelo): chispas desde la tobera mientras se mantiene, una
     * llamarada al encenderlo y humo al soltar. La llama del sprite la lleva el Dino.
     */
    _tickJetpack(dt) {
        const dino = this.dino;
        const thrusting = dino.mode === 'fly' && dino.flyHeld > 0 && !dino.dead;
        const was = this._wasThrusting;
        this._wasThrusting = thrusting;
        if (this.engine.reducedMotion || dino.mode !== 'fly') return;
        const n = dino.jetNozzle(this._nozzle);
        const flame = (count) => {
            this._jetColor = (this._jetColor + 1) % FLY_JET.colors.length;
            this._bursts.burst({
                x: n.x,
                y: n.y,
                count,
                color: FLY_JET.colors[this._jetColor],
                speedMin: FLY_JET.speedMin,
                speedMax: FLY_JET.speedMax,
                gravity: 260,
                lifeS: FLY_JET.lifeS,
                upBias: -0.6,
            });
        };
        if (thrusting && !was) flame(FLY_JET.ignition);
        if (!thrusting && was) {
            this._bursts.burst({
                x: n.x,
                y: n.y,
                count: FLY_JET.cutoff,
                color: FLY_JET.smokeColor,
                speedMin: 20,
                speedMax: 70,
                gravity: -60,
                lifeS: 0.5,
                upBias: 0.3,
            });
        }
        if (!thrusting) return;
        this._jetT += dt;
        if (this._jetT >= FLY_JET.periodS) {
            this._jetT = 0;
            flame(1);
        }
    }

    /**
     * El orbe vuelve a impulsar al Dino (doble salto): chispas en su color
     * alrededor del cuerpo y un soplo de aire bajo los pies, como si pisara el aire.
     * La voltereta la hace el Dino (onGesture 'ring').
     */
    _onTriggerFired() {
        if (this.engine.reducedMotion || this.dino === null) return;
        const puff = DOUBLE_JUMP_FX.puff;
        this._bursts.burst({
            x: this.dino.x + DINO_SIZE.w * 0.5,
            y: this.dino.y + DINO_SIZE.h,
            count: puff.count,
            color: puff.color,
            speedMin: puff.speedMin,
            speedMax: puff.speedMax,
            gravity: 0,
            lifeS: puff.lifeS,
            upBias: -0.45,
        });
        this._bursts.burst({
            x: this.dino.x + DINO_SIZE.w * 0.5,
            y: this.dino.y + DINO_SIZE.h * 0.5,
            count: JUMP_RING_FX.sparks,
            color: JUMP_RING_FX.color,
            speedMin: 120,
            speedMax: 300,
            gravity: 0,
            lifeS: 0.32,
            upBias: 0,
        });
    }

    /** Impacto: congela el mundo, corta el audio en seco y arma el juice. */
    _startDeath() {
        this._dying = true;
        this._dieT = 0;
        this._inputs.clear();
        this._finalSongTime = Math.max(0, this.audioEngine.getSongTime());

        this.dino.setDead();
        this.engine.setBeatPulse(0);
        this.engine.setSpeedFx?.({ level: 0 });
        // Un drop a medias no se mezcla con la sacudida de la muerte.
        this._dropT = Infinity;
        if (this._dropOverlay) this._dropOverlay.alpha = 0;
        this.engine.setMusicState?.({ flash: 0 });

        // Silencio inmediato = el impacto se OYE (la canción muere contigo).
        try {
            if (this.audioEngine.source) this.audioEngine.source.stop();
        } catch { /* idempotente */ }

        // Estallido de partículas en el Dino.
        this._bursts.burst({
            x: this.dino.x + DINO_SIZE.w * 0.5,
            y: this.dino.y + DINO_SIZE.h * 0.5,
            count: 26,
            color: 0xff5d7e,
            speedMin: 120,
            speedMax: 420,
            gravity: 900,
            lifeS: 0.6,
            upBias: 0.5,
        });
        this._bursts.burst({
            x: this.dino.x + DINO_SIZE.w * 0.5,
            y: this.dino.y + DINO_SIZE.h * 0.5,
            count: 10,
            color: 0xf2f5ff,
            speedMin: 60,
            speedMax: 260,
            gravity: 700,
            lifeS: 0.5,
            upBias: 0.5,
        });

        // Flash blanco full-viewport en el hudLayer del canvas.
        this._flash = new Graphics()
            .rect(0, 0, window.innerWidth, window.innerHeight)
            .fill(0xffffff);
        this._flash.alpha = DEATH_FLASH.alpha;
        this._layers.hudLayer.addChild(this._flash);
    }

    _end(reason) {
        if (!this._isRunning) return;
        this._isRunning = false;

        // Detener el audio (idempotente si la muerte ya lo cortó).
        try {
            if (this.audioEngine.source) this.audioEngine.source.stop();
        } catch { /* idempotente */ }

        // La escena se queda bajo el panel de resultados (reintentos, Sep 2026):
        // tras un choque el mundo se detiene donde caíste; tras superar el nivel
        // el suelo sigue corriendo al ritmo del menú. El tick propio sigue vivo
        // solo para lo visual (ver `_tick`) hasta `stop()`.
        this._ended = reason !== 'stopped';
        this.engine.setWorldSpeed(reason === 'collision' ? 0 : SCENERY.menuSpeed);
        // Tras superar el nivel, el cielo sigue unos segundos bajo el panel hasta
        // el siguiente hito; tras chocar, se queda donde caíste.
        // Arranca de la hora que se está viendo: al salir ganando desde la pausa
        // (finishCleared) la canción aún no ha terminado.
        if (reason === 'win') this._skyEpilogue = { ...this._sky.epilogue(this._skyHourNow), t: 0 };
        this.engine.setBeatPulse(0);
        this.engine.setSpeedFx?.({ level: 0, clearAbove: 0 });
        this.hud.setControls?.(false);
        this.hud.setMode?.({ state: '', label: '', hint: '' });
        this.hud.setCaption?.('');
        this._captionAt = -1;
        if (reason !== 'win') this.hud.setBanner?.('');

        // Bloque 7: persistir progreso fire-and-forget si hay levelId
        // (sesión activa). 'stopped' NO persiste — salir o reintentar desde la
        // pausa no cuenta como un intento real. La UI no espera la respuesta;
        // si falla, log a consola — el panel de resultados ya muestra la marca.
        const reached = this._finalSongTime || Math.max(0, this.audioEngine.getSongTime());
        const percentage = this._durationSec > 0
            ? Math.min(100, Math.max(0, Math.round((reached / this._durationSec) * 100)))
            : 0;
        const levelId = this.levelId;
        if (levelId !== null && (reason === 'win' || reason === 'collision')) {
            apiRequest('POST', '/api/progress', {
                body: {
                    level_id: levelId,
                    percentage,
                    points: this._score,
                },
            }).then((res) => {
                if (!res.ok) {
                    console.warn('[GameSession] POST /api/progress falló:', res.status, res.data);
                    return;
                }
                // Ola 2: la marca y los jugadores del catálogo pueden haber
                // cambiado. Se avisa DESPUÉS de guardar para que quien revalide
                // no lea el estado anterior.
                window.dispatchEvent(new CustomEvent('daino:progress-saved', { detail: { levelId } }));
            }).catch((err) => {
                console.warn('[GameSession] POST /api/progress error:', err);
            });
        }

        // Bloque 6: dispatch desacoplado para que el AppController orqueste
        // la transición a MENU sin acoplarse al callback. `onGameOver` se
        // mantiene como fallback para callers que prefieran el camino directo.
        // `percentage` (Ola 2): la mejor marca local de los jugadores sin sesión.
        window.dispatchEvent(new CustomEvent('daino:gamestate', {
            detail: {
                kind: reason,
                score: this._score,
                percentage,
                durationSec: this._durationSec,
                reachedSec: Math.min(reached, this._durationSec),
                attempt: this.attempt,
            },
        }));

        this.onGameOver({ reason, score: this._score });
    }

    /**
     * Cuánto se apartan los efectos en un instante clave de la historia (T02.6):
     * 1 dentro de su ventana (cámara lenta o rótulo), con medio segundo de rampa a
     * cada lado.
     */
    _storyHushAt(t) {
        let hush = 0;
        for (let i = 0; i < this._storyHolds.length; i++) {
            const h = this._storyHolds[i];
            const k = Math.min((t - h.t0 + 0.5) / 0.5, (h.t1 + 0.5 - t) / 0.5);
            if (k > hush) hush = Math.min(1, k);
        }
        return hush;
    }

    /** Rótulos de la historia (T02.6): cada uno a su instante de canción, unos segundos. */
    _tickCaptions(t) {
        if (this._captions.length === 0) return;
        let active = -1;
        for (let i = 0; i < this._captions.length; i++) {
            const c = this._captions[i];
            if (t >= c.t && t < c.t + c.holdS) active = i;
        }
        if (active === this._captionAt) return;
        this._captionAt = active;
        this.hud.setCaption?.(active >= 0 ? this._captions[active].text : '');
    }

    /** Epílogo del cielo bajo el panel de resultados, con arranque y llegada suaves. */
    _tickSkyEpilogue(dt) {
        const ep = this._skyEpilogue;
        if (ep === null || ep.durationS <= 0 || ep.t >= ep.durationS) return;
        ep.t = Math.min(ep.durationS, ep.t + dt);
        const k = ep.t / ep.durationS;
        this.engine.setSkyHour?.(ep.from + (ep.to - ep.from) * k * k * (3 - 2 * k));
    }

    stop() {
        if (this._isRunning) this._end('stopped');
        this._ended = false;
        this._skyEpilogue = null;
        if (this._ticker && this._tickFn) {
            this._ticker.remove(this._tickFn);
            this._tickFn = null;
        }
        // Despide listeners.
        if (this._jumpHandler) Input.off('jump', this._jumpHandler);
        if (this._jumpEndHandler) Input.off('jumpEnd', this._jumpEndHandler);
        if (this._duckStartHandler) Input.off('duckStart', this._duckStartHandler);
        if (this._duckEndHandler) Input.off('duckEnd', this._duckEndHandler);
        if (this._pauseHandler) window.removeEventListener('audio:pause', this._pauseHandler);
        if (this._resumeHandler) window.removeEventListener('audio:resume', this._resumeHandler);

        // Restaurar offsets del shake por si el stop llegó a mitad de secuencia.
        if (this._layers) {
            this._layers.gameLayer.position.set(0, 0);
            this._layers.sceneryLayer.position.set(0, 0);
        }
        if (this._flash) {
            this._layers.hudLayer.removeChild(this._flash);
            this._flash.destroy();
            this._flash = null;
        }
        if (this._dropOverlay) {
            this._layers.hudLayer.removeChild(this._dropOverlay);
            this._dropOverlay.destroy();
            this._dropOverlay = undefined;
        }

        if (this.spawner) this.spawner.dispose();
        if (this._gates) this._gates.dispose();
        if (this._tunnel) this._tunnel.dispose();
        if (this._bursts) this._bursts.dispose();
        if (this.hud) this.hud.dispose();
        if (this.dino) {
            const layers = this.engine.getLayers();
            if (layers) layers.gameLayer.removeChild(this.dino);
            this.dino.destroy({ children: true });
        }

        this.dino = null;
        this.spawner = null;
        this.hud = null;
        this._bursts = null;
        this._gates = null;
        this._tunnel = null;
    }
}
