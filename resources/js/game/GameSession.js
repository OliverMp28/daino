// GameSession — orquestador de un run del juego. Recibe el engine (Pixi),
// el AudioEngine y el Level pre-computado, y conecta todas las piezas:
// monta Dino + spawner + HUD + emisor de bursts, suscribe Input (salto,
// salto variable, agacharse), registra el tick en el ticker global de Pixi,
// escucha pause/resume del audio y alimenta el pulso de beat del shader.
//
// Una sola sesión activa a la vez. `start()` arranca; `stop({reason})`
// limpia. Reiniciar = stop() + new GameSession(...).
//
// Secuencia de muerte (rediseño Jul 2026): impacto → hit-stop (mundo
// congelado HITSTOP_S, audio cortado en seco, estallido de partículas,
// flash blanco) → screen shake con decay → _end('collision'). Total ~0.45s
// de "golpe" antes del game over — el juice que el placeholder no tenía.

import { Dino } from './entities/Dino.js';
import { createSpawner } from './systems/spawner.js';
import { createBurstEmitter } from './entities/ParticleLayer.js';
import { createHud } from '../ui/hud.js';
import { Input } from './systems/input.js';
import { computeGroundY, integrateDino, findCollision } from './systems/physics.js';
import {
    DT_CAP_S, DINO_SIZE, JUMP_BUFFER_S,
    SHAKE, HITSTOP_S, DEATH_FLASH, SCENERY,
} from './config.js';
import { request as apiRequest } from '../api/client.js';
import { Graphics } from 'pixi.js';

export class GameSession {
    /**
     * @param {object} cfg
     * @param {ReturnType<import('./engine.js').startEngine> extends Promise<infer T> ? T : never} cfg.engine
     * @param {import('./audio/AudioEngine.js').AudioEngine} cfg.audioEngine
     * @param {import('./levels/LevelGenerator.js').Level} cfg.level
     * @param {number | null} [cfg.levelId]   Id del row `levels` en el servidor.
     *        Si != null y la run termina con 'win'|'collision', dispara
     *        POST /api/progress fire-and-forget. Anónimo: null → no llama.
     * @param {() => void} [cfg.onGameOver]   Callback cuando el run termina (lose/win).
     */
    constructor(cfg) {
        this.engine = cfg.engine;
        this.audioEngine = cfg.audioEngine;
        this.level = cfg.level;
        this.levelId = cfg.levelId ?? null;
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
        this._finalAudioTime = 0;
        this._beatLenS = 60 / Math.max(1, this.level.bpm ?? 120);
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

        // Dino.
        this.dino = new Dino();
        this.dino.y = groundY - DINO_SIZE.h;
        layers.gameLayer.addChild(this.dino);

        // Spawner.
        this.spawner = createSpawner({
            timeline: this.level.timeline,
            gameLayer: layers.gameLayer,
            viewportWidth: window.innerWidth,
            groundY,
        });

        // Bursts (polvo de aterrizaje, estallido de muerte) sobre el gameLayer.
        this._bursts = createBurstEmitter(layers.gameLayer);

        // HUD DOM (#hud-root). El hudLayer del canvas queda para el flash.
        this.hud = createHud();
        this.hud.update(0, 0, this.level.durationSec);
        if (this.level.sourceName) this.hud.setSong(this.level.sourceName);

        // El mundo scrollea a la velocidad de la canción.
        this.engine.setWorldSpeed(this.level.gameSpeed);

        // Input.
        Input.setup();
        this._jumpHandler = () => {
            if (!this._isRunning || this._isPaused || this._dying) return;
            const jumped = this.dino.jump();
            // Pulsado un pelín antes de aterrizar: se guarda y dispara al tocar
            // suelo (jump buffer) — perdona el timing humano a BPM alto.
            if (!jumped && !this.dino.grounded) {
                this.dino.jumpBufferT = JUMP_BUFFER_S;
            }
        };
        this._jumpEndHandler = () => {
            if (this.dino) this.dino.jumpEnd();
        };
        this._duckStartHandler = () => {
            if (!this._isRunning || this._isPaused || this._dying) return;
            this.dino.duckStart();
        };
        this._duckEndHandler = () => {
            if (this.dino) this.dino.duckEnd();
        };
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
            this.dino.tickVisual(dt, this.level.gameSpeed);

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
        const audioTime = this.audioEngine.getAudioTime();

        // Físicas del Dino primero (gravedad variable + clamp al suelo).
        const groundY = computeGroundY(window.innerHeight);
        integrateDino(this.dino, dt, groundY);

        // Aterrizaje: squash + polvo + jump buffer.
        if (!this._prevGrounded && this.dino.grounded) {
            this.dino.onLand();
            this._bursts.burst({
                x: this.dino.x + DINO_SIZE.w * 0.5,
                y: groundY,
                count: 6,
                color: 0x8b9aff,
                speedMin: 30,
                speedMax: 120,
                gravity: 500,
                lifeS: 0.35,
                upBias: 0.4,
            });
            if (this.dino.jumpBufferT > 0) {
                this.dino.jumpBufferT = 0;
                this.dino.jump();
            }
        }
        this._prevGrounded = this.dino.grounded;

        // Spawner: instancia nuevos obstáculos y mueve los activos.
        this.spawner.tick(audioTime, dt, this.level.gameSpeed);

        // Visual del Dino (frames de carrera, squash) y bursts vivos.
        this.dino.tickVisual(dt, this.level.gameSpeed);
        this._bursts.tick(dt);

        // Pulso de beat para el shader: exp-decay re-disparado en cada beat.
        // Es la ÚNICA fuente de uBpmPulse (antes el uniform estaba muerto).
        if (audioTime >= 0) {
            const phase = (audioTime % this._beatLenS) / this._beatLenS;
            this.engine.setBeatPulse(Math.exp(-phase * 4.5));
        }

        // Colisión Dino vs obstáculos activos.
        const hit = findCollision(this.dino, this.spawner.getActive());
        if (hit !== null) {
            this._startDeath();
            return;
        }

        // Score: por ahora, score = floor(audioTime * 100).
        this._score = Math.floor(audioTime * 100);
        this.hud.update(this._score, audioTime, this.level.durationSec);

        // Win condition: la canción terminó.
        if (audioTime >= this.level.durationSec) {
            this._finalAudioTime = this.level.durationSec;
            this._end('win');
        }
    }

    /** Impacto: congela el mundo, corta el audio en seco y arma el juice. */
    _startDeath() {
        this._dying = true;
        this._dieT = 0;
        this._finalAudioTime = this.audioEngine.getAudioTime();

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
        if (this.levelId !== null && (reason === 'win' || reason === 'collision')) {
            const audioTime = this._finalAudioTime || this.audioEngine.getAudioTime();
            const percentage = this.level.durationSec > 0
                ? Math.min(100, Math.max(0, Math.round((audioTime / this.level.durationSec) * 100)))
                : 0;
            apiRequest('POST', '/api/progress', {
                body: {
                    level_id: this.levelId,
                    percentage,
                    points: this._score,
                },
            }).then((res) => {
                if (!res.ok) {
                    console.warn('[GameSession] POST /api/progress falló:', res.status, res.data);
                }
            }).catch((err) => {
                console.warn('[GameSession] POST /api/progress error:', err);
            });
        }

        // Bloque 6: dispatch desacoplado para que el AppController orqueste
        // la transición a MENU sin acoplarse al callback. `onGameOver` se
        // mantiene como fallback para callers que prefieran el camino directo.
        window.dispatchEvent(new CustomEvent('daino:gamestate', {
            detail: { kind: reason, score: this._score, durationSec: this.level.durationSec },
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
