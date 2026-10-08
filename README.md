# BONEYARD

Un muñeco de pruebas de impacto con músculos, equilibrio y reflejos. Intenta mantenerse en pie. Tú decides cuánto le dura.

**Jugar:** https://lbcrv.github.io/boneyard/

HTML y JavaScript sin paso de build. [Three.js](https://threejs.org/) dibuja, [cannon-es](https://github.com/pmndrs/cannon-es) calcula la física y los dos se cargan desde CDN.

## Cómo funciona el muñeco

Es un ragdoll activo, como el de Euphoria/Endorphin: un cuerpo físico de 13 piezas que se sostiene con fuerzas propias.

- **Músculos.** Cada una de las 12 articulaciones tiene un servo que empuja hacia una postura objetivo con un par máximo. Con el par alto mantiene la pose; con el par bajo cuelga.
- **Límites.** Hombros, caderas, cuello y cintura giran dentro de un cono. Codos y rodillas son bisagras con tope.
- **Equilibrio.** La pelvis y el pecho reciben un par que los endereza, y un muelle sostiene la cadera a 95 cm del suelo. Los pasos salen de la velocidad real: si lo empujas, da pasos.
- **Reacciones.** Un golpe por encima de 3 m/s lo desequilibra; por encima de 7,5 m/s lo tira. En el aire agita los brazos, antes de tocar el suelo pone las manos, en el suelo se encoge. Cuando se queda quieto 1,4 s, se levanta.
- **Fracturas.** A partir de 14 m/s la articulación del miembro golpeado pierde el músculo y queda colgando. En la cabeza, eso es K.O. durante 4,5 s. Con fractura en las dos piernas ya no se levanta.
- **Tropiezos.** Si baja una pendiente corriendo, acumula inestabilidad y cae.

## Pruebas

| Código | Mapa | Contenido |
|---|---|---|
| P-01 | Patio | Rampas, dominó, balancín, tronco colgante, cama elástica, barriles |
| P-02 | Escalera | 40 escalones, 18 m de desnivel |
| P-03 | Picadora | 92 m de pista sobre el vacío, barredoras, martillos, pistones. Cronometrada |
| P-04 | Tejados | Azoteas de 18 a 30 m, bola de demolición, coches |

## Controles

| Tecla | Acción |
|---|---|
| `WASD` | Mover (relativo a la cámara) |
| `Shift` | Correr |
| `Espacio` | Saltar. En el suelo, levantarse antes |
| `Q` | Lanzarse en plancha |
| `F` | Puñetazo |
| `E` | Mantener para agarrar con las manos (cajas, bordes) |
| `X` | Inerte: apaga todos los músculos |
| `R` | Reaparecer |
| `1`–`7` | Agarrar, cañón, bomba, caja, barril, camión, empujón |
| Clic izquierdo | Usar la herramienta. Con agarrar, arrastra y suelta para lanzar |
| Clic derecho | Arrastrar para girar la cámara |
| Rueda | Zoom, o distancia de agarre mientras arrastras |
| `T` | Cámara lenta (×0,3) |
| `G` | Gravedad lunar (3,2 m/s²) |
| `Retroceso` | Reiniciar el mapa |
| `H` | Plegar la leyenda de teclas |
| `Esc` | Menú |

## Puntuación

Cada impacto suma DOLOR en función de la velocidad y la parte del cuerpo; la cabeza cuenta ×2,2. Si encadenas golpes con menos de 1,3 s entre ellos, el multiplicador sube 0,1 por golpe hasta ×3. Las fracturas, el K.O., las explosiones y las caídas al vacío suman extra. El navegador guarda el récord de cada mapa.

## En local

Los módulos ES necesitan un servidor:

```bash
python -m http.server 5178
```

Luego abre http://localhost:5178.

## Archivos

```
index.html        HUD, menú, importmap
style.css
src/main.js       render, cámara, entrada, herramientas, puntuación, bucle
src/ragdoll.js    cuerpo, articulaciones, músculos, equilibrio, estados
src/level.js      objetos, barriles, camiones, piezas móviles, explosiones
src/maps.js       las cuatro pruebas
src/physics.js    mundo físico y materiales
src/icons.js      pictogramas de la barra de herramientas
src/fx.js         partículas, sacudida, textos flotantes
src/audio.js      sonido sintetizado con WebAudio
src/textures.js   texturas generadas con canvas
```

## Licencia

MIT
