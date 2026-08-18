import { ChangeEvent, PointerEvent, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronDown, Download, Footprints, Layers, LocateFixed, MapPin,
  MousePointer2, Navigation, PencilLine, Plus, Route, RotateCcw, Trash2, WandSparkles, X,
} from 'lucide-react'

type Point = { x: number; y: number }
type Surface = 'Асфальт' | 'Стежки'

const generatedRoute: Point[] = [
  { x: 48, y: 58 }, { x: 43, y: 53 }, { x: 35, y: 52 }, { x: 28, y: 46 }, { x: 26, y: 37 },
  { x: 32, y: 27 }, { x: 43, y: 22 }, { x: 54, y: 25 }, { x: 62, y: 31 }, { x: 69, y: 39 },
  { x: 72, y: 49 }, { x: 67, y: 59 }, { x: 58, y: 65 }, { x: 48, y: 58 },
]
const sketchRoute: Point[] = [
  { x: 48, y: 58 }, { x: 42, y: 50 }, { x: 31, y: 49 }, { x: 27, y: 40 }, { x: 35, y: 26 },
  { x: 51, y: 21 }, { x: 67, y: 34 }, { x: 73, y: 49 }, { x: 63, y: 63 }, { x: 48, y: 58 },
]
const routePath = (points: Point[]) => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
const km = (value: number) => value.toLocaleString('uk-UA', { maximumFractionDigits: 1 })

function App() {
  const [minDistance, setMinDistance] = useState(4.5)
  const [maxDistance, setMaxDistance] = useState(6)
  const [surface, setSurface] = useState<Surface>('Асфальт')
  const [safeRoads, setSafeRoads] = useState(true)
  const [route, setRoute] = useState(generatedRoute)
  const [start, setStart] = useState<Point>({ x: 48, y: 58 })
  const [startMode, setStartMode] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [showSketch, setShowSketch] = useState(true)
  const [status, setStatus] = useState<'ready' | 'building' | 'failed'>('ready')
  const [offlineSaved, setOfflineSaved] = useState(false)
  const [notice, setNotice] = useState('')
  const mapRef = useRef<HTMLDivElement>(null)
  const estimate = useMemo(() => Math.max(minDistance, Math.min(maxDistance, 5.2)), [minDistance, maxDistance])
  const mapPoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = mapRef.current!.getBoundingClientRect()
    return { x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100 }
  }
  const placeOnMap = (event: PointerEvent<HTMLDivElement>) => {
    if (!mapRef.current) return
    const point = mapPoint(event)
    if (startMode) {
      setStart(point)
      setRoute(generatedRoute.map((routePoint, index) => index === 0 || index === generatedRoute.length - 1 ? point : routePoint))
      setStartMode(false)
      setNotice('Старт прив’язано до найближчої прохідної точки (142 м).')
    } else if (editMode) {
      setRoute(current => [...current.slice(0, -1), point, current[0]])
      setNotice('Контрольну точку додано — маршрут пройде через цю вулицю.')
    }
  }
  const buildRoute = () => {
    if (maxDistance <= minDistance || maxDistance - minDistance < .4 || (surface === 'Стежки' && safeRoads && minDistance > 7)) {
      setStatus('failed')
      return
    }
    setStatus('building')
    window.setTimeout(() => {
      setRoute(generatedRoute.map((point, index) => index === 0 || index === generatedRoute.length - 1 ? start : point))
      setStatus('ready')
      setNotice('Знайдено круговий маршрут, близький до ескізу.')
    }, 700)
  }
  const uploadSketch = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.[0]) return
    setShowSketch(true)
    setNotice('Ескіз додано. Він накладений на мапу як орієнтир форми.')
  }
  const updateDistance = (value: string, update: (distance: number) => void) => {
    const distance = Number(value)
    if (Number.isFinite(distance) && distance >= 1) update(distance)
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="#workspace"><span className="wordmark-mark"><Route size={18} /></span>track<span>imagination</span></a>
      <div className="mode-label"><Footprints size={15} /> Біг <ChevronDown size={14} /></div>
      <div className="topbar-actions"><button className="icon-button" aria-label="Мій старт" onClick={() => setStartMode(true)}><LocateFixed size={18} /></button><button className="profile">ІК</button></div>
    </header>
    <section className="workspace" id="workspace">
      <div className="map" ref={mapRef} onPointerDown={placeOnMap}>
        <div className="map-grid" /><div className="park park-one" /><div className="park park-two" /><div className="water" />
        <div className="road road-1" /><div className="road road-2" /><div className="road road-3" /><div className="road road-4" /><div className="road minor-road road-5" /><div className="road minor-road road-6" />
        <span className="district district-one">СОСНОВИЙ БІР</span><span className="district district-two">ПОДІЛ</span><span className="district district-three">ОЗЕРНИЙ ПАРК</span><span className="street street-one">вул. Набережна</span><span className="street street-two">просп. Свободи</span><span className="street street-three">вул. Липова</span>
        <svg className="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Згенерований маршрут">{showSketch && <path d={routePath(sketchRoute)} className="sketch-line" />}<path d={routePath(route)} className="route-outline" /><path d={routePath(route)} className="route-line" /></svg>
        {showSketch && <span className="sketch-label"><PencilLine size={13} /> Ескіз</span>}
        <span className="start-pin" style={{ left: `${start.x}%`, top: `${start.y}%` }}><MapPin size={20} fill="currentColor" /><b>Старт</b></span>
        {route.slice(1, -1).map((point, index) => <span key={`${point.x}-${point.y}-${index}`} className={`route-node ${editMode ? 'visible' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
        {startMode && <div className="map-instruction"><LocateFixed size={16} /> Клікніть на мапі, щоб задати старт</div>}{editMode && <div className="map-instruction"><Plus size={16} /> Клікніть на потрібній вулиці, щоб додати точку</div>}
        <div className="map-attribution">© OpenStreetMap contributors</div><div className="map-tools"><button className="active" aria-label="Стиль мапи"><Layers size={18} /></button><button aria-label="Центрувати мапу" onClick={() => setStartMode(true)}><LocateFixed size={18} /></button></div>
      </div>
      <aside className="inspector">
        <div className="inspector-head"><div><p className="eyebrow">НОВИЙ МАРШРУТ</p><h1>Намалюйте пробіжку</h1></div><button className="close-button" aria-label="Закрити"><X size={18} /></button></div><p className="intro">Ескіз задає форму; маршрут прокладається лише прохідними дорогами й стежками.</p>
        <div className="sketch-row"><div className="sketch-mini"><svg viewBox="0 0 100 100"><path d={routePath(sketchRoute)} /></svg></div><div><strong>Форма маршруту</strong><small>{showSketch ? 'Накладено на мапу' : 'Не показано'}</small></div><label className="file-action"><Plus size={15} /><input aria-label="Додати ескіз" type="file" accept="image/*" onChange={uploadSketch} /></label></div>
        <section className="control-section"><div className="section-label"><span>Дистанція</span><span className="muted">км</span></div><div className="distance-inputs"><label>Від<input type="number" min="1" step="0.5" value={minDistance} onChange={event => updateDistance(event.target.value, setMinDistance)} /></label><span>—</span><label>До<input type="number" min="1" step="0.5" value={maxDistance} onChange={event => updateDistance(event.target.value, setMaxDistance)} /></label></div></section>
        <section className="control-section"><div className="section-label"><span>Покриття</span></div><div className="segmented"><button className={surface === 'Асфальт' ? 'selected' : ''} onClick={() => setSurface('Асфальт')}>Асфальт</button><button className={surface === 'Стежки' ? 'selected' : ''} onClick={() => setSurface('Стежки')}>Стежки</button></div></section>
        <section className="switch-row"><div><strong>Уникати небажаних доріг</strong><small>Зменшити ділянки з інтенсивним рухом</small></div><button className={`switch ${safeRoads ? 'on' : ''}`} onClick={() => setSafeRoads(value => !value)} aria-label="Уникати небажаних доріг"><i /></button></section>
        <button className="build-button" onClick={buildRoute} disabled={status === 'building'}><WandSparkles size={17} />{status === 'building' ? 'Шукаємо шляхи…' : 'Побудувати маршрут'}</button>{notice && <div className="notice"><Check size={15} />{notice}<button aria-label="Приховати повідомлення" onClick={() => setNotice('')}><X size={13} /></button></div>}
        {status === 'failed' && <div className="failure"><div className="failure-icon"><Route size={19} /></div><div><strong>Маршрут не знайдено</strong><p>У цьому діапазоні та з обраними умовами немає прийнятного кола.</p></div><button onClick={() => { setMaxDistance(Math.max(maxDistance, minDistance + 1.5)); setSafeRoads(false); setStatus('ready') }}><RotateCcw size={14} /> Розширити діапазон і вимкнути уникнення</button><button className="link-button" onClick={() => { setSurface(surface === 'Асфальт' ? 'Стежки' : 'Асфальт'); setStatus('ready') }}>Спробувати інше покриття</button></div>}
      </aside>
      <section className="route-drawer"><div className="drawer-route"><span className="route-dot"><Navigation size={16} fill="currentColor" /></span><div><p>КРУГОВИЙ МАРШРУТ</p><strong>{km(estimate)} км</strong><span> · приблизно {Math.round(estimate * 6.2)} хв</span></div></div><div className="drawer-actions"><button className={editMode ? 'active' : ''} onClick={() => setEditMode(value => !value)}><MousePointer2 size={16} />{editMode ? 'Готово' : 'Змінити маршрут'}</button><button onClick={() => setShowSketch(value => !value)}><PencilLine size={16} />{showSketch ? 'Сховати ескіз' : 'Показати ескіз'}</button><button className={offlineSaved ? 'saved-offline' : 'primary'} onClick={() => setOfflineSaved(true)}>{offlineSaved ? <Check size={16} /> : <Download size={16} />}{offlineSaved ? 'Доступно офлайн' : 'Зберегти офлайн'}</button><button className="trash" onClick={() => { setRoute([]); setNotice('Маршрут очищено.') }} aria-label="Очистити маршрут"><Trash2 size={17} /></button></div></section>
    </section>
  </main>
}
export default App
