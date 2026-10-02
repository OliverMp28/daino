# 12 — La interfaz, hecha de lo mismo que el juego (T04)

> **Estado:** T04.1 ✅ completa (Oct 2026). T04.2 ⬜ playtest y afinado.
> **Trabajo:** `T04` en [TRABAJOS.md](TRABAJOS.md). Refina el doc 06 (que sigue mandando en layout y flujos): aquí se decide **cómo se ve** la interfaz DOM.
> **Código:** `resources/css/ui/`, `resources/js/ui/pixel/`, `resources/js/ui/kit.js`, `resources/js/ui/coverModel.js`.

---

## 1. De dónde sale

Playtest de la interfaz (Oct 2026), con capturas del panel de resultados y del catálogo:

> "La vista de niveles se ve muy neón o muy a típica interfaz hecha por IA. Recuerda la personalidad del proyecto, que se vea bien, con identidad propia."

Lo que había, medido sobre el CSS y las capturas:

| Síntoma | Dónde |
|---|---|
| Paneles de cristal: fondo translúcido con degradado y la escena **desenfocada** detrás | Todos los diálogos. En la pausa, el pixel art del juego se veía borroso |
| Resplandores y sombras blandas de color | Porcentaje de resultados, barra de progreso, tarjetas al pasar el ratón |
| Todo en píldoras y esquinas redondas | Botones, pestañas, insignias, avatares |
| **La misma portada en todas las tarjetas**: un sol con rendijas y unas barras, con otro tono | Catálogo. No decía nada del nivel |
| La letra del sistema para todo, incluido el rótulo del juego (`Inter` en el CSS, que nadie cargaba) | Menú, HUD, paneles |
| Rosa en todas partes: JUGAR, "Iniciar sesión", la pestaña activa, los puestos del ranking, los errores | El color de la acción no destacaba |
| Cada pantalla con sus propios botones | `menu__action`, `daino-btn`, `run__primary`… cinco botones distintos |

Nada de eso tiene que ver con el juego, que es pixel art de celdas, colores planos y cantos duros.

## 2. La idea

**La interfaz está hecha de lo mismo que el juego.** Celdas, la paleta de sus sprites, cantos en escalón; y sus propias piezas (el Dino, el suelo, el cielo de cada escenario) usadas donde informan.

De ahí salen seis reglas (vinculantes):

1. **Dos voces.** Lo que **dice el juego** (rótulos, botones, números, el marcador) va en su letra de celdas. Lo que es **contenido** (el título de una canción, un nombre de usuario, una explicación) va en la letra del sistema: puede traer cualquier carácter y se lee mejor en frases.
2. **Cada color hace un papel**, y son los de la paleta del pixel art (`assets/palette.js`; un test lo vigila):

   | Color | De dónde | Papel |
   |---|---|---|
   | Rosa `--d-beat` | el ptero | El pulso: **la acción que juega** (JUGAR, REINTENTAR) y el clímax en el camino de la canción. Ningún otro bloque es rosa |
   | Cian `--d-spike` | las púas del Dino | **Lo tuyo**: tu marca, tu fila del ranking, lo elegido, el foco |
   | Oro `--d-gold` | el modo vuelo | La dificultad (estrellas) y un récord |
   | Verde `--d-cactus` | el cactus | Un nivel superado |
   | Naranja `--d-warn` | el orbe | Lo que falla o borra |
   | Periwinkle `--d-edge` | la línea del suelo | La estructura: el canto de un panel, la pestaña activa |
   | `--d-bone` · `--d-belly` · `--d-mute` | el Dino, su panza | Los tres niveles de texto |
   | `--d-ground` · `--d-raise` · `--d-speck` · `--d-ink` | la tierra del suelo y sus motas | Fondos y líneas |

3. **Lo que no hay:** degradados de adorno, desenfoques, resplandores, sombras blandas, esquinas redondas. Detrás de un panel la escena se oscurece con un velo liso y sigue nítida. (Un test lo comprueba en las hojas de estilo.)
4. **Celdas enteras.** Letra, marcos y portadas miden un número entero de píxeles de pantalla a cualquier tamaño y zoom.
5. **Nada decorativo que no informe.** La portada de un nivel es su escenario; el Dino del panel de resultados está donde llegaste; la línea bajo una portada es tu marca.
6. **Una pieza, un sitio.** Botón, tecla, etiqueta, estrellas, opciones y fila de ranking se montan en `ui/kit.js` y se pintan en `components.css`. Una pantalla las coloca; no fabrica las suyas.

## 3. Las piezas

### 3.1 La letra (`ui/pixel/font.js`, `text.js`)

Una letra propia de **6×7 celdas con astas de dos**, dibujada como los sprites: rejillas de texto en el código. Mayúsculas, cifras (todas del mismo ancho), tildes y `ñ` (la tilde sube de la caja, con una fila de aire), signos y unos pocos símbolos (`★ ▶ ◀ ▲ ▼ ← → ↑ ↓ ♪ ✓ × ℹ`). Unos 90 dibujos.

- `pixelText(texto, { tag, className, shadow })` devuelve un nodo con un `<svg>` de un solo trazo (un rectángulo por racha de celdas), del color del texto (`currentColor`) y del tamaño de `--cell`, y el texto de verdad oculto a la vista (lectores de pantalla, `textContent`).
- `setPixelText(nodo, texto)` lo cambia; si no cambia, no toca nada (el marcador lo llama a 20 Hz).
- **Un texto con algún carácter sin dibujar no sale a medias**: se pinta entero en la letra del sistema (`supportsText`). El título `夜に駆ける` o un `&` no rompen nada.
- Un `pixelText` es una línea. Para un rótulo largo en un sitio estrecho, `kit.pxWords` (una pieza por palabra, que se parten en líneas).
- Sobre la escena (HUD, rótulo del menú), **sombra dura** de una celda (`shadow: true`) o de media en los rótulos grandes (`'half'`).

Tamaños: `--cell` se hereda. Un componente dice el suyo y lo que lleva dentro lo sigue (`--u1` para etiquetas, `--u2` para botones y datos, `--u3` para títulos, hasta `--u16` en la cuenta atrás).

### 3.2 La rejilla (`ui/pixel/grid.js`)

La UI crece con la pantalla (rem fluido, doc 10) y el zoom o un portátil al 125 % dan píxeles de pantalla que no coinciden con los de CSS. Una celda de 2,6 px se pinta unas veces de 2 y otras de 3: columnas desiguales.

`startPixelGrid()` calcula las unidades `--u1`…`--u16` (≈ N/16 de rem) **redondeadas a píxeles de pantalla enteros** y las vuelve a calcular al cambiar la ventana o el zoom. Una unidad nunca queda por debajo del 88 % de su diseño: al 125 %, `--u1` serían 0,8 px de CSS (una letra de 5,6 px) y sube a 2 píxeles de pantalla. Sin el módulo, las unidades valen en rem (`tokens.css`).

### 3.3 Las portadas (`ui/pixel/cover.js`, `coverModel.js`, `coverImage.js`)

La portada de un nivel es **una miniatura del sitio donde se juega**: su escenario (el mismo que resuelve `registry.playSceneId`) a una hora del cielo, dibujado con las piezas del juego —`skyStateAt`/`skyColorAt`, la forma real de las crestas (`ridgeHeights`) y de los edificios (`skylineBuildings`, con sus ventanas), el color del mar, la tira del suelo de cada escena—, en 240 × 72 celdas.

- **La hora, por la dificultad** (`COVER_HOURS`): cuanto más difícil, más tarde. Relajado, pleno día; Fácil, la hora dorada; Normal, el atardecer; Difícil, el anochecer; Extremo, la noche cerrada. La Ciudad (ciclo `nocturne`) va de la hora azul a la medianoche. Con los oficiales de fácil a difícil, el catálogo se lee como un día que pasa. Cualquier hora es verdad: todo nivel recorre el día entero.
- **Una historia de autor enseña su hora** (`menuHour`: One Day, la despedida con el barco en el sol).
- **Dos niveles iguales en escenario y dificultad no salen iguales**: el paisaje se desplaza según el nivel (`coverPan`, 16 encuadres).
- El cielo va en franjas con trama entre ellas, como un degradado de pixel art.
- `COVER_PAINTERS` es un registro por tipo de capa. Una capa nueva sin pintor no rompe nada (sale sin ella), y un test obliga a decidir: o tiene pintor, o se apunta como efecto que no sale (`spectrum`, `lightning`).
- En el navegador se dibujan una vez por clave y se guardan. Dibujar es 1 ms; codificar la imagen, 12-20: las que faltan se hacen en tandas cortas y la tarjeta enseña mientras el color de su cielo.

La muestra de cada ambiente en el selector de escenario es su portada (antes, un degradado de cuatro colores).

### 3.4 Los sprites en la interfaz (`ui/pixel/sprite.js`)

Los mismos dibujos que se juegan, con su paleta y sus skins, como imagen de una celda por píxel que el CSS amplía sin suavizar:

- **Panel de resultados y de pausa:** el Dino, de pie en el camino de la canción donde llegaste. Caído si chocaste, trotando si superaste el nivel.
- **"Preparando nivel"** (`ui/loader.js`): el Dino trota sobre un trozo de suelo mientras se analiza la canción (el escenario de detrás está parado).
- **AJUSTES → Personaje:** los tres Dinos, en vez de una lista desplegable.

### 3.5 Componentes (`ui/kit.js`, `components.css`)

| Pieza | Cómo es |
|---|---|
| **Panel** `.daino-panel` | Un bloque del suelo: su tierra oscura y arriba la línea clara. Opaco, esquinas en escalón, sombra dura de dos celdas |
| **Botón** `.daino-btn` | Bloque con un labio oscuro que se hunde al pulsar. `--primary` (rosa: jugar), `--strong` (claro: confirmar algo que no es jugar), `--ghost`, `--danger`, `--sm`, `--lg`, `--icon` |
| **Tecla** `.daino-key` | El atajo de una acción, dibujado como la tecla. Se oculta en táctil |
| **Etiqueta** `.daino-tag` | "OFICIAL", "LISTO PARA PUBLICAR"… con el color de su estado |
| **Estrellas** `.daino-stars` | Cinco, en oro las que cuentan |
| **Opciones en fila** `.daino-seg` | Un grupo de radio (flechas para cambiar): calidad, efectos, personaje, dificultad, escenario |
| **Deslizador**, **casilla** | Carril de una celda con lo recorrido en cian y tope cuadrado; cuadro que se llena |
| **Fila de ranking** (`ui/rankingRow.js`) | La misma en el ranking global y en el de cada nivel. Tu fila, con el canto cian |

El foco es el marco del propio elemento, en cian y el doble de grueso (dentro: las esquinas en escalón recortarían un contorno por fuera).

## 4. Qué cambia en cada pantalla

| Pantalla | Antes | Ahora |
|---|---|---|
| **Menú** | Título en la letra del sistema, botones redondeados translúcidos, "Iniciar sesión" en rosa | Rótulo y lema en la letra del juego con sombra dura; lista de acciones con cursor ▶; JUGAR, el único rosa |
| **Catálogo** | Portadas iguales con otro tono, brillo al pasar el ratón, ▶ de cristal | Portada = escenario y hora; línea de tu marca bajo ella; estrellas y dificultad; ▶ y detalles juntos en el pie; al pasar el ratón, marco claro y ▶ en rosa |
| **Ficha** | Estadísticas en letra pequeña, selectores en cajas redondeadas, muestra de escenario en degradado | Datos en la letra del juego; selectores de opciones en fila; cada ambiente con su portada; el progreso del análisis, antes que el escenario |
| **Pausa y resultados** | Tarjeta de cristal con resplandor del color del resultado, escena desenfocada, iconos vectoriales | Panel opaco sobre la escena nítida; el camino de la canción con el Dino y el banderín de tu mejor marca; sin iconos; en la pausa, Reintentar en su fila |
| **HUD** | Sombras difuminadas, "SCORE", chevrones girados, barra con resplandor | Letra del juego con sombra dura, "PUNTOS", flechas de la letra, barra plana con marco |
| **Ajustes** | Listas desplegables y casilla del navegador | Opciones en fila, los tres Dinos, deslizador y casilla propios |
| **Ranking, perfil** | Filas redondeadas, puesto en rosa | Filas planas; el podio en oro; tu fila en cian; mientras llega, filas vacías del mismo alto |
| **Subir mi canción** | Zona de trazos "o arrástralo aquí" | Un botón (el MP3 se suelta en cualquier parte de la ventana) |
| **Avisos, carga, girar el móvil** | Texto con fondo desenfocado | Panel o marco de la interfaz; el Dino trotando en la carga |

Sin cambios de flujo: mismas acciones, mismas teclas, mismas clases y `data-*` que usan los tests de navegador.

## 5. Organización del CSS

`resources/css/main.css` era un archivo de 3 256 líneas. Ahora es un índice y cada cosa tiene su hoja en `resources/css/ui/`:

`tokens.css` (colores con su papel, unidades) · `base.css` (el marco de la página) · `pixel.css` (letra, sprites, portadas) · `components.css` · `menu.css` · `hud.css` · `dialogs.css` · `catalog.css` · `run.css` · `dev.css`.

Los tokens antiguos `--color-daino-*` ya no existen.

## 6. Verificación

- **Tests:** `tests/js/ui-pixel.test.mjs` (10): colores = paleta y hojas sin filtros, redondeos ni resplandores; cada dibujo de la letra es una rejilla regular; **todo lo que dice el juego está dibujado** (lista de rótulos, vistas del panel de partida, etiquetas de publicación, escenas y dificultades); un título cualquiera cae a la letra del sistema; unidades enteras en píxeles de pantalla a ocho densidades y seis tamaños; cada escena se dibuja entera a todas sus horas; toda capa tiene pintor o se deja fuera a propósito; la portada es determinista y cambia con la hora y el encuadre; más tarde cuanto más difícil. **428 JS.**
- **Capturas** de todas las pantallas y estados a 1600 × 900, 1280 × 720, 1536 × 864 al 125 %, 3840 × 2160, móvil apaisado (844 × 390 ×2) y vertical (390 × 844 ×3), con sesión simulada para lo que solo se ve con ella (Míos, publicar, análisis en curso y fallido, ranking del nivel).
- **Rendimiento** (Intel UHD 620, 1600 × 900, 20 s de partida): 60,0 FPS, p99 17,1 ms, un fotograma por encima de 40 ms.
- **Build de producción** jugado en el navegador: menú, catálogo (12 de 12 portadas), partida, pausa, resultados, reintento con Espacio y vuelta a Niveles con Esc, sin errores. Principal 101,4 KB gzip (+6,5: la letra, el dibujo de portadas y la forma de la ciudad, que antes iba en su trozo); CSS 12,7 KB gzip.

## 7. Límites

- **Es un juicio sobre capturas**, no sobre uso: falta jugarlo y navegarlo de verdad, sobre todo en un móvil.
- **A densidad 1 (monitor de 1080p al 100 %), la letra pequeña mide 7 px**: nítida, pero pequeña. Al 125 % mide 11. No hay tamaño intermedio con celdas enteras.
- **La letra es solo mayúsculas** y no tiene `&` ni `@`. Lo que el juego diga con otro carácter cae a la letra del sistema (visible, sin romperse) hasta que se dibuje.
- **Las portadas de dos niveles pueden coincidir** (mismo escenario, dificultad y encuadre: 1 de cada 16).
- **El rótulo de las historias de autor** (T02.6) sigue en serif cursiva con sombra difuminada: es la voz de la historia, no la del juego.
- **El panel de herramientas de dev** solo cambió de nombres de color.

## 8. Cómo se amplía

- **Un carácter nuevo:** su bloque en `RAW` (`font.js`). El test de rejilla lo comprueba.
- **Un rótulo nuevo del juego:** `pixelText`/`kit.px`; añadirlo a la lista del test si lleva caracteres raros.
- **Un componente nuevo:** en `kit.js` y `components.css`, con los tokens; nunca colores sueltos.
- **Una capa de escenario nueva:** su pintor en `COVER_PAINTERS`, o apuntarla como efecto en el test.
- **Un ciclo de cielo nuevo:** sus cinco horas en `COVER_HOURS`.

## 9. Olas

- [x] **T04.1** — Lenguaje visual, piezas y todas las pantallas.
- [ ] **T04.2** — Playtest y afinado: ¿se siente del juego?, ¿la letra pequeña se lee en tu pantalla?, ¿las portadas ayudan a elegir?, ¿el panel de resultados se entiende de un vistazo? Lo que se toque: `tokens.css`, `COVER_HOURS`, `COVER` (`landScale`, `bandRows`), el tamaño `--cell` de cada pieza.

## 10. Descartado

- **Una fuente pixel descargada** (Press Start 2P y parecidas): archivo binario o petición a terceros, y es la letra "retro" de todo el mundo.
- **La letra fina de 5×7** (la primera que se dibujó): se leía como una calculadora. La gruesa encaja con los sprites.
- **El cero tachado**: en la letra gruesa se leía un 8.
- **Contorno de una celda en el HUD**: cerraba los huecos de las cifras. Sombra dura.
- **El Dino en cada portada**: a media resolución no cabe, y a tamaño real tapaba el paisaje.
- **▶ sobre la portada**: caía encima del sol.
- **Rosa para los errores**: se mezclaba con el color de jugar.
