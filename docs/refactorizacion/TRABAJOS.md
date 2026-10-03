# Índice de trabajos de Daino

> **Para qué existe.** Un solo sitio para ubicar cualquier trabajo grande del proyecto por su identificador, esté donde esté documentado. Si en un comentario del código, un commit o una conversación aparece `T03.1`, aquí se ve qué es y en qué documento está.

## Cómo se numera

- **Trabajo** = un objetivo grande (varias sesiones). Identificador **global** de proyecto: **`T` + dos cifras** (`T01`, `T02`…). Se asigna en orden, **nunca se reutiliza** (ni si un trabajo se cancela) y no depende del documento que lo describe.
- **Ola** = cada entrega de un trabajo: el número del trabajo, un punto y el orden (**`T01.2`** = segunda ola del T01).
- Cada trabajo vive en un roadmap (el documento que lo diseña). Un roadmap nuevo **no inventa números**: toma el siguiente libre de este índice y lo apunta aquí.
- En los roadmaps, cada ola tiene su casilla `[ ]` → `[x]` al completarse. En este índice se actualiza el estado del trabajo.
- Las dos cifras distinguen un trabajo (`T01`) de un Bloque (`Bloque 1`) o de una ola de la serie antigua (`Ola 1`).

**Siguiente número libre: `T06`.**

## Trabajos

| ID | Trabajo | Roadmap | Olas | Estado |
|---|---|---|---|---|
| **T01** | Escenario vivo: el cielo cuenta la canción (día → atardecer → noche con luna → amanecer) | [doc 11](11-Roadmap-Escenarios-Efectos.md) | T01.1 ✅ niebla fuera · T01.2 ✅ ciclo del cielo · T01.3 ✅ luna · T01.4 ⬜ playtest | En curso (falta el playtest) |
| **T02** | Escenas con personalidad e historia: ambientes que elige quien sube (Cordillera, Costa, Lluvia, Tormenta, Nieve, Ciudad de noche), su arco con la canción e historias de autor para oficiales (One Day: mar, barco y destello verde) | [doc 11](11-Roadmap-Escenarios-Efectos.md) | T02.1 ✅ escena por nivel · T02.2 ✅ la Costa · T02.3 ✅ lluvia, tormenta y nieve · T02.4 ✅ ciudad de noche · T02.5 ✅ automático · T02.6 ✅ historias y One Day · T02.7+ ⬜ más historias | En curso (quedan más historias) |
| **T03** | Efectos visuales al ritmo de la música: registro con nombre, un director que decide cuánto se ve cada uno, limitador que protege lo que se juega, la escena manda (One Day declara los suyos), el espectro en el paisaje y la identidad de cada canción (su paleta y su firma en el cielo) | [doc 11](11-Roadmap-Escenarios-Efectos.md) | T03.1 ✅ cimientos y control · T03.2 ✅ espectro en el paisaje y pulso por astro (con el color de los efectos a juego con el cielo, tras el segundo playtest) · T03.3 ✅ identidad por canción (paletas medidas contra el cielo, reparto en el servidor, aurora y lluvia de estrellas) · T03.4 ⬜ playtest | En curso (falta el playtest) |
| **T04** | La interfaz, hecha de lo mismo que el juego: letra propia de celdas, colores de la paleta con un papel cada uno, paneles y botones sin cristal ni resplandores, portadas que son el escenario de cada nivel y el Dino en el panel de resultados | [doc 12](12-Identidad-Interfaz.md) | T04.1 ✅ lenguaje visual, piezas y todas las pantallas · T04.2 ⬜ playtest | En curso (falta el playtest) |
| **T05** | Rendimiento en cualquier equipo: el cielo (lo único que pesa) en su propio búfer y a su ritmo, calidad automática que mide de verdad y baja primero el detalle del cielo, fotogramas parejos en cualquier pantalla y nada que se prepare a mitad de canción | [doc 10](10-Roadmap-Niveles-Rendimiento-UX.md) | T05.1 ✅ el cielo en su búfer · T05.2 ✅ calidad automática y ritmo propio · T05.3 ✅ sin tirones a mitad de canción · T05.4 ⬜ móviles de verdad (lectura `?perf=1` hecha; falta la prueba en el Android del user) | En curso (falta la prueba en un móvil real) |

## Series anteriores (no se renumeran)

Anteriores a este índice. Conservan sus nombres porque todo el código y los documentos se refieren a ellos así.

| Serie | Qué es | Roadmap | Estado |
|---|---|---|---|
| **Bloques 0-8** | Construcción de la v2 capa a capa (framework, persistencia, identidad Vout, frontend, juego, UI, API) | [doc 08](08-Bloques-Operativos.md) | 0-7 ✅ · **Bloque 8** (hardening: PHPStan, Pest, CSP, rate limiting…) ⬜ |
| **Olas 0-7** | Rediseño de niveles, rendimiento y UX (sincronía, analizador, charter musical, modos de movimiento) | [doc 10](10-Roadmap-Niveles-Rendimiento-UX.md) | 0-6c ✅ · **Ola 7** (editor de niveles) 💤 aplazada como futura actualización |

Si el Bloque 8 o la Ola 7 se retoman, pueden seguir con su nombre o pasar a un número `T` nuevo: en ese caso se apunta aquí la equivalencia (por ejemplo, "T06 = antigua Ola 7").
