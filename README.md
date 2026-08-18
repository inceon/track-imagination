# Track Imagination

A React application for turning a rough SVG route sketch into a runnable loop.

**Live app:** [inceon.github.io/track-imagination](https://inceon.github.io/track-imagination/)

## How it works

- Upload an SVG that contains a `path`, `polyline`, or `polygon`; its longest outline becomes the route guide.
- Choose a start point, distance range, surface preference, and road-safety preference.
- The app sends sampled guide points to a typed pedestrian-routing adapter, which uses Valhalla and a pedestrian OSRM fallback to return a walkable loop on the OpenStreetMap path network.
- The green line is the routed loop, the dashed terracotta line is the sketch, and orange route sections are farther than 180 m from the sketch. Add waypoints there and rebuild to improve alignment.
- If the public routing service is unavailable, the app reports the failure and does not draw a misleading straight-line route.

## Run locally

```bash
npm install
npm run dev
```

Open the address printed by Vite. Upload an SVG route outline and select **Build route**. Use **Edit route** to add required waypoints on the map, then rebuild.

## Stack

React, TypeScript, Vite, Leaflet, OpenStreetMap tiles, Valhalla pedestrian routing, CSS, and SVG. GitHub Pages deploys automatically on every push to `main`.
