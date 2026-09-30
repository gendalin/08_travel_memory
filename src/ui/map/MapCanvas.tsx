/**
 * Map (UI draft 01) — real tiles behind the maps adapter boundary.
 *
 * Google's Maps JavaScript API is not enabled on this project's key (it is
 * restricted to Places), so the renderer is Leaflet over CARTO's raster
 * basemap: keyless, DOM-based — no WebGL context to lose — and small enough to
 * bundle into the single-file prototype. Coordinates are the real ones from
 * the catalogue, projected by the map rather than by us, so a pin sits on its
 * actual street.
 *
 * The interaction grammar is unchanged: tap a pin to open the POI sheet, the
 * selected pin is emphasised, a focused day draws its route. Swapping the
 * renderer again is a change of this file only.
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { DemoPlace } from '../../services/places/types.ts'

export interface MapMarker {
  place: DemoPlace
  dayIndex: number
  label: string
}

/** Alternatives currently on offer, numbered to match the cards (draft 09). */
export interface AlternativeMarker {
  place: DemoPlace
  index: number
}

interface Props {
  markers: MapMarker[]
  lodging?: DemoPlace
  selectedPlaceId: string | null
  /** When set, only this day's stops are drawn and routed (draft 07). */
  focusDayIndex?: number
  /** When present, planned pins recede and these take the foreground. */
  alternatives?: AlternativeMarker[]
  /** Height of whatever is resting over the bottom of the map, in px. */
  bottomInset?: number
  onSelect: (placeId: string) => void
  onSelectAlternative?: (placeId: string) => void
}

/**
 * The map is full-bleed and the chrome floats on top of it, so framing has to
 * keep pins out of the bands those controls occupy — a pin under the Plan /
 * State control is a pin you cannot tap.
 */
const INSET = { top: 104, bottom: 108, side: 40 }

/**
 * Framing has to survive a genuine outlier: Enoura Observatory is ~80 km from
 * Tokyo, and naive min/max bounds zoom the whole trip out to prefecture scale.
 * So the all-days view is framed on the dense cluster (a robust percentile
 * spread around the median); a far-flung pin simply sits outside the opening
 * viewport, still on the map and still reachable by panning.
 */
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return sorted[index]
}

function frame(values: number[]): { center: number; half: number } {
  const median = percentile(values, 0.5)
  const spread = percentile(values.map((value) => Math.abs(value - median)), 0.9)
  return { center: median, half: Math.max(spread * 1.35, 0.012) }
}

function robustBounds(points: DemoPlace[]): L.LatLngBounds {
  const lat = frame(points.map((point) => point.lat))
  const lng = frame(points.map((point) => point.lng))
  return L.latLngBounds(
    [lat.center - lat.half, lng.center - lng.half],
    [lat.center + lat.half, lng.center + lng.half],
  )
}

/** One pin grammar: red disc, white ring, white numeral (spec §5.2). */
function poiIcon(label: string, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: `poi-pin${selected ? ' is-selected' : ''}`,
    html: `<span class="poi-dot">${label}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

function lodgingIcon(name: string): L.DivIcon {
  return L.divIcon({
    className: 'lodging-pin',
    html: `<span class="lodging-dot"></span><span class="lodging-label">${name}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

export function MapCanvas({
  markers, lodging, selectedPlaceId, focusDayIndex, alternatives = [], bottomInset = 0,
  onSelect, onSelectAlternative,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const shown =
    focusDayIndex === undefined
      ? markers
      : markers.filter((marker) => marker.dayIndex === focusDayIndex)

  /**
   * Latest props, read by effects that must not re-run on identity alone: the
   * arrays are rebuilt every render, and refitting the map on every render
   * would fight the user's own panning.
   */
  const latest = useRef({ markers, shown, lodging, alternatives, onSelect, onSelectAlternative })
  latest.current = { markers, shown, lodging, alternatives, onSelect, onSelectAlternative }

  // --- the map itself: created once, torn down on unmount -------------------
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const map = L.map(host, {
      zoomControl: false,
      attributionControl: true,
      // The chrome owns the corners; pinch, drag and wheel are the controls.
      zoomSnap: 0.25,
      maxZoom: 19,
    }).setView([35.706, 139.79], 12)

    // Esri's light canvas: keyless and unstamped (CARTO now watermarks keyless
    // use, and OSM's own tiles refuse an app that is not theirs). Grey streets
    // under bilingual ward labels also leave the red of a pin to itself.
    const esri = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas'
    L.tileLayer(`${esri}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      maxNativeZoom: 16,
      maxZoom: 19,
      attribution: '© Esri · © OpenStreetMap contributors',
    }).addTo(map)
    L.tileLayer(`${esri}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
      maxNativeZoom: 16,
      maxZoom: 19,
      pane: 'overlayPane',
    }).addTo(map)

    map.attributionControl.setPrefix('')

    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)

    // The map is laid out by flexbox and covered by sheets; Leaflet has to be
    // told when its box changes or it renders half a world of grey.
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    observer.observe(host)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // --- pins and route: redrawn whenever what is on offer changes ------------
  const shownKey = shown.map((marker) => `${marker.label}:${marker.place.placeId}`).join(',')
  const markersKey = markers.map((marker) => marker.place.placeId).join(',')
  const alternativesKey = alternatives.map((option) => option.place.placeId).join(',')
  const lodgingKey = lodging?.placeId ?? ''

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    const { shown, lodging, alternatives } = latest.current
    layer.clearLayers()
    const showingAlternatives = alternatives.length > 0

    /**
     * Gives a pin its accessible identity; Leaflet only styles the box.
     *
     * `data-place-id` mirrors the itinerary rows, so a pin stays addressable by
     * the id it carries rather than by a display name the Places API may change
     * under us.
     */
    const dress = (marker: L.Marker, label: string, testId?: string, placeId?: string) => {
      const element = marker.getElement()
      if (!element) return
      element.setAttribute('role', 'button')
      element.setAttribute('aria-label', label)
      if (testId) element.setAttribute('data-testid', testId)
      if (placeId) element.setAttribute('data-place-id', placeId)
    }

    // Route: lodging -> that day's stops, in order -> lodging. Drawn only for a
    // focused day — one line through every stop of a five-day trip is a
    // scribble, not a route (drafts 01 vs 07).
    if (lodging && shown.length > 0 && focusDayIndex !== undefined) {
      L.polyline(
        [
          [lodging.lat, lodging.lng],
          ...shown.map((marker) => [marker.place.lat, marker.place.lng] as [number, number]),
          [lodging.lat, lodging.lng],
        ],
        {
          color: showingAlternatives ? '#c7c9c1' : '#6f6a60',
          weight: 2.5,
          opacity: 0.9,
          dashArray: '1 7',
          lineCap: 'round',
        },
      ).addTo(layer)
    }

    if (lodging) {
      const pin = L.marker([lodging.lat, lodging.lng], {
        icon: lodgingIcon(lodging.name),
        keyboard: false,
        interactive: false,
        zIndexOffset: -200,
      }).addTo(layer)
      dress(pin, `Base: ${lodging.name}`)
    }

    for (const marker of shown) {
      const selected = marker.place.placeId === selectedPlaceId
      const pin = L.marker([marker.place.lat, marker.place.lng], {
        icon: poiIcon(marker.label, selected),
        // While alternatives are showing, the plan is context, not the subject.
        opacity: showingAlternatives ? 0.35 : 1,
        zIndexOffset: selected ? 600 : 0,
      })
        .addTo(layer)
        .on('click', () => latest.current.onSelect(marker.place.placeId))
      dress(pin, marker.place.name, undefined, marker.place.placeId)
    }

    // Alternatives on top, numbered to match the cards in the sheet.
    for (const option of alternatives) {
      const pin = L.marker([option.place.lat, option.place.lng], {
        icon: L.divIcon({
          className: 'poi-pin is-alternative',
          html: `<span class="poi-dot">${option.index}</span><span class="poi-caption">${option.place.name}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
        zIndexOffset: 900,
      })
        .addTo(layer)
        .on('click', () => latest.current.onSelectAlternative?.(option.place.placeId))
      dress(pin, `Option ${option.index}: ${option.place.name}`, 'alternative-pin')
    }
  }, [shownKey, alternativesKey, selectedPlaceId, lodgingKey, focusDayIndex])

  // --- framing: on the set of pins, never on selection ----------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const { markers, shown, lodging, alternatives } = latest.current
    const focused = focusDayIndex !== undefined
    const points = [
      ...(focused ? shown.map((marker) => marker.place) : markers.map((marker) => marker.place)),
      ...alternatives.map((option) => option.place),
      ...(lodging ? [lodging] : []),
    ]
    if (points.length === 0) return

    // A focused day is a handful of stops: frame them exactly. The whole trip
    // is framed on its cluster, so one outlier cannot flatten the rest.
    const bounds =
      focused || alternatives.length > 0
        ? L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]))
        : robustBounds(points)

    // A sheet resting over the map narrows the frame; past a point there is no
    // frame left to fit anything into, so the camera keeps roughly half the
    // screen to work with however far the sheet is pulled up.
    const bottom = Math.min(INSET.bottom + bottomInset, map.getSize().y * 0.55)

    map.fitBounds(bounds, {
      paddingTopLeft: [INSET.side, INSET.top],
      paddingBottomRight: [INSET.side, bottom],
      maxZoom: 16,
      animate: true,
      duration: 0.4,
    })
  }, [shownKey, markersKey, alternativesKey, focusDayIndex, bottomInset, lodgingKey])

  // Selecting a stop in the itinerary must not leave its pin off screen.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedPlaceId) return
    const selected = latest.current.shown.find((marker) => marker.place.placeId === selectedPlaceId)
    if (!selected) return
    const point = L.latLng(selected.place.lat, selected.place.lng)
    if (!map.getBounds().pad(-0.12).contains(point)) map.panTo(point, { animate: true })
  }, [selectedPlaceId, shownKey])

  return (
    <div className="map-wrap" role="img" aria-label="Trip map">
      <div className="map-canvas" ref={hostRef} />
    </div>
  )
}
