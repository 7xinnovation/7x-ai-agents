"use client";

import React from "react";
import { NavigationArrow, MapPin, ArrowClockwise, Warning } from "@phosphor-icons/react";

/**
 * In-chat "Browse nearby branches" map (a ```map block naming emirate + bundle).
 * Mapbox GL is lazy-loaded from the CDN only when the customer taps Browse, so it
 * never weighs down the embed for anyone who doesn't use it. It fetches the real
 * branch coordinates from /api/nxn/branches, asks for the customer's location,
 * shows pins on a map plus a distance-sorted list, and taps-to-select a branch
 * (the name is sent as the reply). Location denied or map unavailable → it still
 * shows the branches as a plain distance-agnostic list.
 */

const MAPBOX_VERSION = "v3.9.1";
const MAPBOX_JS = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
const MAPBOX_CSS = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css`;

interface Branch {
  id: string;
  name: string;
  nameAr?: string;
  lat: number;
  lng: number;
  hours?: string;
  days?: string;
  dist?: number;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let mapboxLoader: Promise<any> | null = null;
export function loadMapbox(): Promise<any> {
  const w = window as unknown as { mapboxgl?: unknown };
  if (w.mapboxgl) return Promise.resolve(w.mapboxgl);
  if (mapboxLoader) return mapboxLoader;
  mapboxLoader = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[data-dlg-mapbox]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPBOX_CSS;
      link.setAttribute("data-dlg-mapbox", "1");
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = MAPBOX_JS;
    script.async = true;
    script.onload = () => (w.mapboxgl ? resolve(w.mapboxgl) : reject(new Error("mapbox unavailable")));
    script.onerror = () => { mapboxLoader = null; reject(new Error("mapbox failed to load")); };
    document.head.appendChild(script);
  });
  return mapboxLoader;
}

export function ChatMap({
  emirate, bundle, onSelect,
}: {
  emirate: string;
  bundle: string;
  onSelect: (text: string) => void;
}) {
  // The embed always lives at /embed/<slug>; derive it rather than thread a prop.
  const agentSlug = React.useMemo(
    () => (typeof window !== "undefined" ? window.location.pathname.match(/\/embed\/([^/?#]+)/)?.[1] : "") || "nxn-dialog",
    []
  );
  const [phase, setPhase] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [branches, setBranches] = React.useState<Branch[]>([]);
  const [userLoc, setUserLoc] = React.useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const mapEl = React.useRef<HTMLDivElement | null>(null);
  const mapObj = React.useRef<any>(null);
  const mapboxRef = React.useRef<any>(null);

  const select = React.useCallback((b: Branch) => {
    if (selected) return;
    setSelected(b.id);
    onSelect(b.name);
  }, [selected, onSelect]);

  const browse = async () => {
    if (phase !== "idle") return;
    setPhase("loading");
    const branchesP = fetch(
      `/api/nxn/branches?agentSlug=${encodeURIComponent(agentSlug)}&emirate=${encodeURIComponent(emirate)}&bundle=${encodeURIComponent(bundle)}`
    ).then((r) => r.json()).catch(() => ({ error: "network" }));
    const geoP = new Promise<{ lat: number; lng: number } | null>((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });
    const [data, loc] = await Promise.all([branchesP, geoP]);
    if (data?.error || !Array.isArray(data?.branches) || !data.branches.length) {
      setPhase("error");
      return;
    }
    let list: Branch[] = data.branches;
    if (loc) list = list.map((b) => ({ ...b, dist: haversineKm(loc, b) })).sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
    setBranches(list);
    setUserLoc(loc);
    if (data.mapboxToken) {
      try {
        const mapboxgl = await loadMapbox();
        mapboxgl.accessToken = data.mapboxToken;
        mapboxRef.current = mapboxgl;
      } catch {
        /* fall through to list-only */
      }
    }
    setPhase("ready");
  };

  // Initialise the map once the container is in the DOM (phase === "ready").
  React.useEffect(() => {
    if (phase !== "ready" || !mapEl.current || !mapboxRef.current || mapObj.current || !branches.length) return;
    const mapboxgl = mapboxRef.current;
    const center = userLoc ?? { lat: branches[0]!.lat, lng: branches[0]!.lng };
    let map: any;
    try {
      map = new mapboxgl.Map({
        container: mapEl.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [center.lng, center.lat],
        zoom: userLoc ? 11 : 10,
        attributionControl: false,
      });
    } catch {
      return;
    }
    mapObj.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const bounds = new mapboxgl.LngLatBounds();
    if (userLoc) {
      new mapboxgl.Marker({ color: "#3d33d1" })
        .setLngLat([userLoc.lng, userLoc.lat])
        .setPopup(new mapboxgl.Popup({ offset: 14, closeButton: false }).setText("You are here"))
        .addTo(map);
      bounds.extend([userLoc.lng, userLoc.lat]);
    }
    branches.slice(0, 15).forEach((b) => {
      const el = document.createElement("div");
      el.className = "dlg-map-pin";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", b.name);
      const marker = new mapboxgl.Marker(el)
        .setLngLat([b.lng, b.lat])
        .setPopup(new mapboxgl.Popup({ offset: 16, closeButton: false }).setText(b.name))
        .addTo(map);
      el.addEventListener("click", (e) => { e.stopPropagation(); marker.togglePopup(); select(b); });
      bounds.extend([b.lng, b.lat]);
    });
    if (!bounds.isEmpty()) {
      try { map.fitBounds(bounds, { padding: 44, maxZoom: 13, duration: 0 }); } catch { /* ignore */ }
    }
    return () => { try { map.remove(); } catch { /* ignore */ } mapObj.current = null; };
  }, [phase, branches, userLoc, select]);

  if (phase === "idle") {
    return (
      <div className="dlg-map">
        <button type="button" className="dlg-map-cta" onClick={browse}>
          <NavigationArrow size={16} weight="fill" />
          Browse nearby branches on a map
        </button>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status">
          <ArrowClockwise size={15} weight="bold" className="spin" />
          Finding branches near you…
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status is-error">
          <Warning size={15} weight="fill" />
          Couldn&apos;t load the map. You can still pick a branch from the list above.
        </div>
      </div>
    );
  }

  // ready
  const topN = branches.slice(0, 6);
  return (
    <div className="dlg-map is-ready">
      {mapboxRef.current ? <div ref={mapEl} className="dlg-map-canvas" /> : null}
      <div className="dlg-map-head">
        {userLoc ? "Nearest branches to you" : "Branches"}
      </div>
      <div className="dlg-map-list">
        {topN.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`dlg-map-row${selected === b.id ? " is-selected" : ""}`}
            onClick={() => select(b)}
            disabled={!!selected}
          >
            <span className="dlg-map-pinicon"><MapPin size={15} weight="fill" /></span>
            <span className="dlg-map-info">
              <span className="dlg-map-name">{b.name}</span>
              {b.hours ? <span className="dlg-map-hours">{b.hours}</span> : null}
            </span>
            {typeof b.dist === "number" ? <span className="dlg-map-dist">{b.dist < 1 ? `${Math.round(b.dist * 1000)} m` : `${b.dist.toFixed(1)} km`}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
