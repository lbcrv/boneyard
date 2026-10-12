# BONEYARD

Un muñeco de pruebas de impacto con músculos, equilibrio y reflejos. Intenta mantenerse en pie. Tú decides cuánto le dura.

**Jugar:** https://lbcrv.github.io/boneyard/

HTML y JavaScript sin paso de build. [Three.js](https://threejs.org/) dibuja, [cannon-es](https://github.com/pmndrs/cannon-es) calcula la física y los dos se cargan desde CDN.

## Cómo funciona el muñeco

Es un ragdoll activo, como el de Euphoria/Endorphin: un cuerpo físico de 16 piezas que se sostiene con fuerzas propias.

- **Músculos.** Cada una de las 15 articulaciones (columna en dos tramos, cuello, hombros, codos, muñecas, caderas, rodillas, tobillos) tiene un servo que empuja hacia una postura objetivo con un par máximo.
- **Pasos de verdad.** Un planificador decide dónde pisa cada pie y una IK de dos huesos coloca la pierna. En una escalera cada pie se apoya en un escalón y la cadera baja con él.
- **Peso.** 85 kg, gravedad de 12,5 m/s² y poco amortiguamiento: cae rápido y pesado.
- **Reacciones.** Un golpe por encima de 3 m/s lo desequilibra; por encima de 7,5 m/s lo tira. En el aire agita los brazos, antes de tocar el suelo pone las manos, en el suelo se encoge, y se levanta cuando se queda quieto.
- **Tropiezos.** Caminando baja escaleras; corriendo engancha los escalones y rueda.

## Los 206 huesos

El esqueleto anatómico completo está modelado hueso por hueso: 29 de cráneo, cara, oído e hioides, 26 vértebras, 25 de tórax, 4 de cintura escapular, 2 coxales y 60 por cada par de extremidades. Cada hueso tiene posición y resistencia propias.

Un impacto rompe los huesos que tiene cerca según dónde golpea y a qué velocidad: una bala rompe uno o dos; un golpe contundente, más cuanto más fuerte. Las fracturas tienen consecuencias:

- fémur, tibia, húmero, radio o cúbito rotos: la extremidad pierde el músculo y cuelga
- vértebra cervical rota: K.O.
- vértebra torácica o lumbar rota: parálisis de cintura para abajo
- las dos piernas rotas, o la pelvis: ya no se levanta

La radiografía de la esquina muestra qué partes están dañadas y los últimos huesos rotos con su nombre.

La física no simula 206 cuerpos rígidos; simula 16 segmentos y resuelve las fracturas hueso a hueso dentro de cada uno.

## Pruebas

| Código | Mapa | Tipo |
|---|---|---|
| P-01 | Patio | Sandbox: rampas, dominó, balancín, tronco colgante, cama elástica |
| P-02 | Escalera | 40 escalones, 18 m de desnivel |
| P-03 | Picadora | Pista sobre el vacío con barredoras, martillos y pistones. Cronometrada |
| P-04 | Tejados | Azoteas de 18 a 30 m, bola de demolición, coches |
| P-05 | Dohyō | Sumo 1 contra 1 a lo Sumotori Dreams. Al mejor de 5 |
| P-06 | Plataforma | Cuatro luchadores sobre una losa en el agua. El último en pie gana |
| P-07 | Muro | Pista de choque a lo Turbo Dismount, con minas a medio camino |
| P-08 | Cruce | Pista de choque con tráfico cruzado |
| P-09 | Dojo | Combate cuerpo a cuerpo por oleadas, a lo Lugaru |
| P-10 | Campo minado | 70 minas enterradas. Cronometrado |

En Muro y Cruce eliges vehículo con `V` (carrito, descapotable, trineo cohete). `W` acelera, `S` frena y, ya parado, da marcha atrás, `A`/`D` giran y `Espacio` es el freno de mano. Los tres llevan suspensión de muelle y amortiguador: la carrocería se inclina en las curvas y cabecea al frenar. El trineo tiene aletas que lo mantienen derecho y le ayudan a girar. En el aire, `W`/`S` inclinan el morro y `A`/`D` lo hacen rodar (el trineo con más fuerza, como en GTA). El muñeco va sujeto al asiento y sale despedido cuando el impacto supera lo que aguanta la sujeción.

## Combate

| Tecla | Movimiento |
|---|---|
| `F` | Puñetazo. Pulsado otra vez a tiempo encadena jab, directo, gancho y uppercut (en sumo, empujón con las dos manos) |
| `V` | Patada. Encadena frontal y circular; de cerca, rodillazo; en el aire, patada voladora |
| `C` | Con un rival cerca, guardia alta: bloquea los golpes altos. Sin rival, agacharse |
| `C` + `V` | Barrida |
| `Q` | Placaje |

**Contraataque:** si pulsas `F` o `V` justo cuando el rival empieza su golpe, le atrapas el brazo o la pierna y lo lanzas por encima del hombro. Los rivales también lo intentan contigo.

Los golpes se fijan solos en el rival más cercano. Cada luchador tiene una barra de consciencia: los golpes en la cabeza la bajan entera, los del tronco menos y los de brazos y piernas casi nada. Se recupera de pie, y a cero cae inconsciente.

Un balazo en la cabeza, un cuello cercenado, una explosión muy cerca o perder demasiada sangre lo matan: queda inerte hasta reiniciar. Al morir el corazón para: las heridas dejan de bombear y solo rezuman un poco, y un miembro arrancado apenas gotea. Si le arrancan una pierna o un pie, o tiene las dos piernas rotas o la columna partida, no puede levantarse, pero sigue despierto: con `WASD` se arrastra con los brazos. Sin un brazo no puede golpear con él. Si está agarrado a algo y tiran de él con violencia, se le arranca el brazo y la mano se queda agarrada.

## Armas y herramientas

`1`–`0` eligen herramienta; clic izquierdo la usa. Mantén `Tab` para abrir la rueda de herramientas (el tiempo se ralentiza), apunta con el ratón y suelta para equipar.

| Tecla | Herramienta |
|---|---|
| `1` | Agarrar: arrastra cualquier cosa y suéltala para lanzarla. Con el muñeco puedes darle un tirón y estamparlo |
| `2` | Subfusil (mantener el clic) |
| `3` | Bazuca |
| `4` | Nuclear: dos segundos de aviso, destello, hongo y una onda expansiva que avanza a 70 m/s |
| `5` | Mina: se arma en un segundo y explota al pisarla |
| `6` | Bomba |
| `7` | Cañón |
| `8` | Caja |
| `9` | Barril explosivo |
| `0` | Camión: apunta al suelo bajo el objetivo y aparece ya lanzado |

## Otros controles

| Tecla | Acción |
|---|---|
| `WASD` | Mover (relativo a la cámara) |
| `Shift` | Correr |
| `Espacio` | Saltar. En el suelo, levantarse antes |
| `E` | Mantener para agarrar con las manos (cajas, bordes) |
| `Z` | Bailar: disco, robot, pollo, saludo. Moverse lo cancela |
| `X` | Inerte: apaga todos los músculos |
| `R` | Reiniciar el mapa entero: objetos, restos, sangre y vehículos |
| Clic derecho | Arrastrar para girar la cámara |
| Rueda | Zoom, o distancia de agarre mientras arrastras |
| `T` | Cámara lenta (×0,3) |
| `G` | Gravedad lunar (3,2 m/s²) |
| `B` | Sangre sí / no |
| `Retroceso` | Reiniciar el mapa |
| `H` | Plegar la leyenda de teclas |
| `Esc` | Menú y ajustes |

## Ajustes

- **Sangre:** desactivada por defecto. Con ella activada, los golpes dejan manchas, los balazos abren heridas que gotean y solo las heridas graves (cabeza, cuello, arteria, amputación) sueltan chorros. En el suelo, las paredes y las rampas la sangre es un líquido: las gotas se juntan, los charcos se extienden y se secan oscuros con el tiempo, y en las paredes escurre hacia abajo y gotea por el borde. Pisarla deja huellas, un cuerpo ensangrentado arrastrado deja rastro, y una mano o un miembro manchado deja su marca en lo que toca. Los golpes muy violentos pueden arrancar un miembro. Cada reaparición limpia la sangre. Se activa en el menú o con `B`, y el navegador recuerda la elección.
- **Calidad:** en automático, si el juego va lento baja la resolución y la sombra.

## Rendimiento

Pensado para que muchas explosiones a la vez no traben el juego:

- partículas, sangre y trazadoras en `InstancedMesh`: una llamada de dibujo por tipo
- un número fijo de luces desde el arranque, así una explosión no obliga a recompilar shaders
- las cadenas de barriles detonan como mucho dos por paso de física
- las partículas por explosión bajan cuando hay muchas seguidas
- el solver usa menos iteraciones cuando hay muchos objetos despiertos

Con 25 explosiones simultáneas, el frame medio en las pruebas fue de 3 ms.

## Puntuación

En los mapas sandbox y de choque, cada impacto que recibe el muñeco suma DOLOR según la velocidad y la parte del cuerpo; la cabeza cuenta ×2,2 y cada fractura suma más. En el sumo y el dojo se cuenta el daño que causas. Los golpes seguidos suben el multiplicador hasta ×3. El navegador guarda el récord de cada mapa.

## En local

Los módulos ES necesitan un servidor:

```bash
python -m http.server 5178
```

Luego abre http://localhost:5178.

Antes de publicar cambios, ejecuta `python tools/stamp.py`. Escribe un hash del contenido en la URL de cada módulo dentro de `index.html`. GitHub Pages deja que el navegador guarde los archivos 10 minutos, y sin esto un jugador podría recibir el `index.html` nuevo con los `.js` viejos.

## Archivos

```
index.html        HUD, menú, importmap
style.css
src/main.js       render, cámara, entrada, herramientas, puntuación, bucle
src/ragdoll.js    cuerpo, músculos, equilibrio, pasos con IK, combate, estados
src/skeleton.js   los 206 huesos y las fracturas
src/moves.js      golpes por fotogramas clave, guardia, bloqueo y reacciones
src/combat.js     IA de luchador y de sumo
src/modes.js      reglas de sumo, dojo y pistas de choque
src/vehicles.js   carrito, descapotable y trineo cohete
src/carmodels.js  carrocerías por perfil: turismos, furgonetas, autobuses, camiones
src/weapons.js    subfusil, bazuca, nuclear, minas
src/blood.js      sangre opcional: heridas, chorros, salpicaduras, huellas
src/bloodfluid.js la sangre del suelo como líquido simulado
src/level.js      objetos, barriles, camiones, piezas móviles, explosiones
src/maps.js       las diez pruebas
src/physics.js    mundo físico y materiales
src/fx.js         partículas instanciadas, sacudida, textos flotantes
src/audio.js      sonido sintetizado con WebAudio
src/icons.js      pictogramas
src/textures.js   texturas generadas con canvas
tools/stamp.py    versiona las URLs de los módulos (caché)
```

## Licencia

MIT
