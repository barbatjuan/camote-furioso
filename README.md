# Camote Furioso

Arena de supervivencia estilo Brotato, para 1 a 4 jugadores en cooperativo en línea.

**Jugar:** https://camote-furioso-eu.onrender.com (servidor gratis en Render, Frankfurt; si estuvo inactivo tarda ~50 s en despertar).

## Jugar en local

```bash
npm install
npm start
```

Abre http://localhost:8080. Para probar el cooperativo, abre una segunda pestaña, crea la sala en una y únete con el código (o el enlace `#CODIGO`) en la otra. Para jugar con alguien en tu red local, comparte `http://<tu-ip-local>:8080`.

## Estructura

- `shared/game.js`: toda la simulación (armas, enemigos, oleadas, tienda). Corre igual en Node y en el navegador; el mundo es datos planos y los efectos visuales salen como `world.events`.
- `server/server.js`: servidor HTTP + WebSocket. Una simulación autoritativa por sala a 30 ticks/s, snapshots a 15/s.
- `index.html`: cliente. Dibuja snapshots, predice el movimiento propio y suaviza el resto. El modo solo usa la misma simulación localmente.
- `assets/`: sprites generados con Magnific y recortados con `tools/sprites.py` (originales en `raw/`, fuera del repo).

## Protocolo (JSON por WebSocket)

Cliente → servidor: `create {name, char}`, `join {code, name, char}`, `char {char}`, `start`, `lobby`, `input {mx, my, seq}`, `act {a, arg}` (`lvpick`, `buy`, `lock`, `reroll`, `sell`, `combine`, `ready`), `leave`.

Servidor → cliente: `joined {code, you}`, `lobby {code, host, phase, players}`, `state {s, ev}`, `error {msg}`.

## Publicarlo en internet

Necesita un servicio que mantenga conexiones WebSocket abiertas (Railway, Render, Fly.io o un VPS). Comando de inicio `npm start`; el puerto se toma de la variable `PORT`.
