export type GeoPoint = { lat: number; lng: number }

export type RouteResult = {
  points: GeoPoint[]
  distanceMeters: number
}

export type RouteRequest = {
  start: GeoPoint
  guide: GeoPoint[]
  requiredWaypoints: GeoPoint[]
  surface: 'Paved' | 'Trails'
  avoidBusyRoads: boolean
}

export interface RoutingAdapter {
  buildLoop(request: RouteRequest): Promise<RouteResult>
}

type ValhallaResponse = {
  trip?: {
    summary?: { length?: number }
    legs?: Array<{ shape?: unknown }>
  }
}

type OsrmResponse = {
  routes?: Array<{
    distance?: number
    geometry?: { coordinates?: unknown }
  }>
}

const toPoint = (value: unknown): GeoPoint | null => {
  if (!Array.isArray(value) || value.length < 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number') return null
  return { lng: value[0], lat: value[1] }
}

const decodePolyline = (encoded: string, precision = 6): GeoPoint[] => {
  const points: GeoPoint[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const factor = 10 ** precision
  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20 && index < encoded.length)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 0
    shift = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20 && index < encoded.length)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ lat: lat / factor, lng: lng / factor })
  }
  return points
}

const extractLegPoints = (shape: unknown): GeoPoint[] => {
  if (typeof shape === 'string') return decodePolyline(shape)
  if (shape && typeof shape === 'object' && 'coordinates' in shape) {
    const coordinates = (shape as { coordinates: unknown }).coordinates
    return Array.isArray(coordinates) ? coordinates.map(toPoint).filter((point): point is GeoPoint => point !== null) : []
  }
  return Array.isArray(shape) ? shape.map(toPoint).filter((point): point is GeoPoint => point !== null) : []
}

export const distanceMeters = (first: GeoPoint, second: GeoPoint) => {
  const radius = 6_371_000
  const latitude = (second.lat - first.lat) * Math.PI / 180
  const longitude = (second.lng - first.lng) * Math.PI / 180
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const pathDistance = (points: GeoPoint[]) => points.slice(1).reduce((total, point, index) => total + distanceMeters(points[index], point), 0)

const uniqueStops = (points: GeoPoint[]) => points.filter((point, index) => index === 0 || distanceMeters(point, points[index - 1]) > 80)

const closestGuideIndex = (point: GeoPoint, guide: GeoPoint[]) => guide.reduce(
  (closest, candidate, index) => distanceMeters(point, candidate) < closest.distance ? { index, distance: distanceMeters(point, candidate) } : closest,
  { index: 0, distance: Number.POSITIVE_INFINITY },
).index

/** Inserts manually placed stops at their position around the drawn loop. */
const orderedStops = (start: GeoPoint, guide: GeoPoint[], requiredWaypoints: GeoPoint[]) => {
  const stops = [
    ...guide.map((point, index) => ({ point, order: index, priority: 0 })),
    ...requiredWaypoints.map(point => ({ point, order: closestGuideIndex(point, guide), priority: 1 })),
  ]
    .sort((first, second) => first.order - second.order || first.priority - second.priority)
    .map(({ point }) => point)

  const interiorStops = uniqueStops(stops).filter(point => distanceMeters(start, point) > 80).slice(0, 10)
  return [start, ...interiorStops, start]
}

/** A typed public-routing adapter. It asks Valhalla for pedestrian paths, never from a React component. */
export class ValhallaRoutingAdapter implements RoutingAdapter {
  async buildLoop({ start, guide, requiredWaypoints, surface, avoidBusyRoads }: RouteRequest): Promise<RouteResult> {
    const stops = orderedStops(start, guide, requiredWaypoints)
    if (stops.length < 3) throw new Error('Add a larger route outline or at least one waypoint.')

    const response = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: stops.map((point, index) => ({
          lat: point.lat,
          lon: point.lng,
          type: index === 0 || index === stops.length - 1 ? 'break' : 'through',
        })),
        costing: 'pedestrian',
        costing_options: {
          pedestrian: {
            walking_speed: 5,
            service_penalty: avoidBusyRoads ? 25 : 0,
            use_ferry: 0,
            ...(surface === 'Trails' ? { use_hills: 0.7 } : {}),
          },
        },
        units: 'kilometers',
        shape_format: 'polyline6',
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`Routing service returned ${response.status}`)
    const data = await response.json() as ValhallaResponse
    const points = data.trip?.legs?.flatMap(leg => extractLegPoints(leg.shape)) ?? []
    if (points.length < 2) throw new Error('Routing service did not return a route shape')
    return { points, distanceMeters: pathDistance(points) }
  }
}

/** A pedestrian OpenStreetMap router used when the primary routing service is unavailable. */
export class OsrmFootRoutingAdapter implements RoutingAdapter {
  async buildLoop(request: RouteRequest): Promise<RouteResult> {
    const stops = orderedStops(request.start, request.guide, request.requiredWaypoints)
    if (stops.length < 3) throw new Error('Add a larger route outline or at least one waypoint.')

    const coordinates = stops.map(point => `${point.lng},${point.lat}`).join(';')
    const response = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, {
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`Fallback routing service returned ${response.status}`)
    const data = await response.json() as OsrmResponse
    const route = data.routes?.[0]
    const points = route?.geometry?.coordinates && Array.isArray(route.geometry.coordinates)
      ? route.geometry.coordinates.map(toPoint).filter((point): point is GeoPoint => point !== null)
      : []
    if (points.length < 2) throw new Error('Fallback routing service did not return a route shape')
    return { points, distanceMeters: route?.distance ?? pathDistance(points) }
  }
}

/** Uses only routers that return geometries aligned to the OpenStreetMap path network. */
export class NetworkRoutingAdapter implements RoutingAdapter {
  constructor(private readonly adapters: RoutingAdapter[]) {}

  async buildLoop(request: RouteRequest): Promise<RouteResult> {
    let lastError: unknown
    for (const adapter of this.adapters) {
      try {
        return await adapter.buildLoop(request)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error('No routing service is available.')
  }
}
