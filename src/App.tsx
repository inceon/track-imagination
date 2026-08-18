import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, Check, ChevronDown, Download, Footprints, LocateFixed, MousePointer2, Navigation, PencilLine, Plus, Route, RotateCcw, Trash2, WandSparkles, X } from 'lucide-react'
import { GeoPoint, RouteResult, RoutingAdapter, SketchFallbackRouter, ValhallaRoutingAdapter, distanceMeters } from './routing'
import { MapPoint, parseSvgGuide, pathFromMapPoints } from './svgGuide'

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
const router: RoutingAdapter = new ValhallaRoutingAdapter()
const fallbackRouter: RoutingAdapter = new SketchFallbackRouter()

const guideToGeo = (guide: MapPoint[], start: GeoPoint): GeoPoint[] => {
  const anchor = guide[0]
  return guide.map(point => ({ lat: start.lat + (anchor.y - point.y) * 0.00043, lng: start.lng + (point.x - anchor.x) * 0.0007 }))
}

const selectStops = (guide: GeoPoint[], count = 6) => Array.from({ length: count }, (_, index) => guide[Math.round(index * (guide.length - 1) / (count - 1))])
const nearestGuideDistance = (point: GeoPoint, guide: GeoPoint[]) => Math.min(...guide.map(candidate => distanceMeters(point, candidate)))
const evaluateMatch = (route: GeoPoint[], guide: GeoPoint[]) => {
  const deviations = route.map(point => nearestGuideDistance(point, guide))
  const mismatches = deviations.slice(0, -1).map((distance, index) => (distance + deviations[index + 1]) / 2 > 180)
  const meanDeviation = deviations.reduce((total, distance) => total + distance, 0) / deviations.length
  return { mismatches, score: Math.max(0, Math.round(100 - meanDeviation / 4)) }
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
  const [start, setStart] = useState(defaultStart)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [manualWaypoints, setManualWaypoints] = useState<GeoPoint[]>([])
  const [editMode, setEditMode] = useState(false)
  const [startMode, setStartMode] = useState(false)
  const [showSketch, setShowSketch] = useState(true)
  const [status, setStatus] = useState<BuildStatus>('ready')
  const [offlineSaved, setOfflineSaved] = useState(false)
  const [notice, setNotice] = useState('Upload a route outline or build from the sample sketch.')
  const [matchScore, setMatchScore] = useState<number | null>(null)
  const [mismatchSegments, setMismatchSegments] = useState<boolean[]>([])
  const guide = useMemo(() => guideToGeo(sketch, start), [sketch, start])
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
    const guidedStops = selectStops(guide)
    try {
      let result: RouteResult
      try { result = await router.buildLoop({ start, guide: [...manualWaypoints, ...guidedStops], surface, avoidBusyRoads: safeRoads }) }
      catch { result = await fallbackRouter.buildLoop({ start, guide, surface, avoidBusyRoads: safeRoads }) }
      const match = evaluateMatch(result.points, guide)
      setRoute(result)
      setMismatchSegments(match.mismatches)
      setMatchScore(match.score)
      setStatus('ready')
      const rangeNote = result.distanceMeters / 1000 < minDistance || result.distanceMeters / 1000 > maxDistance ? ' It falls outside the selected distance range.' : ''
      setNotice(result.isFallback ? `The routing service is unavailable, so this is an offline shape preview.${rangeNote}` : `Route built with a ${match.score}% shape match.${rangeNote}`)
    } catch {
      setStatus('failed')
      setNotice('No walkable loop was found for this shape. Try widening the distance range or add waypoints.')
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
    try {
      const parsedSketch = parseSvgGuide(await file.text())
      setSketch(parsedSketch)
      setRoute(null)
      setManualWaypoints([])
      setMismatchSegments([])
      setMatchScore(null)
      setShowSketch(true)
      setNotice('Outline read successfully. Build the route to snap it to walkable streets and trails.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The SVG could not be read.')
    } finally { event.target.value = '' }
  }

  const placeOnMap = (point: GeoPoint) => {
    if (startMode) {
      setStart(point); setStartMode(false); setRoute(null); setMismatchSegments([]); setMatchScore(null)
      setNotice('Start point set. Build the loop when you are ready.')
    } else if (editMode) {
      setManualWaypoints(current => [...current, point]); setRoute(null); setMismatchSegments([]); setMatchScore(null)
      setNotice('Waypoint added. Build the route to include it on the next pass.')
    }
  }
  const clearRoute = () => { setRoute(null); setMismatchSegments([]); setMatchScore(null); setManualWaypoints([]); setNotice('Route and waypoints cleared. Your sketch is still available.') }

  return <main className="app-shell">
    <header className="topbar"><a className="wordmark" href="#workspace"><span className="wordmark-mark"><Route size={18} /></span>track<span>imagination</span></a><div className="mode-label"><Footprints size={15} /> Running <ChevronDown size={14} /></div><div className="topbar-actions"><button className="icon-button" aria-label="Set start point" onClick={() => { setStartMode(true); setEditMode(false) }}><LocateFixed size={18} /></button><button className="profile">IK</button></div></header>
    <section className="workspace" id="workspace">
      <RouteMap route={route} guide={guide} showSketch={showSketch} start={start} manualWaypoints={manualWaypoints} mismatchSegments={mismatchSegments} editMode={editMode} startMode={startMode} onMapClick={placeOnMap} />
      {showSketch && <span className="sketch-label"><PencilLine size={13} /> Your sketch</span>}
      {(startMode || editMode) && <div className="map-instruction">{startMode ? <><LocateFixed size={16} /> Click the map to set your start point</> : <><Plus size={16} /> Click a street to add a required waypoint</>}</div>}
      <aside className="inspector">
        <div className="inspector-head"><div><p className="eyebrow">NEW ROUTE</p><h1>Sketch your run</h1></div><button className="close-button" aria-label="Close"><X size={18} /></button></div>
        <p className="intro">Your SVG defines the target shape. The route is then matched to pedestrian-accessible roads and trails.</p>
        <div className="sketch-row"><div className="sketch-mini"><svg viewBox="0 0 100 100" aria-hidden="true"><path d={pathFromMapPoints(sketch)} /></svg></div><div><strong>Route shape</strong><small>{showSketch ? 'Parsed SVG · shown on the map' : 'Parsed SVG · hidden on the map'}</small></div><label className="file-action" title="Upload SVG outline"><Plus size={15} /><input aria-label="Add SVG sketch" type="file" accept="image/svg+xml,.svg" onChange={uploadSketch} /></label></div>
        <section className="control-section"><div className="section-label"><span>Distance</span><span className="muted">km</span></div><div className="distance-values"><output htmlFor="minimum-distance">From {minDistance.toFixed(1)} km</output><output htmlFor="maximum-distance">To {maxDistance.toFixed(1)} km</output></div><div className="distance-slider" style={distanceRangeStyle}><input id="minimum-distance" aria-label="Minimum distance" type="range" min={distanceFloor} max={maxDistance - distanceStep} step={distanceStep} value={minDistance} onChange={event => setMinDistance(Number(event.target.value))} /><input id="maximum-distance" aria-label="Maximum distance" type="range" min={minDistance + distanceStep} max={distanceCeiling} step={distanceStep} value={maxDistance} onChange={event => setMaxDistance(Number(event.target.value))} /></div></section>
        <section className="control-section"><div className="section-label"><span>Surface</span></div><div className="segmented"><button className={surface === 'Paved' ? 'selected' : ''} onClick={() => setSurface('Paved')}>Paved</button><button className={surface === 'Trails' ? 'selected' : ''} onClick={() => setSurface('Trails')}>Trails</button></div></section>
        <section className="switch-row"><div><strong>Avoid unsuitable roads</strong><small>Prefer pedestrian-friendly, lower-traffic streets</small></div><button className={`switch ${safeRoads ? 'on' : ''}`} onClick={() => setSafeRoads(value => !value)} aria-label="Avoid unsuitable roads"><i /></button></section>
        <button className="build-button" onClick={buildRoute} disabled={status === 'building'}><WandSparkles size={17} />{status === 'building' ? 'Finding paths…' : 'Build route'}</button>
        {notice && <div className={`notice ${status === 'failed' ? 'notice--error' : ''}`}>{status === 'failed' ? <AlertTriangle size={15} /> : <Check size={15} />}<span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={13} /></button></div>}
        {route && <div className="match-summary"><div><span>SHAPE MATCH</span><strong>{matchScore ?? 0}%</strong></div><div><span>ROUTE LENGTH</span><strong>{displayedDistance?.toFixed(1)} km</strong></div>{mismatchSegments.some(Boolean) && <p><AlertTriangle size={13} /> Orange sections deviate from the sketch. Add a waypoint near them, then rebuild.</p>}{route.isFallback && <p><AlertTriangle size={13} /> Offline preview only — reconnect to use real road routing.</p>}</div>}
        {status === 'failed' && <div className="failure"><div className="failure-icon"><Route size={19} /></div><div><strong>No route found</strong><p>There is no suitable pedestrian loop with these settings.</p></div><button onClick={() => { setMaxDistance(Math.max(maxDistance, minDistance + 1.5)); setSafeRoads(false); setStatus('ready'); setNotice('Distance range expanded and busy-road avoidance relaxed.') }}><RotateCcw size={14} /> Expand range and allow all roads</button></div>}
      </aside>
      <section className="route-drawer"><div className="drawer-route"><span className="route-dot"><Navigation size={16} fill="currentColor" /></span><div><p>{route?.isFallback ? 'OFFLINE PREVIEW' : 'LOOP ROUTE'}</p><strong>{displayedDistance ? `${displayedDistance.toFixed(1)} km` : 'Not built'}</strong><span>{displayedDistance ? ` · about ${Math.round(displayedDistance * 6.2)} min` : ' · build from your sketch'}</span></div></div><div className="drawer-actions"><button className={editMode ? 'active' : ''} onClick={() => { setEditMode(value => !value); setStartMode(false) }}><MousePointer2 size={16} />{editMode ? 'Done' : 'Edit route'}</button><button onClick={() => setShowSketch(value => !value)}><PencilLine size={16} />{showSketch ? 'Hide sketch' : 'Show sketch'}</button><button className={offlineSaved ? 'saved-offline' : 'primary'} onClick={() => setOfflineSaved(true)}>{offlineSaved ? <Check size={16} /> : <Download size={16} />}{offlineSaved ? 'Available offline' : 'Save offline'}</button><button className="trash" onClick={clearRoute} aria-label="Clear route"><Trash2 size={17} /></button></div></section>
    </section>
  </main>
}

export default App
