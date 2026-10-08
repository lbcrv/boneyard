# 🦴 BONEYARD

**Sandbox de ragdoll activo en el navegador**, inspirado en Euphoria/Endorphin: un muñeco de pruebas que *intenta* mantenerse en pie mientras tú lo empujas, le disparas, lo lanzas y lo explotas.

▶️ **Jugar:** https://lbcrv.github.io/boneyard/

Sin instalación ni build: es HTML + JavaScript con [Three.js](https://threejs.org/) (render) y [cannon-es](https://github.com/pmndrs/cannon-es) (física), cargados desde CDN.

## Qué lo hace “Endorphin”

El muñeco no es un ragdoll muerto ni una animación: es un **ragdoll activo**.

- **Músculos en cada articulación.** Cada unión (cuello, cintura, hombros, codos, caderas, rodillas, tobillos) tiene un servo PD que aplica impulsos angulares iguales y opuestos al hueso padre y al hijo, con un torque máximo. Músculo fuerte = postura firme; músculo débil = flácido.
- **Límites anatómicos.** Uniones de cono y giro para hombros, caderas, cuello y cintura; bisagras con límites para codos y rodillas.
- **Equilibrio.** Torques de verticalidad en pelvis y pecho, un “muelle” que sostiene la cadera a altura de pie si hay suelo debajo, y empuje horizontal para caminar. El ciclo de pasos se genera según la velocidad real, así que si lo empujas da pasos para recuperarse.
- **Reacciones.** Los golpes medianos lo hacen tambalearse; los fuertes le quitan el equilibrio por completo. Mientras cae **agita los brazos en el aire**, **se protege con las manos** antes de tocar el suelo, en el suelo **se encoge y se retuerce**, y cuando se detiene **se levanta** solo.
- **Huesos rotos y K.O.** Un impacto de más de ~14 m/s rompe la articulación (queda colgando sin fuerza). Un golpe así en la cabeza lo deja K.O. Con las dos piernas rotas ya no puede levantarse.
- **Tropiezos.** Correr cuesta abajo (¡escaleras!) lo desestabiliza hasta que tropieza.

## Mapas

| | Mapa | Qué hay |
|---|---|---|
| 🛝 | **El Patio** | Rampas, dominó, balancín, tronco colgante, cama elástica, plataformas de lanzamiento, barriles explosivos |
| 🪜 | **Escalera del Dolor** | 40 escalones al estilo *Stair Dismount*: cada golpe suma puntos |
| ⚙️ | **La Picadora** | Pista sobre el vacío con barredoras, martillos, pistones, checkpoints y cronómetro |
| 🏙️ | **Los Tejados** | Azoteas a 30 m, saltos entre edificios, bola de demolición, calle llena de coches |

## Controles

| Tecla | Acción |
|---|---|
| `WASD` / flechas | Moverse (relativo a la cámara) |
| `Shift` | Correr |
| `Espacio` | Saltar (o levantarse antes si está en el suelo) |
| `Q` | Lanzarse en plancha |
| `F` | Puñetazo |
| `E` (mantener) | Estirar los brazos y **agarrar** lo que toquen las manos (cajas, bordes…) |
| `X` | Hacerse el muerto (ragdoll total) |
| `R` | Reaparecer |
| `1`–`7` | Herramienta: ✋ Agarrar · ⚫ Cañón · 💣 Bomba · 📦 Caja · 🛢️ Barril · 🚚 Camión · 🌀 Empujón |
| Clic izquierdo | Usar herramienta (con ✋, arrastra y suelta para lanzar) |
| Clic derecho + arrastrar | Girar la cámara |
| Rueda | Zoom (o distancia de agarre mientras arrastras) |
| `T` | Cámara lenta |
| `G` | Gravedad lunar |
| `Backspace` | Reiniciar el mapa |
| `Esc` | Menú de mapas |

## Puntuación

Cada impacto suma **DOLOR** según su velocidad (la cabeza vale el doble). Los golpes encadenados en menos de 1,3 s suben el multiplicador de combo. Huesos rotos, K.O., explosiones y caídas al vacío dan bonus. El récord de cada mapa se guarda en el navegador.

## Ejecutar en local

Los módulos ES necesitan un servidor (no funciona abriendo el archivo directamente):

```bash
python -m http.server 5178
```

y abre http://localhost:5178.

## Estructura

```
index.html        HUD, menú, importmap de Three.js y cannon-es
style.css
src/main.js       render, cámara, entrada, herramientas, puntuación, bucle principal
src/ragdoll.js    el ragdoll activo: cuerpos, articulaciones, músculos, equilibrio, estados
src/level.js      props, barriles, camiones, objetos cinemáticos, triggers, explosiones
src/maps.js       los 4 mapas
src/physics.js    mundo físico, materiales, utilidades
src/fx.js         partículas, sacudida de cámara, textos flotantes
src/audio.js      efectos de sonido sintetizados con WebAudio (sin archivos de audio)
src/textures.js   texturas generadas con canvas
```

## Licencia

MIT
