"use client";

import React from "react";
import { NavigationArrow, MapPin, ArrowClockwise, Warning, CheckCircle, MagnifyingGlass, Crosshair } from "@phosphor-icons/react";
import type { Locale } from "@dialog/config";
import { loadMapbox } from "./ChatMap";

/**
 * In-chat location picker (a ```locate block) — Round-2 feedback FB-1432: the
 * web and app journeys let the customer pin their company/delivery address on a
 * map; the agentic journey now does too. Tapping the CTA asks for the browser
 * location, shows a Mapbox map with a draggable pin, reverse-geocodes the pin,
 * and on confirm sends the address + coordinates as the customer's reply. With
 * no Mapbox token or no geolocation it degrades to sharing raw coordinates, and
 * typing the address in chat always remains possible.
 *
 * FB-1567 (EPGL) asked for the applicant's physical address to be pinned on
 * Google Maps. The picker itself stays Mapbox (one map library, one token), but
 * the confirmed pin now carries a google.com/maps link so whoever reviews the
 * application opens it in Google Maps. Its own chrome is localized, since the
 * EPGL journeys run in Arabic as well as English (FB-1445).
 */
const FALLBACK_CENTER = { lat: 25.2048, lng: 55.2708 }; // Dubai

const LOC_STR = {
  en: {
    cta: "Pin the location on a map",
    locating: "Getting your location…",
    unavailable: "Location isn't available here — just type the address instead.",
    shared: "Location shared",
    adjust: "Drag the pin or tap the map to adjust",
    use: "Use this location",
    prefix: "Location",
    search: "Search for a building, street or area",
    denied: "We could not get your location — search or drag the pin to your address.",
    locateMe: "Use my current location",
    noResults: "Nothing found. Try a building, street or area name.",
  },
  ar: {
    cta: "حدّد الموقع على الخريطة",
    locating: "جارٍ تحديد موقعك…",
    unavailable: "تحديد الموقع غير متاح هنا — يمكنك كتابة العنوان بدلاً من ذلك.",
    shared: "تم مشاركة الموقع",
    adjust: "اسحب المؤشر أو اضغط على الخريطة لضبط الموقع",
    use: "استخدام هذا الموقع",
    prefix: "الموقع",
    search: "ابحث عن مبنى أو شارع أو منطقة",
    denied: "تعذّر تحديد موقعك — ابحث أو اسحب المؤشر إلى عنوانك.",
    locateMe: "استخدام موقعي الحالي",
    noResults: "لا توجد نتائج. جرّب اسم مبنى أو شارع أو منطقة.",
  },
} as const;

export function ChatLocate({
  label, locale = "en", onSelect,
}: {
  label?: string;
  locale?: Locale;
  onSelect: (text: string) => void;
}) {
  const s = LOC_STR[locale === "ar" ? "ar" : "en"];
  const [phase, setPhase] = React.useState<"idle" | "loading" | "ready" | "sent" | "error">("idle");
  const [address, setAddress] = React.useState<string>("");
  const mapEl = React.useRef<HTMLDivElement | null>(null);
  const mapboxRef = React.useRef<any>(null);
  const tokenRef = React.useRef<string>("");
  const posRef = React.useRef<{ lat: number; lng: number }>(FALLBACK_CENTER);
  const markerRef = React.useRef<any>(null);
  const mapRef = React.useRef<any>(null);
  // Whether the browser actually gave us a position. Without this the map opens
  // on Dubai's centre and looks like an answer rather than a starting guess.
  const [located, setLocated] = React.useState(true);
  /** The pin has been placed deliberately — located, searched, dragged or tapped. */
  const [placed, setPlaced] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // A suggestion has no coordinates until it is retrieved, so it carries an id.
  const [results, setResults] = React.useState<{ name: string; id?: string; lat?: number; lng?: number }[] | null>(null);
  // One search session per picker, which is how Mapbox groups and bills these.
  const sessionRef = React.useRef<string>("");
  const [searching, setSearching] = React.useState(false);

  const reverseGeocode = React.useCallback(async (p: { lat: number; lng: number }) => {
    if (!tokenRef.current) return;
    try {
      const r = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${p.lng},${p.lat}.json?access_token=${encodeURIComponent(tokenRef.current)}&limit=1&language=${locale === "ar" ? "ar" : "en"}`
      );
      const j = (await r.json()) as { features?: { place_name?: string }[] };
      setAddress(j.features?.[0]?.place_name ?? "");
    } catch {
      /* address stays empty — coordinates still work */
    }
  }, [locale]);

  /** Put the pin somewhere and tell the map about it. */
  const moveTo = React.useCallback((p: { lat: number; lng: number }, zoom?: number) => {
    posRef.current = p;
    setPlaced(true);
    try { markerRef.current?.setLngLat([p.lng, p.lat]); } catch { /* map not up yet */ }
    try { mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: zoom ?? 16, duration: 700 }); } catch { /* ignore */ }
    void reverseGeocode(p);
  }, [reverseGeocode]);

  /**
   * Search, so the customer is not left dragging across the city.
   *
   * Restricted to the UAE and biased towards wherever the pin already is. What
   * this finds only moves the map — the address that counts is still whatever
   * Emirates Post reads back from the final coordinates.
   */
  const runSearch = React.useCallback(async (q: string) => {
    const token = tokenRef.current;
    if (!token || q.trim().length < 3) { setResults(null); return; }
    if (!sessionRef.current) {
      sessionRef.current = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    }
    setSearching(true);
    const { lat, lng } = posRef.current;
    const lang = locale === "ar" ? "ar" : "en";
    try {
      // Search Box, not the older /geocoding/v5 places index: v5 has no entry for
      // "Sobha Hartland" or most of Dubai's communities, so a customer searching
      // for the name on their own building was told nothing was found.
      const r = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}` +
          `&access_token=${encodeURIComponent(token)}&session_token=${encodeURIComponent(sessionRef.current)}` +
          `&country=ae&limit=5&proximity=${lng},${lat}&language=${lang}`
      );
      const j = (await r.json()) as {
        suggestions?: { name?: string; place_formatted?: string; full_address?: string; mapbox_id?: string }[];
      };
      const list = (j.suggestions ?? [])
        .filter((f) => f.mapbox_id)
        .map((f) => ({
          name: [f.name, f.full_address ?? f.place_formatted].filter(Boolean).join(" — "),
          id: f.mapbox_id!,
        }));
      if (list.length) { setResults(list); return; }
      // Streets and plain area names still answer better on the old index, so it
      // stays as the fallback rather than the first choice.
      const r2 = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?access_token=${encodeURIComponent(token)}&country=ae&limit=5&proximity=${lng},${lat}&language=${lang}`
      );
      const j2 = (await r2.json()) as { features?: { place_name?: string; center?: [number, number] }[] };
      setResults(
        (j2.features ?? [])
          .filter((f) => Array.isArray(f.center))
          .map((f) => ({ name: f.place_name ?? "", lat: f.center![1], lng: f.center![0] }))
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [locale]);

  /** A suggestion becomes a point only when asked for; that is the second call. */
  const choose = React.useCallback(async (r: { name: string; id?: string; lat?: number; lng?: number }) => {
    setResults(null);
    setQuery("");
    if (typeof r.lat === "number" && typeof r.lng === "number") { moveTo({ lat: r.lat, lng: r.lng }); return; }
    if (!r.id || !tokenRef.current) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(r.id)}` +
          `?access_token=${encodeURIComponent(tokenRef.current)}&session_token=${encodeURIComponent(sessionRef.current)}`
      );
      const j = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] } }[] };
      const c = j.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(c)) moveTo({ lat: c[1], lng: c[0] });
    } catch {
      /* the pin stays where it is; they can drag it */
    } finally {
      setSearching(false);
    }
  }, [moveTo]);

  // Typing searches, but not on every keystroke.
  React.useEffect(() => {
    if (phase !== "ready") return;
    if (query.trim().length < 3) { setResults(null); return; }
    const t = setTimeout(() => void runSearch(query), 350);
    return () => clearTimeout(t);
  }, [query, phase, runSearch]);

  /** Ask the browser again — a customer who said no can change their mind. */
  const locateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocated(true);
        moveTo({ lat: p.coords.latitude, lng: p.coords.longitude }, 16);
      },
      () => setLocated(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  const begin = async () => {
    if (phase !== "idle") return;
    setPhase("loading");
    const tokenP = fetch("/api/mapbox-token")
      .then((r) => r.json())
      .then((j: { token?: string }) => j.token ?? "")
      .catch(() => "");
    const geoP = new Promise<{ lat: number; lng: number } | null>((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
    const [token, loc] = await Promise.all([tokenP, geoP]);
    tokenRef.current = token;
    posRef.current = loc ?? FALLBACK_CENTER;
    setLocated(Boolean(loc));
    if (token) {
      try {
        const mapboxgl = await loadMapbox();
        mapboxgl.accessToken = token;
        mapboxRef.current = mapboxgl;
      } catch {
        mapboxRef.current = null;
      }
    }
    if (!mapboxRef.current && !loc) {
      setPhase("error");
      return;
    }
    // With no position of their own the map opens on Dubai's centre. Reading that
    // back as an address would put "Financial Center Street" in front of someone
    // who lives in Ajman and looks like an answer, so it stays blank until they
    // put the pin somewhere themselves.
    if (loc) {
      setPlaced(true);
      void reverseGeocode(posRef.current);
    }
    setPhase("ready");
  };

  // Mount the map once the container exists.
  React.useEffect(() => {
    if (phase !== "ready" || !mapEl.current || !mapboxRef.current) return;
    const mapboxgl = mapboxRef.current;
    let map: any;
    try {
      map = new mapboxgl.Map({
        container: mapEl.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [posRef.current.lng, posRef.current.lat],
        zoom: 14,
        attributionControl: false,
      });
    } catch {
      return;
    }
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const marker = new mapboxgl.Marker({ color: "#3d33d1", draggable: true })
      .setLngLat([posRef.current.lng, posRef.current.lat])
      .addTo(map);
    markerRef.current = marker;
    marker.on("dragend", () => {
      const p = marker.getLngLat();
      posRef.current = { lat: p.lat, lng: p.lng };
      setPlaced(true);
      void reverseGeocode(posRef.current);
    });
    map.on("click", (e: any) => {
      marker.setLngLat(e.lngLat);
      posRef.current = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      setPlaced(true);
      void reverseGeocode(posRef.current);
    });
    return () => {
      mapRef.current = null;
      try { map.remove(); } catch { /* ignore */ }
    };
  }, [phase, reverseGeocode]);

  const confirm = () => {
    const { lat, lng } = posRef.current;
    const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    // The Google Maps link goes with the reply so the pin is openable by whoever
    // reviews the application, not just as bare coordinates (FB-1567).
    const mapsUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    onSelect(
      address
        ? `${s.prefix}: ${address} (${coords}) ${mapsUrl}`
        : `${s.prefix}: ${coords} ${mapsUrl}`
    );
    setPhase("sent");
  };

  if (phase === "idle") {
    return (
      <div className="dlg-map">
        <button type="button" className="dlg-map-cta" onClick={begin}>
          <NavigationArrow size={16} weight="fill" />
          {label || s.cta}
        </button>
      </div>
    );
  }
  if (phase === "loading") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status">
          <ArrowClockwise size={15} weight="bold" className="spin" />
          {s.locating}
        </div>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status is-error">
          <Warning size={15} weight="fill" />
          {s.unavailable}
        </div>
      </div>
    );
  }
  if (phase === "sent") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status">
          <CheckCircle size={15} weight="fill" />
          {s.shared}{address ? `: ${address}` : ""}
        </div>
      </div>
    );
  }
  return (
    <div className="dlg-map is-ready">
      <div className="dlg-locate-search">
        <span className="dlg-locate-searchicon"><MagnifyingGlass size={15} weight="bold" /></span>
        <input
          className="dlg-locate-input"
          type="text"
          value={query}
          placeholder={s.search}
          aria-label={s.search}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runSearch(query); } }}
        />
        {searching ? <ArrowClockwise size={14} weight="bold" className="spin" /> : null}
        <button type="button" className="dlg-locate-me" onClick={locateMe} aria-label={s.locateMe} title={s.locateMe}>
          <Crosshair size={16} weight="bold" />
        </button>
      </div>
      {results ? (
        <div className="dlg-locate-results">
          {results.length ? (
            results.map((r, i) => (
              <button
                key={i}
                type="button"
                className="dlg-locate-result"
                onClick={() => void choose(r)}
              >
                <MapPin size={14} weight="fill" />
                <span>{r.name}</span>
              </button>
            ))
          ) : (
            <div className="dlg-locate-result is-empty">{s.noResults}</div>
          )}
        </div>
      ) : null}
      {mapboxRef.current ? <div ref={mapEl} className="dlg-map-canvas locate" /> : null}
      {!located && !placed ? <div className="dlg-locate-hint">{s.denied}</div> : null}
      <div className="dlg-locate-row">
        <span className="dlg-map-pinicon"><MapPin size={15} weight="fill" /></span>
        <span className="dlg-locate-addr">{address || s.adjust}</span>
        <button type="button" className="dlg-locate-confirm" onClick={confirm} disabled={!placed}>
          {s.use}
        </button>
      </div>
    </div>
  );
}
