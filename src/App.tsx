import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, Check, ChevronDown, Download, Footprints, Link2, LocateFixed, MousePointer2, Navigation, PencilLine, Plus, Route, RotateCcw, Trash2, WandSparkles, X } from 'lucide-react'
import { GeoPoint, NetworkRoutingAdapter, OsrmFootRoutingAdapter, RouteResult, RoutingAdapter, ValhallaRoutingAdapter, distanceMeters } from './routing'
import { MapPoint, parseSvgGuide, pathFromMapPoints } from './svgGuide'
import { FetchSvgSourceLoader, SvgSourceLoader } from './svgSource'

type Surface = 'Paved' | 'Trails'
type BuildStatus = 'ready' | 'building' | 'failed'

const defaultSketch: MapPoint[] = [
  { x: 48, y: 58 }, { x: 42, y: 50 }, { x: 31, y: 49 }, { x: 27, y: 40 }, { x: 35, y: 26 },
  { x: 51, y: 21 }, { x: 67, y: 34 }, { x: 73, y: 49 }, { x: 63, y: 63 }, { x: 48, y: 58 },
]
const defaultStart: GeoPoint = { lat: 50.4501, lng: 30.5234 }
const distanceFloor = 1
const distanceCeiling = 100
const distanceStep = 0.5
const router: RoutingAdapter = new NetworkRoutingAdapter([new ValhallaRoutingAdapter(), new OsrmFootRoutingAdapter()])
const svgSourceLoader: SvgSourceLoader = new FetchSvgSourceLoader()
const initialGuideScale = 0.47
const maximumScaleAttempts = 3

/**
 * Places the SVG around the selected start point at the requested running
 * distance.  The old fixed degree conversion made the same sketch roughly
 * 9 km everywhere, regardless of the distance chooser.
 */
const guideToGeo = (guide: MapPoint[], start: GeoPoint, targetDistanceMeters: number): GeoPoint[] => {
  const anchor = guide[0]
  const sketchLength = guide.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - guide[index].x, point.y - guide[index].y), 0)
  const metresPerSketchUnit = targetDistanceMeters / Math.max(sketchLength, 1)
  const metresPerLatitudeDegree = 111_132
  const metresPerLongitudeDegree = 111_320 * Math.cos(start.lat * Math.PI / 180)

  return guide.map(point => ({
    lat: start.lat + (anchor.y - point.y) * metresPerSketchUnit / metresPerLatitudeDegree,
    lng: start.lng + (point.x - anchor.x) * metresPerSketchUnit / metresPerLongitudeDegree,
  }))
}

const resamplePath = (points: GeoPoint[], spacingMeters = 35) => points.slice(1).flatMap((end, index) => {
  const start = points[index]
  const steps = Math.max(1, Math.ceil(distanceMeters(start, end) / spacingMeters))
  return Array.from({ length: steps }, (_, step) => {
    const progress = step / steps
    return { lat: start.lat + (end.lat - start.lat) * progress, lng: start.lng + (end.lng - start.lng) * progress }
  })
}).concat(points.at(-1) ?? [])
const nearestPathDistance = (point: GeoPoint, path: GeoPoint[]) => Math.min(...path.map(candidate => distanceMeters(point, candidate)))
const evaluateMatch = (route: GeoPoint[], guide: GeoPoint[]) => {
  const sampledRoute = resamplePath(route)
  const sampledGuide = resamplePath(guide)
  const deviations = sampledRoute.map(point => nearestPathDistance(point, sampledGuide))
  const guideDeviations = sampledGuide.map(point => nearestPathDistance(point, sampledRoute))
  const rawDeviations = route.map(point => nearestPathDistance(point, sampledGuide))
  const mismatches = rawDeviations.slice(0, -1).map((distance, index) => (distance + rawDeviations[index + 1]) / 2 > 180)
  const meanDeviation = [...deviations, ...guideDeviations].reduce((total, distance) => total + distance, 0) / (deviations.length + guideDeviations.length)
  const withinTolerance = (distances: number[]) => distances.filter(distance => distance <= 100).length / distances.length
  const coverage = (withinTolerance(deviations) + withinTolerance(guideDeviations)) / 2
  const precision = Math.max(0, 1 - meanDeviation / 160)
  const closesLoop = distanceMeters(route[0], route.at(-1)!) <= 100
  const score = Math.max(0, Math.round(100 * (coverage * 0.7 + precision * 0.3) * (closesLoop ? 1 : 0.35)))
  return { mismatches, score, coverage, closesLoop }
}
const pointToLatLng = ({ lat, lng }: GeoPoint): L.LatLngExpression => [lat, lng]

type RouteMapProps = {
  route: RouteResult | null
  guide: GeoPoint[]
  showSketch: boolean
  start: GeoPoint
  manualWaypoints: GeoPoint[]
  mismatchSegments: boolean[]
  editMode: boolean
  startMode: boolean
  onMapClick: (point: GeoPoint) => void
}

function RouteMap({ route, guide, showSketch, start, manualWaypoints, mismatchSegments, editMode, startMode, onMapClick }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const guideLayerRef = useRef<L.LayerGroup | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const clickHandlerRef = useRef(onMapClick)
  useEffect(() => { clickHandlerRef.current = onMapClick }, [onMapClick])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false }).setView(pointToLatLng(defaultStart), 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    const handleMapClick = (event: L.LeafletMouseEvent) => clickHandlerRef.current({ lat: event.latlng.lat, lng: event.latlng.lng })
    map.on('click', handleMapClick)
    mapRef.current = map
    routeLayerRef.current = L.layerGroup().addTo(map)
    guideLayerRef.current = L.layerGroup().addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    return () => { map.off('click', handleMapClick); map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const layer = guideLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (showSketch && guide.length > 1) L.polyline(guide.map(pointToLatLng), { color: '#bd5f3c', weight: 3, dashArray: '3 7', opacity: 0.88 }).addTo(layer)
  }, [guide, showSketch])

  useEffect(() => {
    const layer = routeLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (!route || route.points.length < 2) return
    L.polyline(route.points.map(pointToLatLng), { color: '#f7fff9', weight: 9, opacity: 0.94, lineCap: 'round', lineJoin: 'round' }).addTo(layer)
    L.polyline(route.points.map(pointToLatLng), { color: '#11694c', weight: 4.5, opacity: 0.98, lineCap: 'round', lineJoin: 'round' }).addTo(layer)
    mismatchSegments.forEach((mismatch, index) => {
      if (mismatch) L.polyline([pointToLatLng(route.points[index]), pointToLatLng(route.points[index + 1])], { color: '#d66a47', weight: 5, opacity: 0.98, lineCap: 'round' }).addTo(layer)
    })
  }, [mismatchSegments, route])

  useEffect(() => {
    const layer = markerLayerRef.current
    if (!layer) return
    layer.clearLayers()
    const startIcon = L.divIcon({ className: 'leaflet-start-pin', html: '<span><i>Start</i></span>', iconSize: [42, 42], iconAnchor: [21, 38] })
    L.marker(pointToLatLng(start), { icon: startIcon, keyboard: false }).addTo(layer)
    if (editMode) manualWaypoints.forEach((point, index) => L.circleMarker(pointToLatLng(point), { radius: 6, color: '#fff', weight: 3, fillColor: '#11694c', fillOpacity: 1 }).bindTooltip(`Waypoint ${index + 1}`).addTo(layer))
  }, [editMode, manualWaypoints, start])

  return <div className={`map-canvas ${editMode || startMode ? 'map-canvas--editing' : ''}`} ref={containerRef} aria-label="Map showing the route" />
}

function App() {
  const [minDistance, setMinDistance] = useState(4.5)
  const [maxDistance, setMaxDistance] = useState(6)
  const [surface, setSurface] = useState<Surface>('Paved')
  const [safeRoads, setSafeRoads] = useState(true)
  const [sketch, setSketch] = useState(defaultSketch)
  const [svgUrl, setSvgUrl] = useState('')
  const [isLoadingSvgUrl, setIsLoadingSvgUrl] = useState(false)
  const [start, setStart] = useState(defaultStart)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [builtGuide, setBuiltGuide] = useState<GeoPoint[] | null>(null)
  const [manualWaypoints, setManualWaypoints] = useState<GeoPoint[]>([])
  const [editMode, setEditMode] = useState(false)
  const [startMode, setStartMode] = useState(false)
  const [showSketch, setShowSketch] = useState(true)
  const [status, setStatus] = useState<BuildStatus>('ready')
  const [offlineSaved, setOfflineSaved] = useState(false)
  const [notice, setNotice] = useState('Upload a route outline or build from the sample sketch.')
  const [matchScore, setMatchScore] = useState<number | null>(null)
  const [mismatchSegments, setMismatchSegments] = useState<boolean[]>([])
  const targetDistanceMeters = ((minDistance + maxDistance) / 2) * 1000
  const guide = useMemo(() => guideToGeo(sketch, start, targetDistanceMeters * initialGuideScale), [sketch, start, targetDistanceMeters])
  const displayedGuide = builtGuide ?? guide
  const displayedDistance = route ? route.distanceMeters / 1000 : null
  const distanceRangeStyle = { background: `linear-gradient(to right, #dce5da 0%, #dce5da ${((minDistance - distanceFloor) / (distanceCeiling - distanceFloor)) * 100}%, #218159 ${((minDistance - distanceFloor) / (distanceCeiling - distanceFloor)) * 100}%, #218159 ${((maxDistance - distanceFloor) / (distanceCeiling - distanceFloor)) * 100}%, #dce5da ${((maxDistance - distanceFloor) / (distanceCeiling - distanceFloor)) * 100}%, #dce5da 100%)` }

  const buildRoute = async () => {
    if (maxDistance <= minDistance || maxDistance - minDistance < 0.4) {
      setStatus('failed')
      setNotice('Choose a distance range that is at least 0.5 km wide.')
      return
    }
    setStatus('building')
    setNotice('Matching your outline to walkable roads and trails…')
    try {
      let scale = initialGuideScale
      let best: { guide: GeoPoint[], result: RouteResult, match: ReturnType<typeof evaluateMatch>, quality: number } | null = null
      for (let attempt = 0; attempt < maximumScaleAttempts; attempt += 1) {
        const candidateGuide = guideToGeo(sketch, start, targetDistanceMeters * scale)
        const result = await router.buildLoop({ start, guide: candidateGuide, requiredWaypoints: manualWaypoints, surface, avoidBusyRoads: safeRoads })
        const match = evaluateMatch(result.points, candidateGuide)
        const distanceError = Math.abs(result.distanceMeters - targetDistanceMeters) / targetDistanceMeters
        const quality = match.score - Math.min(50, distanceError * 100)
        if (!best || quality > best.quality) best = { guide: candidateGuide, result, match, quality }
        const isWithinRange = result.distanceMeters >= minDistance * 1000 && result.distanceMeters <= maxDistance * 1000
        if (isWithinRange && match.score >= 75) break
        const correction = Math.max(0.6, Math.min(1.45, targetDistanceMeters / result.distanceMeters))
        scale *= correction
      }
      if (!best || best.match.score < 75 || best.result.distanceMeters > maxDistance * 1000 || best.result.distanceMeters < minDistance * 1000) {
        throw new Error('No close shape match')
      }
      setRoute(best.result)
      setBuiltGuide(best.guide)
      setMismatchSegments(best.match.mismatches)
      setMatchScore(best.match.score)
      setStatus('ready')
      setNotice(`Route built with a ${best.match.score}% shape match.`)
    } catch {
      setStatus('failed')
      setNotice('No route followed this outline closely enough. No misleading shortcut was shown. Try a wider range or add a waypoint where the shape must be preserved.')
    }
  }

  const applySketchSource = (source: string, successMessage: string) => {
    try {
      const parsedSketch = parseSvgGuide(source)
      setSketch(parsedSketch)
      setRoute(null)
      setBuiltGuide(null)
      setManualWaypoints([])
      setMismatchSegments([])
      setMatchScore(null)
      setShowSketch(true)
      setNotice(successMessage)
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The SVG could not be read.')
      return false
    }
  }

  const uploadSketch = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type !== 'image/svg+xml' && !file.name.toLowerCase().endsWith('.svg')) {
      setNotice('Please upload your route outline as an SVG file.')
      event.target.value = ''
      return
    }
    applySketchSource(await file.text(), 'Outline read successfully. Build the route to snap it to walkable streets and trails.')
    event.target.value = ''
  }

  const loadSketchFromUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!svgUrl.trim()) {
      setNotice('Enter an SVG URL to load an outline.')
      return
    }
    setIsLoadingSvgUrl(true)
    try {
      const source = await svgSourceLoader.load(svgUrl.trim())
      applySketchSource(source, 'Outline loaded from URL. Build the route to snap it to walkable streets and trails.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The SVG could not be loaded.')
    } finally {
      setIsLoadingSvgUrl(false)
    }
  }

  const placeOnMap = (point: GeoPoint) => {
    if (startMode) {
      setStart(point); setStartMode(false); setRoute(null); setBuiltGuide(null); setMismatchSegments([]); setMatchScore(null)
      setNotice('Start point set. Build the loop when you are ready.')
    } else if (editMode) {
      setManualWaypoints(current => [...current, point]); setRoute(null); setBuiltGuide(null); setMismatchSegments([]); setMatchScore(null)
      setNotice('Waypoint added. Build the route to include it on the next pass.')
    }
  }
  const clearRoute = () => { setRoute(null); setBuiltGuide(null); setMismatchSegments([]); setMatchScore(null); setManualWaypoints([]); setNotice('Route and waypoints cleared. Your sketch is still available.') }

  return <main className="app-shell">
    <header className="topbar"><a className="wordmark" href="#workspace"><span className="wordmark-mark"><Route size={18} /></span>track<span>imagination</span></a><div className="mode-label"><Footprints size={15} /> Running <ChevronDown size={14} /></div><div className="topbar-actions"><button className="icon-button" aria-label="Set start point" onClick={() => { setStartMode(true); setEditMode(false) }}><LocateFixed size={18} /></button><button className="profile">IK</button></div></header>
    <section className="workspace" id="workspace">
      <RouteMap route={route} guide={displayedGuide} showSketch={showSketch} start={start} manualWaypoints={manualWaypoints} mismatchSegments={mismatchSegments} editMode={editMode} startMode={startMode} onMapClick={placeOnMap} />
      {showSketch && <span className="sketch-label"><PencilLine size={13} /> Your sketch</span>}
      {(startMode || editMode) && <div className="map-instruction">{startMode ? <><LocateFixed size={16} /> Click the map to set your start point</> : <><Plus size={16} /> Click a street to add a required waypoint</>}</div>}
      <aside className="inspector">
        <div className="inspector-head"><div><p className="eyebrow">NEW ROUTE</p><h1>Sketch your run</h1></div><button className="close-button" aria-label="Close"><X size={18} /></button></div>
        <p className="intro">Your SVG defines the target shape. The route is then matched to pedestrian-accessible roads and trails.</p>
        <div className="sketch-row"><div className="sketch-mini"><svg viewBox="0 0 100 100" aria-hidden="true"><path d={pathFromMapPoints(sketch)} /></svg></div><div><strong>Route shape</strong><small>{showSketch ? 'Parsed SVG · shown on the map' : 'Parsed SVG · hidden on the map'}</small></div><label className="file-action" title="Upload SVG outline"><Plus size={15} /><input aria-label="Add SVG sketch" type="file" accept="image/svg+xml,.svg" onChange={uploadSketch} /></label><form className="svg-url-form" onSubmit={loadSketchFromUrl}><label htmlFor="svg-url">SVG URL<input id="svg-url" type="url" value={svgUrl} onChange={event => setSvgUrl(event.target.value)} placeholder="https://example.com/route.svg" /></label><button type="submit" disabled={isLoadingSvgUrl}><Link2 size={14} />{isLoadingSvgUrl ? 'Loading…' : 'Load URL'}</button></form></div>
        <section className="control-section"><div className="section-label"><span>Distance</span><span className="muted">km</span></div><div className="distance-values"><output htmlFor="minimum-distance">From {minDistance.toFixed(1)} km</output><output htmlFor="maximum-distance">To {maxDistance.toFixed(1)} km</output></div><div className="distance-slider" style={distanceRangeStyle}><input id="minimum-distance" aria-label="Minimum distance" type="range" min={distanceFloor} max={maxDistance - distanceStep} step={distanceStep} value={minDistance} onChange={event => { setMinDistance(Number(event.target.value)); setRoute(null); setBuiltGuide(null); setMismatchSegments([]); setMatchScore(null) }} /><input id="maximum-distance" aria-label="Maximum distance" type="range" min={minDistance + distanceStep} max={distanceCeiling} step={distanceStep} value={maxDistance} onChange={event => { setMaxDistance(Number(event.target.value)); setRoute(null); setBuiltGuide(null); setMismatchSegments([]); setMatchScore(null) }} /></div></section>
        <section className="control-section"><div className="section-label"><span>Surface</span></div><div className="segmented"><button className={surface === 'Paved' ? 'selected' : ''} onClick={() => setSurface('Paved')}>Paved</button><button className={surface === 'Trails' ? 'selected' : ''} onClick={() => setSurface('Trails')}>Trails</button></div></section>
        <section className="switch-row"><div><strong>Avoid unsuitable roads</strong><small>Prefer pedestrian-friendly, lower-traffic streets</small></div><button className={`switch ${safeRoads ? 'on' : ''}`} onClick={() => setSafeRoads(value => !value)} aria-label="Avoid unsuitable roads"><i /></button></section>
        <button className="build-button" onClick={buildRoute} disabled={status === 'building'}><WandSparkles size={17} />{status === 'building' ? 'Finding paths…' : 'Build route'}</button>
        {notice && <div className={`notice ${status === 'failed' ? 'notice--error' : ''}`}>{status === 'failed' ? <AlertTriangle size={15} /> : <Check size={15} />}<span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={13} /></button></div>}
        {route && <div className="match-summary"><div><span>SHAPE MATCH</span><strong>{matchScore ?? 0}%</strong></div><div><span>ROUTE LENGTH</span><strong>{displayedDistance?.toFixed(1)} km</strong></div>{mismatchSegments.some(Boolean) && <p><AlertTriangle size={13} /> Orange sections deviate from the sketch. Add a waypoint near them, then rebuild.</p>}</div>}
        {status === 'failed' && <div className="failure"><div className="failure-icon"><Route size={19} /></div><div><strong>No route found</strong><p>There is no suitable pedestrian loop with these settings.</p></div><button onClick={() => { setMaxDistance(Math.max(maxDistance, minDistance + 1.5)); setSafeRoads(false); setStatus('ready'); setNotice('Distance range expanded and busy-road avoidance relaxed.') }}><RotateCcw size={14} /> Expand range and allow all roads</button></div>}
      </aside>
      <section className="route-drawer"><div className="drawer-route"><span className="route-dot"><Navigation size={16} fill="currentColor" /></span><div><p>LOOP ROUTE</p><strong>{displayedDistance ? `${displayedDistance.toFixed(1)} km` : 'Not built'}</strong><span>{displayedDistance ? ` · about ${Math.round(displayedDistance * 6.2)} min` : ' · build from your sketch'}</span></div></div><div className="drawer-actions"><button className={editMode ? 'active' : ''} onClick={() => { setEditMode(value => !value); setStartMode(false) }}><MousePointer2 size={16} />{editMode ? 'Done' : 'Edit route'}</button><button onClick={() => setShowSketch(value => !value)}><PencilLine size={16} />{showSketch ? 'Hide sketch' : 'Show sketch'}</button><button className={offlineSaved ? 'saved-offline' : 'primary'} onClick={() => setOfflineSaved(true)}>{offlineSaved ? <Check size={16} /> : <Download size={16} />}{offlineSaved ? 'Available offline' : 'Save offline'}</button><button className="trash" onClick={clearRoute} aria-label="Clear route"><Trash2 size={17} /></button></div></section>
    </section>
  </main>
}

export default App
