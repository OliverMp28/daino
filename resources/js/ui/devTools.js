// Panel flotante de herramientas de desarrollo — SOLO en `import.meta.env.DEV`.
//
// `main.js` monta esto únicamente en `bun run dev`; `bun run build` (producción)
// nunca lo importa (ver el `if` en main.js), así que no pesa nada en el bundle
// real ni aparece para un jugador.
//
//   Sin colisiones — un choque se sigue detectando (el destello y el resto del
//   feedback "en el golpe" siguen vivos) pero no termina el run. El estado vive
//   en `window.__daino.godMode`, que `GameSession._physicsStep` lee en vivo.
//
//   Cielo (T01) — para revisar el escenario sin jugar un nivel
//   entero: la hora y la fase del cielo, las anclas del plan del nivel en curso,
//   fijar la hora (`window.__daino.sky.hour`, que el engine lee en vivo),
//   recorrer el ciclo entero en 24 s, apagar los efectos de la música para ver
//   el escenario solo, elegir escena y apagar cada elemento POR SU NOMBRE (así
//   "la neblina del horizonte" es la misma cosa para quien juega y para quien
//   programa).
//
//   Historia (T02.6) — con una escena de historia de autor: un botón por cada
//   momento de su relato (pone el cielo a su hora: el barco, el cabo y el
//   destello están donde toca) y "Recorrer la historia", que la cuenta entera en
//   unos segundos al ritmo de su propio plan (con su cámara lenta).
//
//   Efectos (T03.1, devFxPanel.js) — cada efecto de la música con su nombre:
//   apagarlo, verlo solo, subirle o bajarle la intensidad, y por qué no se ve
//   cuando no se ve.
//
//   Rendimiento (T05, devPerfPanel.js) — los fotogramas, los tardíos y el JS de
//   cada uno, la calidad en uso y el cielo: su detalle y su ritmo, para
//   compararlos jugando.
//
// El panel no se engancha a la sesión ni a AppController: lee `window.__daino`
// (engine y sesión) cuando lo necesita, así que funciona a mitad de partida y
// sobrevive a un reintento o a cambiar de nivel.
//
// Flotante en la esquina, colapsado por defecto (un botón redondo); z-index por
// debajo de un `<dialog>` (top layer) pero por encima del HUD.

import { SCENES, DEFAULT_SCENE, resolveScene, sceneCycle, sceneElements } from '../game/scenes/registry.js';
import { SKY_PHASES } from '../game/scenes/skyModel.js';
import { planSky } from '../game/scenes/skyClock.js';
import { mountFxPanel } from './devFxPanel.js';
import { mountPerfPanel } from './devPerfPanel.js';

const PANEL_ID = 'daino-devtools';

/** Recorrido de "Recorrer el ciclo": de la tarde del nivel al sol ya alto. */
const TOUR = Object.freeze({ from: 14.5, to: 31, seconds: 24 });

/** "Recorrer la historia": su plan con una canción sin estructura de esta duración. */
const STORY_TOUR_S = 48;

/** 'HH:MM' de una hora continua (las 29 son las 05:00). */
function clock(hour) {
    const h = ((hour % 24) + 24) % 24;
    const mins = Math.round(h * 60) % (24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** 'M:SS' de un instante de canción. */
function songClock(t) {
    return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function checkRow(label, checked, onChange) {
    const row = el('label', 'daino-devtools__row');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = checked;
    check.addEventListener('change', () => onChange(check.checked));
    row.append(check, document.createTextNode(` ${label}`));
    return { row, check };
}

/** Monta el panel una sola vez (llamadas repetidas son no-op). */
export function mountDevTools() {
    if (typeof document === 'undefined' || document.getElementById(PANEL_ID) !== null) return;

    window.__daino = window.__daino ?? {};
    window.__daino.godMode = window.__daino.godMode ?? false;
    window.__daino.sky = window.__daino.sky ?? { hour: null };

    const root = el('div', 'daino-devtools');
    root.id = PANEL_ID;

    const handle = el('button', 'daino-devtools__handle', '🛠');
    handle.type = 'button';
    handle.title = 'Herramientas de desarrollo';
    handle.setAttribute('aria-label', 'Herramientas de desarrollo');
    handle.setAttribute('aria-expanded', 'false');

    const panel = el('div', 'daino-devtools__panel');
    panel.hidden = true;

    // ---------- Juego ----------
    panel.appendChild(el('p', 'daino-devtools__heading', 'DEV'));
    const god = checkRow('Sin colisiones', window.__daino.godMode === true, (on) => {
        window.__daino.godMode = on;
        root.dataset.godmode = on ? 'on' : 'off';
    });
    panel.appendChild(god.row);

    // ---------- Cielo ----------
    panel.appendChild(el('p', 'daino-devtools__heading', 'CIELO'));
    const readout = el('p', 'daino-devtools__readout', '—');
    const planLine = el('p', 'daino-devtools__plan', '');
    panel.append(readout, planLine);

    const fixRow = el('div', 'daino-devtools__row daino-devtools__row--slider');
    const fix = document.createElement('input');
    fix.type = 'checkbox';
    fix.title = 'Fijar la hora del cielo';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '24';
    slider.step = '0.05';
    slider.value = '18.2';
    slider.setAttribute('aria-label', 'Hora del cielo');
    const sliderValue = el('span', 'daino-devtools__value', clock(18.2));
    const fixLabel = el('label', '', 'Fijar hora');
    fixLabel.prepend(fix);
    fixRow.append(fixLabel, slider, sliderValue);
    panel.appendChild(fixRow);

    const applyFixed = () => {
        window.__daino.sky.hour = fix.checked ? Number(slider.value) : null;
        sliderValue.textContent = clock(Number(slider.value));
    };
    fix.addEventListener('change', () => {
        stopTour();
        if (fix.checked) {
            // Arranca en la hora que se está viendo.
            const now = window.__daino.engine?.getSky?.().hour;
            if (Number.isFinite(now)) slider.value = String(((now % 24) + 24) % 24);
        }
        applyFixed();
    });
    slider.addEventListener('input', () => {
        stopTour();
        if (!fix.checked) fix.checked = true;
        applyFixed();
    });

    // Recorrer el ciclo: de la tarde al sol alto del día siguiente en 24 s.
    const tourBtn = el('button', 'daino-devtools__button', '▶ Recorrer el ciclo');
    tourBtn.type = 'button';
    let tourRaf = 0;
    function endTour() {
        tourRaf = 0;
        tourBtn.textContent = '▶ Recorrer el ciclo';
        if (!fix.checked) window.__daino.sky.hour = null;
    }
    function stopTour() {
        if (tourRaf === 0) return;
        cancelAnimationFrame(tourRaf);
        endTour();
    }
    tourBtn.addEventListener('click', () => {
        if (tourRaf !== 0) {
            stopTour();
            return;
        }
        const t0 = performance.now();
        tourBtn.textContent = '■ Parar';
        const step = (now) => {
            const k = Math.min(1, (now - t0) / (TOUR.seconds * 1000));
            window.__daino.sky.hour = TOUR.from + (TOUR.to - TOUR.from) * k;
            if (k >= 1) {
                endTour();
                return;
            }
            tourRaf = requestAnimationFrame(step);
        };
        tourRaf = requestAnimationFrame(step);
    });
    panel.appendChild(tourBtn);


    // Escena (T02: cada nivel trae la suya; aquí se ve cualquiera sin jugar). Si
    // sus capas no están en el bundle, el engine las carga y la pone al llegar.
    const sceneRow = el('label', 'daino-devtools__row', 'Escena ');
    const sceneSelect = document.createElement('select');
    for (const s of Object.values(SCENES)) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.kind === 'story' ? `${s.label} (historia)` : s.label;
        sceneSelect.appendChild(opt);
    }
    sceneSelect.value = DEFAULT_SCENE;
    sceneRow.appendChild(sceneSelect);
    panel.appendChild(sceneRow);

    // Elementos con nombre: se apagan uno a uno.
    const elementsBox = el('div', 'daino-devtools__elements');
    const hidden = new Set();
    function renderElements(sceneId) {
        elementsBox.replaceChildren();
        for (const e of sceneElements(resolveScene(sceneId))) {
            const { row } = checkRow(e.label, !hidden.has(e.id), (on) => {
                if (on) hidden.delete(e.id);
                else hidden.add(e.id);
                window.__daino.engine?.setSkyElementVisible?.(e.id, on);
            });
            row.title = `id: ${e.id}`;
            elementsBox.appendChild(row);
        }
    }
    sceneSelect.addEventListener('change', () => {
        window.__daino.engine?.setScene?.(sceneSelect.value);
        // Lo apagado sigue apagado en la escena nueva.
        for (const id of hidden) window.__daino.engine?.setSkyElementVisible?.(id, false);
        renderElements(sceneSelect.value);
    });
    renderElements(DEFAULT_SCENE);
    panel.appendChild(elementsBox);

    // ---------- Historia (T02.6) ----------
    const storyBox = el('div', 'daino-devtools__story');
    let storyTourRaf = 0;
    function stopStoryTour() {
        if (storyTourRaf === 0) return;
        cancelAnimationFrame(storyTourRaf);
        storyTourRaf = 0;
        if (!fix.checked) window.__daino.sky.hour = null;
        renderStory(sceneSelect.value);
    }
    function jumpTo(hour) {
        stopTour();
        stopStoryTour();
        fix.checked = true;
        slider.value = String(((hour % 24) + 24) % 24);
        // Hora continua: la historia distingue las 5:51 de su regreso de las de otro día.
        window.__daino.sky.hour = hour;
        sliderValue.textContent = clock(hour);
    }
    function renderStory(sceneId) {
        storyBox.replaceChildren();
        const scene = resolveScene(sceneId);
        if (scene.kind !== 'story' || !scene.story) return;
        storyBox.appendChild(el('p', 'daino-devtools__heading', `HISTORIA · ${scene.label}`));
        const placed = window.__daino.session?._sky?.story?.id === scene.story.id ? window.__daino.session._sky.story.moments : null;
        for (const m of scene.story.moments) {
            const at = placed?.find((x) => x.id === m.id);
            const b = el('button', 'daino-devtools__button', `${m.label} · ${clock(m.hour)}${at ? ` (${songClock(at.t)})` : ''}`);
            b.type = 'button';
            b.addEventListener('click', () => jumpTo(m.hour));
            storyBox.appendChild(b);
        }
        const play = el('button', 'daino-devtools__button', storyTourRaf ? '■ Parar' : '▶ Recorrer la historia');
        play.type = 'button';
        play.addEventListener('click', () => {
            if (storyTourRaf !== 0) {
                stopStoryTour();
                return;
            }
            stopTour();
            const plan = planSky({ durationSec: STORY_TOUR_S, sections: [], fx: [] }, sceneCycle(scene));
            const ep = plan.epilogue(plan.hourAt(STORY_TOUR_S));
            const t0 = performance.now();
            play.textContent = '■ Parar';
            const step = (now) => {
                const t = (now - t0) / 1000;
                window.__daino.sky.hour = t <= STORY_TOUR_S
                    ? plan.hourAt(t)
                    : ep.from + (ep.to - ep.from) * Math.min(1, (t - STORY_TOUR_S) / Math.max(1, ep.durationS));
                if (t >= STORY_TOUR_S + ep.durationS) {
                    storyTourRaf = 0;
                    if (!fix.checked) window.__daino.sky.hour = null;
                    renderStory(sceneSelect.value);
                    return;
                }
                storyTourRaf = requestAnimationFrame(step);
            };
            storyTourRaf = requestAnimationFrame(step);
        });
        storyBox.appendChild(play);
    }
    sceneSelect.addEventListener('change', () => renderStory(sceneSelect.value));
    panel.appendChild(storyBox);

    // ---------- Rendimiento (T05) ----------
    const perfPanel = mountPerfPanel(panel, { el });

    // ---------- Efectos (T03.1) ----------
    const fxPanel = mountFxPanel(panel, { el, checkRow });

    // Lectura: hora y fase del cielo, y el plan del nivel en curso.
    let readTimer = 0;
    function refresh() {
        const sky = window.__daino.engine?.getSky?.();
        if (sky && Number.isFinite(sky.hour)) {
            readout.textContent = `${clock(sky.hour)} · ${SKY_PHASES[sky.phase] ?? sky.phase}`;
            if (!fix.checked && tourRaf === 0) {
                slider.value = String(((sky.hour % 24) + 24) % 24);
                sliderValue.textContent = clock(sky.hour);
            }
        }
        // La escena vigente (la del nivel en partida, la de siempre en el menú),
        // salvo mientras se está eligiendo otra.
        if (sky?.sceneId && sky.sceneId !== sceneSelect.value && document.activeElement !== sceneSelect) {
            sceneSelect.value = sky.sceneId;
            renderElements(sky.sceneId);
            renderStory(sky.sceneId);
        }
        const story = window.__daino.session?._sky?.story;
        const ev = window.__daino.session?._sky?.events;
        if (story) {
            planLine.textContent = story.moments.filter((m) => m.t > 0 && m.id !== 'end').map((m) => `${m.label} ${songClock(m.t)}`).join(' · ');
        } else if (ev) {
            const parts = [['Atardecer', ev.eveningStart], ['Noche', ev.nightfall], ['Alba', ev.dawnStart]]
                .filter(([, t]) => t !== null && t !== undefined)
                .map(([name, t]) => `${name} ${songClock(t)}`);
            planLine.textContent = parts.length > 0 ? parts.join(' · ') : 'Sin atardecer';
        } else {
            planLine.textContent = 'Sin nivel en curso';
        }
        perfPanel.refresh();
        fxPanel.refresh();
    }

    handle.addEventListener('click', () => {
        const opening = panel.hidden;
        panel.hidden = !opening;
        handle.setAttribute('aria-expanded', String(opening));
        clearInterval(readTimer);
        if (opening) {
            refresh();
            readTimer = setInterval(refresh, 250);
        }
    });

    root.dataset.godmode = god.check.checked ? 'on' : 'off';
    root.append(handle, panel);
    document.body.appendChild(root);
}
