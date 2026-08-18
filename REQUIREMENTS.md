# Track Imagination — Requirements

## Purpose

The application builds running routes from a user sketch. The sketch defines the intended shape, while the finished route must only follow paths that are walkable or runnable.

## Route construction

- Route mode: running.
- Path-network source: OpenStreetMap or a compatible routing service.
- The user sets a start point.
- The sketch start point snaps to a real point 100–200 m from the user's selected start.
- By default, the generator aims for a loop that ends near the start point.
- Show the sketch over the real map alongside the generated route.
- The user can manually adjust the route through particular streets.

## User settings

- Minimum and maximum distance are separate inputs, for example 4.5–5 km or 5–10 km.
- A toggle to avoid unsuitable or unsafe roads.
- A surface toggle: paved or trails.

## Unsuccessful routing

If an acceptable runnable route cannot be created in the specified range, explain why and offer to:

- expand the distance range;
- change the surface type;
- disable avoidance of unsuitable roads.

## Offline use

The user can save a completed route and the required map area for offline running.
