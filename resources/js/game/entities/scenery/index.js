// Tipos de capa del escenario (T01): el `type` de cada capa de una
// escena (scenes/registry.js) elige aquí su implementación. Una capa nueva (el
// mar de la escena "Costa", T02) es un módulo con la misma forma y una
// entrada en este mapa:
//
//   create(def, { width, height, groundY }) → {
//       container,                        Pixi, en unidades de mundo
//       tick(dt, worldSpeed),             scroll y animación propia
//       resize(width, height, groundY),
//       light(skyState),                  color de la hora (scenes/skyModel.js)
//       setVisible(elementId, on),        interruptores del panel dev
//       setPulse?(pulse, intensity),      efectos que laten (solo si los tiene)
//       dispose(),
//   }

import { createCloudLayer } from './Clouds.js';
import { createGroundLayer } from './Ground.js';
import { createRidgeLayer } from './Ridge.js';

export const LAYER_TYPES = Object.freeze({
    ridge: createRidgeLayer,
    clouds: createCloudLayer,
    ground: createGroundLayer,
});
