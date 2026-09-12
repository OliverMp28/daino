# UX e Interfaz — El nuevo Daino se comporta como un videojuego, no como una web

> Este documento captura la dirección de diseño UX del nuevo Daino. Es **autoritativo** para decisiones de layout y flujos de navegación, y se añade sobre los docs 02 y 05.

---

## 1. Problema que resolvemos

El Daino viejo seguía la plantilla clásica de una web: **navbar, footer, menú hamburguesa, contenedor centrado del juego con su propio fondo**, y p5.js pintando el fondo de la página completa.

Ventaja del modelo viejo:
- El fondo audio-reactivo en **toda la ventana** generaba inmersión real, no solo un efecto dentro de un cuadradito.

Desventajas del modelo viejo:
- No hay modo pantalla completa de verdad. Entrar en fullscreen oculta los efectos de fondo (porque el fullscreen es solo del contenedor del juego, no de la página).
- Si encoges el contenedor para ver más fondo → el juego se queda pequeño e incómodo.
- La estética "página web" (navbar + footer) compite visualmente con el contenido del juego.

Conclusión: no queremos arreglar esto con parches. Rediseñamos el layout al completo como **un videojuego web**, no como una página con un juego dentro.

---

## 2. Principio rector

> Daino no es una web con un juego. **Daino es un juego que usa el navegador como su ventana.**

De ahí salen tres reglas operativas:

1. **El viewport entero es la experiencia.** Nada fijo en la parte superior (navbar) ni inferior (footer) ocupando espacio permanente. El 100% del viewport es el escenario.
2. **La UI aparece cuando la necesitas, desaparece cuando no.** HUD mínimo en esquinas. Menús a petición (pausa, clic en avatar). No hay "páginas" navegables fijas tipo blog.
3. **Los efectos visuales audio-reactivos son la capa más profunda del escenario, ocupando el 100% del viewport**, debajo del gameplay y debajo del HUD. Siempre visibles, siempre activos.

---

## 3. Arquitectura de capas visuales (z-index)

Dentro del único `<canvas>` de PixiJS:

```
┌──────────────────────────────────────────────────────┐
│  Capa 4 — HUD overlay (DOM absoluto)                 │  z: 40
│    Score, progreso, avatar, botón pausa              │
│    No consume framebuffer, se compone con CSS        │
├──────────────────────────────────────────────────────┤
│  Capa 3 — Gameplay                                   │  PIXI layer
│    Dino, obstáculos, nubes, partículas de juego      │
├──────────────────────────────────────────────────────┤
│  Capa 2 — Partículas ambientales                     │  PIXI layer
│    Motas, destellos moduladas por volumen del audio  │
├──────────────────────────────────────────────────────┤
│  Capa 1 — Fondo audio-reactivo                       │  PIXI layer + Filter
│    Shader GLSL que reacciona a FFT, RMS y BPM         │
│    Cubre 100% del viewport                           │
└──────────────────────────────────────────────────────┘
```

**Consecuencia práctica:** ya no hay distinción entre "fondo del contenedor del juego" y "fondo de la página". Son lo mismo. El problema del viejo (o fullscreen o efectos, elige uno) desaparece porque la experiencia siempre ocupa toda la ventana.

Un `<canvas>` PixiJS único a pantalla completa con múltiples `Container` apilados es más eficiente que dos canvas separados (uno para juego, otro para fondo), y permite compartir el `AnalyserNode` del audio sin sincronización entre contextos.

---

## 4. Modos de presentación

El juego tiene dos estados visibles, cambiados con una sola animación:

### 4.1 Modo Menú (cuando NO se está jugando)

- Fondo shader activo al ritmo de una canción de ambientación (música "del lobby").
- Título "DAINO" centrado grande.
- 3–4 acciones en lista vertical, tipo menú de consola:
  - **JUGAR** (abre el selector/upload de MP3 → lanza nivel)
  - **NIVELES** (lista de niveles guardados + historial de partidas)
  - **RANKING**
  - **PERFIL**

> ⚠️ **Modificado por el doc 10 (Sep 2026), Ola 2.** Obligar a subir un MP3 para poder jugar espanta al jugador nuevo. A partir de la Ola 2:
> - **JUGAR** abre el **catálogo de niveles** (rejilla de tarjetas grandes, no panel lateral), no el selector de archivos.
> - **"Subir mi canción"** pasa a ser una acción propia y explícita, separada visualmente, para que nadie pulse JUGAR y se encuentre un diálogo de archivos por sorpresa.
> - El drag & drop sobre la ventana se mantiene como atajo.
>
> El resto de este apartado (shader activo, título centrado, avatar arriba-derecha, sin navbar ni footer) sigue vigente.
- Esquina superior derecha: avatar + username (clic → perfil/logout).
- Esquina inferior derecha: indicador sutil de volumen y toggle de música del menú.
- **No hay navbar ni footer.**

### 4.2 Modo Juego (durante una partida)

- Fondo shader reacciona al MP3 del nivel en curso.
- Centro: área jugable (dino salta, obstáculos, etc.). Es una zona **virtualmente centrada** del escenario, pero sin un `div` contenedor visible con fondo distinto — el gameplay se pinta directamente sobre el shader de fondo.
- HUD superior izquierdo: score.
- HUD superior central: **barra de progreso del nivel** (porcentaje de canción completado).
- HUD superior derecho: título + artista de la canción.
- Esquina inferior izquierda: nombre/avatar del jugador (mini).
- Tecla `ESC` o tap en esquina superior derecha → **pausa con menú overlay** (semi-transparente sobre el juego congelado).

### 4.3 Transiciones

- Entrar a una partida: fade a negro (~300 ms) + drop súbito de la música de menú + arranque del MP3 del nivel. Evita parpadeo y da señal clara al jugador.
- Game over / nivel completado: **overlay semi-transparente** con resultado + opciones (Reintentar / Siguiente / Volver al menú). El shader de fondo sigue corriendo por detrás.

---

## 5. Pausa, navegación y "páginas"

El Daino viejo tenía páginas HTML separadas (`ranking.html`, `perfil.html`, `info.html`, etc.). En el nuevo:

- **Una sola página** (SPA manual, sin framework). El router PHP sirve una única vista base; el JS cambia de modo sin recargar.
- Acciones "ir al ranking", "ver perfil" abren **paneles modales deslizantes** (slide-in desde el lado derecho, tipo menú de PS5), no páginas nuevas.
- El shader de fondo nunca se oculta mientras un modal está abierto — solo se desatura un poco.

Implicación en el backend PHP: seguimos teniendo rutas separadas (`GET /api/ranking`, `GET /api/profile`, etc.), pero devuelven **JSON**, no HTML. La única ruta que devuelve HTML es `GET /` (shell).

Hay excepciones justificadas donde sí devolvemos HTML server-side:
- `GET /` — shell inicial con meta tags, CSS crítico y el `<div id="app">` donde PIXI monta.
- `GET /auth/callback` — redirect del OAuth flow de Vout, hace su trabajo y redirige a `/`.
- Vistas para cuando JavaScript está desactivado (fallback básico, sin gameplay pero con info de cuenta).

---

## 6. Accesibilidad y responsive

- **Desktop primario**: la experiencia está diseñada para ~16:9 en monitor. Input preferido: teclado (espacio = saltar, ↓ = agacharse).
- **Touch (móvil/tablet)**: tap en mitad izquierda del viewport = saltar, tap en mitad derecha = agacharse. O botones virtuales si se prefiere — a decidir en implementación.
- **Reducir movimiento**: respetar `prefers-reduced-motion`. Si el usuario lo tiene activado:
  - Shader de fondo se reemplaza por un degradado estático.
  - Partículas ambientales se desactivan.
  - El gameplay no cambia.
- **Sin cámara/micro**: Daino no pide permisos de cámara. Eso es responsabilidad de Vout cuando el juego va embebido. En standalone, solo teclado y touch.

---

## 7. Qué pasa con el flujo embebido en Vout (iframe)

Cuando Daino corre dentro de un `<iframe>` en Vout:

- Detectamos con `window.self !== window.top`.
- **El HUD de usuario (avatar/username) se oculta** porque el portal Vout ya muestra ese dato en su propio chrome.
- El botón "Volver al menú" cambia a "Volver al portal" y cierra la sesión del iframe (envía `postMessage({type:"EXIT"})` al parent).
- El resto del layout sigue igual: shader + gameplay + HUD de score/progreso.

---

## 8. Tech notes para la implementación

- **Un solo canvas PixiJS** a `width: 100vw; height: 100vh`, attachado al `<body>`. Nunca reubicar ni redimensionar dentro de un contenedor — siempre ocupa el viewport entero.
- El shader de fondo es un `PIXI.Filter` sobre un `Sprite` que cubre todo el `stage`. Recibe uniforms: `uTime`, `uRMS`, `uBass`, `uMid`, `uHigh`, `uBpmPulse`.
- El HUD es **DOM puro con Tailwind**, posicionado `fixed`, con `pointer-events: none` excepto en elementos interactivos. Esto permite CSS de calidad para textos (mejor tipografía que la de PIXI Text para UI).
- Las transiciones de modales usan animaciones CSS, no JS. El shader sigue corriendo sin cálculos extra en transiciones.

---

## 9. Impacto en el doc 05 (estructura de proyecto)

La capa UI separada en `resources/js/ui/` sigue teniendo sentido, pero sus archivos cambian de propósito:

- `ui/hud.js` — monta el overlay DOM (score, progress bar, song info), lo muestra/oculta según modo.
- `ui/menu.js` (nuevo) — renderiza el menú del estado "no jugando". No estaba contemplado en el doc 03 porque allí UI = "mostrar/ocultar ranking en una página existente"; aquí es un modo visual completo.
- `ui/modals.js` (nuevo) — paneles slide-in para ranking, perfil, configuración.
- `ui/auth.js` — sigue gestionando el estado de sesión, pero ya no oculta/muestra botones "login" que flotan por ahí: el modo menú es distinto según haya sesión o no.

No hace falta reescribir el doc 05. Este 06 lo complementa.

---

## 10. Referencias visuales (para mood, no copiado literal)

- Menús de PlayStation 5 / Xbox Series X (paneles slide-in, HUD discreto).
- Geometry Dash (fondo reactivo + gameplay frontal).
- Beat Saber / osu! (feedback audio-visual integrado, no UI de web clásica).
- Thumper (fondo shader intenso sincronizado con beat).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Shader de fondo consume GPU en móviles básicos. | Detectar `navigator.hardwareConcurrency` + tamaño de viewport. Si es bajo, caer a un fondo procedural más barato (gradiente + partículas 2D sin shader). |
| Sin navbar, un usuario nuevo no sabe cómo cambiar de canción o ver ranking. | Tutorial breve en primer arranque (overlay "Pulsa ESPACIO para empezar, ESC para el menú"). Persistir en localStorage el "ya vi el tutorial". |
| La app es una SPA manual — refrescar pierde estado. | Estado efímero (canción actual, partida en curso) no se persiste. Estado estable (usuario, progresos, ranking) se recarga desde la API. Sin drama. |
| Sin HTML pages separadas, SEO empeora. | Daino no necesita SEO relevante — es una app, no un blog. El `<meta>` básico en `GET /` basta. |
