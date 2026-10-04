// AudioEngine — wrapper sobre Web Audio API.
//
// Diseño:
//   - Lazy: el AudioContext NO se crea en el constructor. Lo crea start() en
//     respuesta a un gesto del user (drop del MP3) — autoplay policy del
//     navegador exige gesto previo o el contexto arranca `suspended`.
//   - Una instancia maneja UN AudioBufferSourceNode a la vez. play(buffer)
//     reemplaza al anterior (lo detiene + descarta).
//   - El AnalyserNode es persistente: vive con el AudioContext y se reutiliza
//     entre canciones. Sus parámetros vienen del doc 07 §D.1, pineados.
//   - getFrequencyData(N) hace un downsample lineal del buffer FFT nativo
//     (1024 bins porque fftSize=2048) al N que el shader necesita (256).
//   - getRMS() opera sobre el buffer time-domain — más estable que tomar
//     amplitud del FFT y barato (suma de cuadrados sobre 2048 muestras).
//   - onstatechange dispatch `audio:pause` / `audio:resume` en window. El
//     engine.js los escucha para frenar el ticker (doc 07 §C.3).
//   - El gainNode arranca con el volumen persistido en localStorage por el
//     modal Settings (Bloque 6). Lectura via ../ui/settings.js para no
//     duplicar la key entre módulos.

import { getVolume } from '../../ui/settings.js';
import { createSteadyClock } from './steadyClock.js';

const FFT_SIZE = 2048;             // doc 07 §D.1 — pineado.
const SMOOTHING = 0.82;
const MIN_DB = -100;
const MAX_DB = -30;

/**
 * Sample rate forzado del AudioContext.
 *
 * Todo el análisis offline (`levels/SpectralFlux.js`) deriva su resolución
 * temporal de `audioBuffer.sampleRate / HOP_SIZE`. Dejarlo al criterio del
 * dispositivo hacía que el mismo MP3 con la misma seed produjera timelines
 * distintas en equipos distintos. Fijarlo aquí es lo que hace el análisis
 * reproducible — requisito para persistir charts (Ola 3) y para que un chart
 * generado fuera del navegador (Ola 4) case con el reloj del cliente.
 */
export const ANALYSIS_SAMPLE_RATE = 44100;

/**
 * Velocidad máxima a la que la corrección de latencia de salida puede cambiar,
 * como fracción del tiempo transcurrido: 0.05 = 50 ms de ajuste por segundo.
 *
 * `outputLatency` no es constante. Medido en Chrome: vale 0 al empezar a sonar
 * y salta a 40 ms unos 117 ms después, y puede volver a cambiar si cambia el
 * dispositivo de salida. Restarla tal cual haría retroceder el reloj de la
 * canción 40 ms de golpe — los obstáculos darían un tirón hacia atrás y la
 * física vería el tiempo retroceder. Limitando la velocidad de ajuste, el reloj
 * es siempre monótono (avanza al menos al 95 % del ritmo real mientras se
 * ajusta) y el cambio es imperceptible.
 */
const LATENCY_SLEW_RATE = 0.05;

export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.analyser = null;
        this.source = null;
        this.gainNode = null;
        this._freqBuffer = null;     // Uint8Array(FFT_SIZE/2) — 1024 bins
        this._timeBuffer = null;     // Uint8Array(FFT_SIZE) — 2048 muestras
        this._downsampled = null;    // Uint8Array(targetBins) reusado por getFrequencyData
        this._currentBuffer = null;  // último AudioBuffer reproducido (para test)
        this._playStartedAt = 0;     // ctx.currentTime cuando arrancó el play actual
        this._latency = 0;           // corrección de latencia de salida aplicada (s)
        this._latencyUpdatedAt = 0;  // ctx.currentTime de la última actualización
        this._onVisibilityChange = null;
        /**
         * `ctx.currentTime` avanza a escalones (cada bloque de audio); este reloj
         * da su instante continuo (ver steadyClock.js).
         */
        this._clock = createSteadyClock();
        /** Reloj de alta resolución, en segundos (los tests ponen el suyo). */
        this._wallS = () => performance.now() / 1000;
        /** Suelo del reloj de la canción: nunca retrocede dentro de una reproducción. */
        this._songFloor = -Infinity;
        /**
         * Motivos por los que el audio está detenido ('pause': el jugador;
         * 'hidden': la pestaña no se ve). Solo suena cuando no queda ninguno.
         * @type {Set<string>}
         */
        this._holds = new Set();
    }

    /** Crea el AudioContext. Idempotente. Devuelve el state ('running' o 'suspended'). */
    async start() {
        if (this.ctx !== null) return this.ctx.state;

        // Some browsers require explicit `latencyHint: 'interactive'` for low
        // latency in games. Default es 'interactive' actualmente, pero lo
        // dejamos explícito para que sobreviva a cambios futuros.
        //
        // `sampleRate` FIJO (Ola 0, defecto D10). Sin él, el contexto adopta el
        // del dispositivo de salida: 44.1 kHz en unas máquinas, 48 kHz en otras.
        // `decodeAudioData` remuestrea al rate del contexto, así que el envelope
        // de onsets salía a `sampleRate / 512` — 86.13 Hz o 93.75 Hz según el
        // equipo. Resultado: la misma canción con la misma seed generaba
        // timelines DISTINTAS en máquinas distintas, rompiendo en silencio el
        // invariante de determinismo del Bloque 5.
        //
        // Fijarlo a 44100 hace el análisis reproducible entre dispositivos, que
        // es requisito para persistir charts (Ola 3) y para que un chart
        // generado en servidor (Ola 4) cuadre con el reloj del cliente.
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        try {
            this.ctx = new AudioCtor({ latencyHint: 'interactive', sampleRate: ANALYSIS_SAMPLE_RATE });
        } catch {
            // Algún dispositivo (sobre todo iOS antiguo) puede rechazar un rate
            // que no soporta. Degradar es mejor que quedarse sin audio; se
            // pierde el determinismo entre equipos, no la jugabilidad.
            console.warn(`[AudioEngine] ${ANALYSIS_SAMPLE_RATE} Hz no soportado; usando el rate del dispositivo.`);
            this.ctx = new AudioCtor({ latencyHint: 'interactive' });
        }

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = SMOOTHING;
        this.analyser.minDecibels = MIN_DB;
        this.analyser.maxDecibels = MAX_DB;

        this.gainNode = this.ctx.createGain();
        // Volumen inicial desde localStorage (Bloque 6). Si nunca se tocó, 1.0.
        this.gainNode.gain.value = getVolume();

        // analyser -> gain -> destination. El BufferSource va al analyser.
        this.analyser.connect(this.gainNode);
        this.gainNode.connect(this.ctx.destination);

        this._freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
        this._timeBuffer = new Uint8Array(FFT_SIZE);

        // Pause/resume del engine cuando el SO suspende el contexto. Los
        // navegadores en escritorio NO suspenden auto al cambiar de pestaña
        // — solo en casos extremos (lock screen, ahorro batería, fullscreen
        // exit en algunas combinaciones). Este handler es la red defensiva
        // para esos casos.
        this.ctx.addEventListener('statechange', () => {
            if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
                window.dispatchEvent(new CustomEvent('audio:pause'));
            } else if (this.ctx.state === 'running') {
                window.dispatchEvent(new CustomEvent('audio:resume'));
            }
        });

        // Page Visibility API — pausamos manualmente al cambiar de pestaña.
        // Razón: Daino es un juego rítmico; si la pestaña pierde foco mientras
        // la canción sigue, los obstáculos del Bloque 5+ se desincronizarán
        // del beat. Detener el AudioContext congela el reloj de la canción y
        // todo se mantiene alineado al volver. statechange dispatcheará los
        // eventos audio:pause/resume gracias al handler de arriba.
        //
        // Es un motivo más para estar detenido ('hidden'), no una orden de
        // reanudar al volver: antes, volver a la pestaña reanudaba el audio
        // aunque el jugador tuviese la partida en pausa, y la canción seguía
        // sola detrás del panel.
        this._onVisibilityChange = () => {
            if (document.hidden) this.hold('hidden');
            else this.release('hidden');
        };
        document.addEventListener('visibilitychange', this._onVisibilityChange);

        // Si arrancó suspended (autoplay policy), intentar resume — el drop
        // que llamó a start() ya cuenta como gesture, así que debería pasar.
        if (this.ctx.state === 'suspended') {
            try { await this.ctx.resume(); } catch { /* el caller verá state */ }
        }

        return this.ctx.state;
    }

    /**
     * Detiene el audio por un motivo. Se acumulan: sigue detenido mientras quede
     * alguno (`release`).
     * @param {string} reason  'pause' (el jugador), 'hidden' (la pestaña no se ve).
     */
    hold(reason) {
        this._holds.add(reason);
        if (this.ctx !== null && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }

    /** Retira un motivo; si era el último, el audio sigue donde estaba. */
    release(reason) {
        this._holds.delete(reason);
        if (this._holds.size > 0 || this.ctx === null) return;
        if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    }

    /**
     * El audio está parado sin que nadie lo haya pedido: el navegador no le deja
     * sonar (su política de autoplay: falta un gesto de verdad en la página).
     */
    get blocked() {
        return this.ctx !== null && this.ctx.state === 'suspended' && this._holds.size === 0;
    }

    /** Vuelve a intentar que suene, si nadie lo tiene detenido. */
    retry() {
        if (this.blocked) this.ctx.resume().catch(() => {});
    }

    /** Decodifica un ArrayBuffer (de FileReader) a AudioBuffer. */
    async decode(arrayBuffer) {
        if (this.ctx === null) await this.start();
        // decodeAudioData consume el ArrayBuffer en algunos navegadores; pasar
        // el original es OK porque upload.js no lo reutiliza después.
        return await this.ctx.decodeAudioData(arrayBuffer);
    }

    /**
     * Reproduce un AudioBuffer desde el inicio. Si había uno sonando, lo
     * detiene primero. Devuelve un handle con stop().
     *
     * Bloque 6: recreamos el AnalyserNode en cada play() para descartar el
     * smoothing histórico. Sin esto, los primeros ~10-20 frames de la nueva
     * canción mezclan el FFT smoothed del frame final de la anterior — visible
     * como "barras residuo" del intento previo. AnalyserNode no expone reset()
     * en la spec, así que recrear es el camino limpio (coste despreciable).
     */
    play(audioBuffer) {
        if (this.ctx === null) {
            throw new Error('AudioEngine.play llamado antes de start()');
        }

        if (this.source !== null) {
            try { this.source.stop(); } catch { /* ya parado */ }
            this.source.disconnect();
            this.source = null;
        }

        // Reset del analyser. El gainNode persiste (mantiene el volumen
        // del usuario) y solo recableamos: analyser_new → gainNode → dest.
        if (this.analyser !== null) {
            this.analyser.disconnect();
        }
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = SMOOTHING;
        this.analyser.minDecibels = MIN_DB;
        this.analyser.maxDecibels = MAX_DB;
        this.analyser.connect(this.gainNode);

        const src = this.ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(this.analyser);
        src.start(0);

        this.source = src;
        this._currentBuffer = audioBuffer;
        // Stamp del reloj del ctx en el momento del start. getAudioTime()
        // resta esto a ctx.currentTime para devolver el "song time".
        this._playStartedAt = this.ctx.currentTime;
        // La corrección de latencia arranca con lo que el navegador informe
        // ahora; getSongTime la irá ajustando sin saltos si cambia.
        this._latency = this._measuredLatency();
        this._latencyUpdatedAt = this.ctx.currentTime;
        this._clock.restart();
        this._songFloor = -Infinity;

        return {
            stop: () => {
                try { src.stop(); } catch { /* idempotente */ }
                src.disconnect();
                if (this.source === src) this.source = null;
            },
        };
    }

    /**
     * Devuelve N bins frecuencia [0..255] downsampled del buffer FFT nativo.
     * Si N coincide con frequencyBinCount no hace copia extra; si es menor,
     * promedia segmentos contiguos.
     */
    getFrequencyData(targetBins = 256) {
        // Buffer de salida reutilizado entre frames (Ola 0). Antes se alocaba
        // un `new Uint8Array(targetBins)` en CADA frame de partida — 60 arrays
        // por segundo para tirar, presión de GC gratuita dentro del bucle de
        // render. El engine consume el resultado de forma síncrona (lo copia a
        // la textura del shader en la misma línea), así que reutilizarlo es
        // seguro: nadie guarda la referencia entre frames.
        if (this._downsampled === null || this._downsampled.length !== targetBins) {
            this._downsampled = new Uint8Array(targetBins);
        }
        const out = this._downsampled;

        if (this.analyser === null) {
            // Sin contexto todavía: devolver silencio del tamaño pedido.
            out.fill(0);
            return out;
        }
        this.analyser.getByteFrequencyData(this._freqBuffer);

        const native = this._freqBuffer.length;  // 1024 con fftSize=2048
        if (targetBins === native) return this._freqBuffer;

        const step = native / targetBins;
        for (let i = 0; i < targetBins; i++) {
            const start = (i * step) | 0;
            const end = Math.min(((i + 1) * step) | 0, native);
            let sum = 0;
            const n = end - start;
            for (let j = start; j < end; j++) sum += this._freqBuffer[j];
            out[i] = n > 0 ? (sum / n) | 0 : 0;
        }
        return out;
    }

    /** RMS [0,1] sobre el último frame de time-domain data. */
    getRMS() {
        if (this.analyser === null) return 0;
        this.analyser.getByteTimeDomainData(this._timeBuffer);
        let sumSq = 0;
        const len = this._timeBuffer.length;
        for (let i = 0; i < len; i++) {
            const v = (this._timeBuffer[i] - 128) / 128;  // re-centrar a [-1, 1]
            sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / len);
        // Compresión suave: el RMS bruto pocas veces pasa de 0.4 incluso en
        // música fuerte. Empujamos a [0,1] para que el shader tenga rango útil.
        return Math.min(1, rms * 2.4);
    }

    /** Estado actual del contexto, o 'closed' si nunca se inició. */
    get state() {
        return this.ctx?.state ?? 'closed';
    }

    /**
     * Último AudioBuffer reproducido (o null). Bloque 5 lo usa el
     * LevelGenerator si hace falta releer el buffer sin pasarlo a mano.
     */
    get currentBuffer() {
        return this._currentBuffer;
    }

    /**
     * Reloj relativo a cuándo arrancó el play() actual. Si no hay source o
     * el ctx aún no existe, devuelve 0. La GameSession lo consume cada tick
     * para alimentar al spawner — la única fuente de verdad temporal.
     */
    getAudioTime() {
        if (this.ctx === null || this.source === null) return 0;
        // ctx.currentTime avanza siempre que el contexto está running. El
        // source.start(0) del play() lo arrancó en este reloj, así que el
        // delta directo es el tiempo de canción reproducido.
        const t = this.ctx.currentTime - this._playStartedAt;
        return t < 0 ? 0 : t;
    }

    /**
     * Instante de canción que el jugador está OYENDO ahora mismo (Ola 3).
     *
     * `ctx.currentTime` marca lo que el motor de audio ha procesado, pero el
     * sonido llega a los altavoces `outputLatency` segundos después (buffers
     * del sistema operativo y del dispositivo: unos 10-40 ms en escritorio y
     * bastante más con Bluetooth). En un juego de ritmo esa diferencia es
     * exactamente la que separa "el obstáculo llega con el golpe" de "llega
     * antes de que suene". Restarla alinea lo que se ve con lo que se oye.
     *
     * Puede ser ligeramente negativo en los primeros milisegundos; quien lo
     * muestre al usuario debe acotarlo a 0. La GameSession lo usa como única
     * fuente de verdad temporal de la partida.
     *
     * Es continuo y monótono: `ctx.currentTime` avanza a escalones (un bloque
     * de audio cada vez) y aquí se lee su instante continuo (steadyClock.js).
     * Con el contexto detenido (pausa, pestaña oculta) el reloj no avanza.
     *
     * @returns {number}
     */
    getSongTime() {
        if (this.ctx === null || this.source === null) return 0;
        const step = this.ctx.currentTime;
        const elapsed = step - this._latencyUpdatedAt;
        if (elapsed > 0) {
            // Converger hacia la latencia medida, a velocidad limitada.
            const maxStep = elapsed * LATENCY_SLEW_RATE;
            const delta = this._measuredLatency() - this._latency;
            this._latency += Math.max(-maxStep, Math.min(maxStep, delta));
            this._latencyUpdatedAt = step;
        }
        // `state` solo falta en los contextos de prueba, que siempre "suenan".
        const running = this.ctx.state === undefined || this.ctx.state === 'running';
        let now;
        if (running) {
            now = this._clock.read(this._wallS(), step);
        } else {
            // Detenido: el reloj se queda donde iba y al volver se re-ancla.
            now = Math.max(step, this._clock.last);
            this._clock.reset();
        }
        const t = now - this._playStartedAt - this._latency;
        if (t > this._songFloor) this._songFloor = t;
        return this._songFloor;
    }

    /**
     * Latencia de salida que informa el navegador. `outputLatency` no existe en
     * todos (Safari); `baseLatency` es la mejor aproximación y 0 si tampoco.
     */
    _measuredLatency() {
        const v = this.ctx.outputLatency || this.ctx.baseLatency || 0;
        return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0;
    }
}
