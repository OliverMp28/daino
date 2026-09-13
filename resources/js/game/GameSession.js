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

import { Dino } from './entities/Dino.js';
import { Obstacle } from './entities/Obstacle.js';
import { createSpawner } from './systems/spawner.js';
import { createBeatClock } from './systems/beatClock.js';
import { obstacleEvents } from './levels/chartFormat.js';
import { createBurstEmitter } from './entities/ParticleLayer.js';
import { createHud } from '../ui/hud.js';
import { Input } from './systems/input.js';
import { computeGroundY, integrateDino, dinoHitbox } from './systems/physics.js';
import { createFixedStepper } from './systems/fixedStep.js';
import { createInputTimeline, songTimeOfEvent } from './systems/inputTimeline.js';
import {
    DT_CAP_S, DINO_SIZE, JUMP_BUFFER_S,
    SHAKE, HITSTOP_S, DEATH_FLASH, SCENERY, RUN_DUST,
    PHYSICS_STEP_S, MAX_PHYSICS_CATCHUP_S,
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
        this._score = 0;
        this._prevGrounded = true;
        this._dying = false;
        this._dieT = 0;
        this._dustT = 0;
        this._finalSongTime = 0;
        this._speedPxS = this.chart.world.speedPxS;
        // La partida dura lo que dura el audio REAL decodificado: es lo que
        // suena. El chart trae su propia duración, pero un decodificador
        // distinto puede diferir en unos ms de relleno del MP3.
        this._durationSec = this.audioBuffer.duration;
        this._beatClock = createBeatClock(
            obstacleEvents(this.chart).map((e) => e.t),
            this.chart.music.beatPeriodS,
        );
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

        const groundY = computeGroundY(window.innerHeight);

        // Dino (con el skin elegido por el user en AJUSTES).
        this.dino = new Dino({ skinId: this.skinId });
        this.dino.y = groundY - DINO_SIZE.h;
        layers.gameLayer.addChild(this.dino);

        // Spawner: coloca los obstáculos del chart a partir del tiempo de canción.
        this.spawner = createSpawner({
            events: this.chart.events,
            speedPxS: this._speedPxS,
            layer: layers.gameLayer,
            createObstacle: (kind) => new Obstacle(kind),
        });

        // Bursts (polvo de aterrizaje, estallido de muerte) sobre el gameLayer.
        this._bursts = createBurstEmitter(layers.gameLayer);

        // HUD DOM (#hud-root). El hudLayer del canvas queda para el flash.
        this.hud = createHud();
        this.hud.update(0, 0, this._durationSec);
        if (this.title) this.hud.setSong(this.title);

        // El mundo scrollea a la velocidad de la canción.
        this.engine.setWorldSpeed(this._speedPxS);

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
        this._pauseHandler = () => { this._isPaused = true; };
        this._resumeHandler = () => { this._isPaused = false; };
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

    _tick(tickerArg) {
        if (!this._isRunning || this._isPaused) return;

        // Cap del dt — al volver de bg el deltaMS puede ser enorme y meter
        // al Dino bajo el suelo de un salto. DT_CAP_S protege la integración.
        const dt = Math.min(DT_CAP_S, tickerArg.deltaMS / 1000);

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
        const groundY = computeGroundY(window.innerHeight);

        // Física a PASO FIJO hasta el instante de canción actual. Cada paso
        // integra el Dino y comprueba la colisión con los obstáculos en ese
        // mismo instante. Un frame de 160 ms ejecuta ~19 pasos; uno de 8 ms,
        // ninguno o uno. Así el salto nunca se queda atrás de la música.
        //
        // Va ANTES de `spawner.tick`: el spawner recicla al final del frame los
        // obstáculos que ya salieron por la izquierda, y un paso anterior de
        // este mismo frame todavía podría necesitarlos para la colisión.
        const collided = this._physics.advance(songTime, (t) => this._physicsStep(t, groundY));

        // Spawner: coloca cada sprite donde el tiempo de canción dice.
        this.spawner.tick(songTime, dt, { width: window.innerWidth, groundY });

        if (collided) {
            this._startDeath();
            return;
        }

        // Visual del Dino (frames de carrera, squash) y bursts vivos.
        this.dino.tickVisual(dt, this._speedPxS);
        this._bursts.tick(dt);

        // Polvo al correr: motita en los pies a intervalo fijo mientras
        // pisa suelo — vende la velocidad sin coste (1 sprite por emisión).
        if (this.dino.grounded) {
            this._dustT += dt;
            if (this._dustT >= RUN_DUST.periodS) {
                this._dustT = 0;
                this._bursts.burst({
                    x: this.dino.x + 16,
                    y: groundY - 2,
                    count: 1,
                    color: RUN_DUST.color,
                    speedMin: 15,
                    speedMax: 55,
                    gravity: 220,
                    lifeS: 0.3,
                    upBias: 0.35,
                });
            }
        }

        // Pulso de beat para el shader: exp-decay re-disparado en cada beat,
        // con la fase anclada a los golpes reales del chart (ver beatClock.js).
        if (songTime >= 0) {
            this.engine.setBeatPulse(Math.exp(-this._beatClock.phaseAt(songTime) * 4.5));
        }

        // Score: por ahora, score = floor(tiempo de canción * 100).
        this._score = Math.floor(shownTime * 100);
        this.hud.update(this._score, Math.min(shownTime, this._durationSec), this._durationSec);

        // Victoria: la canción terminó Y no queda ningún obstáculo por cruzar.
        // Antes bastaba con que acabara el audio, y como los obstáculos
        // llegaban tarde se ganaba con varios todavía en pantalla.
        if (songTime >= this._durationSec && !this.spawner.hasPendingCrossing(songTime)) {
            this._finalSongTime = this._durationSec;
            this._end('win');
        }
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
    }

    /** Aplica una acción del jugador sobre el Dino (dentro de un paso de física). */
    _applyInput(action) {
        const dino = this.dino;
        switch (action) {
            case 'jump':
                // Pulsado un pelín antes de aterrizar: se guarda y dispara al
                // tocar suelo (jump buffer) — perdona el timing humano.
                if (!dino.jump() && !dino.grounded) dino.jumpBufferT = JUMP_BUFFER_S;
                break;
            case 'jumpEnd': dino.jumpEnd(); break;
            case 'duckStart': dino.duckStart(); break;
            case 'duckEnd': dino.duckEnd(); break;
            default: break;
        }
    }

    /**
     * Un paso fijo de física en el instante de canción `t`.
     * @returns {boolean} true si el Dino chocó en este paso.
     */
    _physicsStep(t, groundY) {
        const dino = this.dino;
        // Primero las pulsaciones que ocurrieron hasta este instante.
        this._inputs.drainUntil(t, (action) => this._applyInput(action));
        integrateDino(dino, PHYSICS_STEP_S, groundY);

        // Aterrizaje: squash + polvo + jump buffer.
        if (!this._prevGrounded && dino.grounded) {
            dino.onLand();
            this._bursts.burst({
                x: dino.x + DINO_SIZE.w * 0.5,
                y: groundY,
                count: 6,
                color: 0x8b9aff,
                speedMin: 30,
                speedMax: 120,
                gravity: 500,
                lifeS: 0.35,
                upBias: 0.4,
            });
            if (dino.jumpBufferT > 0) {
                dino.jumpBufferT = 0;
                dino.jump();
            }
        }
        this._prevGrounded = dino.grounded;

        return this.spawner.collisionAt(dinoHitbox(dino, this._hitbox), t, groundY) !== null;
    }

    /** Impacto: congela el mundo, corta el audio en seco y arma el juice. */
    _startDeath() {
        this._dying = true;
        this._dieT = 0;
        this._inputs.clear();
        this._finalSongTime = Math.max(0, this.audioEngine.getSongTime());

        this.dino.setDead();
        this.engine.setBeatPulse(0);

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

        // Detener el ticker propio (el de Pixi sigue para el shader).
        if (this._ticker && this._tickFn) {
            this._ticker.remove(this._tickFn);
        }

        // Detener el audio (idempotente si la muerte ya lo cortó).
        try {
            if (this.audioEngine.source) this.audioEngine.source.stop();
        } catch { /* idempotente */ }

        // El scenery vuelve al scroll ambiente del menú.
        this.engine.setWorldSpeed(SCENERY.menuSpeed);
        this.engine.setBeatPulse(0);

        const message = reason === 'win'
            ? `WIN  SCORE ${this._score}`
            : `GAME OVER  SCORE ${this._score}`;
        this.hud.setMessage(message);

        // Bloque 7: persistir progreso fire-and-forget si hay levelId
        // (sesión activa). 'stopped' NO persiste — pulsar "Salir al menú" no
        // debería contar como un intento real. La UI no espera la respuesta;
        // si falla, log a consola — el toast del menú ya muestra el score.
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
            detail: { kind: reason, score: this._score, percentage, durationSec: this._durationSec },
        }));

        this.onGameOver({ reason, score: this._score });
    }

    stop() {
        if (this._isRunning) this._end('stopped');
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

        if (this.spawner) this.spawner.dispose();
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
    }
}
