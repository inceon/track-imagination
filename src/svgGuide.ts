export type MapPoint = { x: number; y: number }

const distance = (first: MapPoint, second: MapPoint) => Math.hypot(first.x - second.x, first.y - second.y)

const fromPointList = (raw: string) => raw.trim().split(/[\s,]+/).map(Number).reduce<MapPoint[]>((points, value, index, values) => {
  if (index % 2 === 0 && Number.isFinite(value) && Number.isFinite(values[index + 1])) points.push({ x: value, y: values[index + 1] })
  return points
}, [])

const samplePath = (d: string) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  svg.style.cssText = 'position:fixed; visibility:hidden; width:0; height:0; overflow:hidden'
  svg.append(path)
  document.body.append(svg)
  try {
    const length = path.getTotalLength()
    const steps = Math.max(12, Math.min(180, Math.ceil(length / 8)))
    return Array.from({ length: steps + 1 }, (_, index) => {
      const point = path.getPointAtLength((index / steps) * length)
      return { x: point.x, y: point.y }
    })
  } finally {
    svg.remove()
  }
}

const normalise = (points: MapPoint[]) => {
  const minX = Math.min(...points.map(point => point.x))
  const maxX = Math.max(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  const maxY = Math.max(...points.map(point => point.y))
  const span = Math.max(maxX - minX, maxY - minY)
  if (!Number.isFinite(span) || span < 1) throw new Error('The SVG shape is too small to use as a route guide.')
  const scale = 70 / span
  const centreX = (minX + maxX) / 2
  const centreY = (minY + maxY) / 2
  const normalised = points.map(point => ({ x: 50 + (point.x - centreX) * scale, y: 50 + (point.y - centreY) * scale }))
  return distance(normalised[0], normalised.at(-1)!) < 3 ? normalised : [...normalised, normalised[0]]
}

export const parseSvgGuide = (source: string): MapPoint[] => {
  const documentNode = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (documentNode.querySelector('parsererror')) throw new Error('This file is not a valid SVG.')
  const candidates = Array.from(documentNode.querySelectorAll('path, polyline, polygon')).map(element => {
    if (element.tagName === 'path') return samplePath(element.getAttribute('d') ?? '')
    return fromPointList(element.getAttribute('points') ?? '')
  }).filter(points => points.length > 2)
  const outline = candidates.sort((first, second) => second.length - first.length)[0]
  if (!outline) throw new Error('No route outline was found. Add a path, polyline, or polygon to the SVG.')
  return normalise(outline)
}

export const pathFromMapPoints = (points: MapPoint[]) => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
