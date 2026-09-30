# Índice de trabajos de Daino

> **Para qué existe.** Un solo sitio para ubicar cualquier trabajo grande del proyecto por su identificador, esté donde esté documentado. Si en un comentario del código, un commit o una conversación aparece `T03.1`, aquí se ve qué es y en qué documento está.

## Cómo se numera

- **Trabajo** = un objetivo grande (varias sesiones). Identificador **global** de proyecto: **`T` + dos cifras** (`T01`, `T02`…). Se asigna en orden, **nunca se reutiliza** (ni si un trabajo se cancela) y no depende del documento que lo describe.
- **Ola** = cada entrega de un trabajo: el número del trabajo, un punto y el orden (**`T01.2`** = segunda ola del T01).
- Cada trabajo vive en un roadmap (el documento que lo diseña). Un roadmap nuevo **no inventa números**: toma el siguiente libre de este índice y lo apunta aquí.
- En los roadmaps, cada ola tiene su casilla `[ ]` → `[x]` al completarse. En este índice se actualiza el estado del trabajo.
- Las dos cifras distinguen un trabajo (`T01`) de un Bloque (`Bloque 1`) o de una ola de la serie antigua (`Ola 1`).

**Siguiente número libre: `T04`.**

## Trabajos

| ID | Trabajo | Roadmap | Olas | Estado |
|---|---|---|---|---|
| **T01** | Escenario vivo: el cielo cuenta la canción (día → atardecer → noche con luna → amanecer) | [doc 11](11-Roadmap-Escenarios-Efectos.md) | T01.1 ✅ niebla fuera · T01.2 ✅ ciclo del cielo · T01.3 ✅ luna · T01.4 ⬜ playtest | En curso (falta el playtest) |
| **T02** | Escenas con personalidad e historia: ambientes que elige quien sube (Cordillera, Costa…), su arco con la canción e historias de autor para oficiales (One Day: mar, barco y destello verde) | [doc 11](11-Roadmap-Escenarios-Efectos.md) | T02.1 ✅ escena por nivel · T02.2 ✅ la Costa · T02.3 ⬜ clima · T02.4 ⬜ ciudad de noche · T02.5 ⬜ automático · T02.6 ⬜ historias y One Day · T02.7+ ⬜ más historias | En curso |
| **T03** | Efectos visuales al ritmo de la música (registro con nombre, panel "Efectos", reparto por canción) | [doc 11](11-Roadmap-Escenarios-Efectos.md) | T03.1-T03.3 ⬜ | Pendiente |

## Series anteriores (no se renumeran)

Anteriores a este índice. Conservan sus nombres porque todo el código y los documentos se refieren a ellos así.

| Serie | Qué es | Roadmap | Estado |
|---|---|---|---|
| **Bloques 0-8** | Construcción de la v2 capa a capa (framework, persistencia, identidad Vout, frontend, juego, UI, API) | [doc 08](08-Bloques-Operativos.md) | 0-7 ✅ · **Bloque 8** (hardening: PHPStan, Pest, CSP, rate limiting…) ⬜ |
| **Olas 0-7** | Rediseño de niveles, rendimiento y UX (sincronía, analizador, charter musical, modos de movimiento) | [doc 10](10-Roadmap-Niveles-Rendimiento-UX.md) | 0-6c ✅ · **Ola 7** (editor de niveles) 💤 aplazada como futura actualización |

Si el Bloque 8 o la Ola 7 se retoman, pueden seguir con su nombre o pasar a un número `T` nuevo: en ese caso se apunta aquí la equivalencia (por ejemplo, "T05 = antigua Ola 7").
