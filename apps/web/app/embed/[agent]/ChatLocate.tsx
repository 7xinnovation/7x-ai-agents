"use client";

import React from "react";
import { NavigationArrow, MapPin, ArrowClockwise, Warning, CheckCircle } from "@phosphor-icons/react";
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
  },
  ar: {
    cta: "حدّد الموقع على الخريطة",
    locating: "جارٍ تحديد موقعك…",
    unavailable: "تحديد الموقع غير متاح هنا — يمكنك كتابة العنوان بدلاً من ذلك.",
    shared: "تم مشاركة الموقع",
    adjust: "اسحب المؤشر أو اضغط على الخريطة لضبط الموقع",
    use: "استخدام هذا الموقع",
    prefix: "الموقع",
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
    void reverseGeocode(posRef.current);
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
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const marker = new mapboxgl.Marker({ color: "#3d33d1", draggable: true })
      .setLngLat([posRef.current.lng, posRef.current.lat])
      .addTo(map);
    markerRef.current = marker;
    marker.on("dragend", () => {
      const p = marker.getLngLat();
      posRef.current = { lat: p.lat, lng: p.lng };
      void reverseGeocode(posRef.current);
    });
    map.on("click", (e: any) => {
      marker.setLngLat(e.lngLat);
      posRef.current = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      void reverseGeocode(posRef.current);
    });
    return () => {
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
      {mapboxRef.current ? <div ref={mapEl} className="dlg-map-canvas locate" /> : null}
      <div className="dlg-locate-row">
        <span className="dlg-map-pinicon"><MapPin size={15} weight="fill" /></span>
        <span className="dlg-locate-addr">{address || s.adjust}</span>
        <button type="button" className="dlg-locate-confirm" onClick={confirm}>
          {s.use}
        </button>
      </div>
    </div>
  );
}
