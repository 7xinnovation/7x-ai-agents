"use client";

import React from "react";
import { NavigationArrow, MapPin, MagnifyingGlass, ArrowClockwise, Warning } from "@phosphor-icons/react";

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

/**
 * Every word this component says, in both languages.
 *
 * It had none: the button read "Browse nearby branches on a map" inside an
 * otherwise fully Arabic conversation, which is the one thing on that screen a
 * customer reading Arabic could not read.
 */
export const MAP_STR = {
  en: {
    browse: "Browse nearby branches on a map",
    finding: "Finding branches near you…",
    failed: "Couldn't load the map. You can still pick a branch from the list above.",
    nearest: "Nearest branches to you",
    branches: "Branches",
    inEmirate: (e: string) => `Branches in ${e}`,
    searchArea: "Search by area or branch name",
    noMatch: "No branch matches that. Try another area.",
    showingAll: (n: number) => `${n} branches`,
    metres: (n: number) => `${n} m`,
    km: (n: string) => `${n} km`,
    youAreHere: "You are here",
  },
  ar: {
    browse: "تصفّح الفروع القريبة على الخريطة",
    finding: "جارٍ البحث عن الفروع القريبة منك…",
    failed: "تعذّر تحميل الخريطة. لا يزال بإمكانك اختيار فرع من القائمة أعلاه.",
    nearest: "أقرب الفروع إليك",
    branches: "الفروع",
    inEmirate: (e: string) => `الفروع في ${e}`,
    searchArea: "ابحث بالمنطقة أو باسم الفرع",
    noMatch: "لا يوجد فرع مطابق. جرّب منطقة أخرى.",
    showingAll: (n: number) => `${n} فرعاً`,
    metres: (n: number) => `${n} متر`,
    km: (n: string) => `${n} كم`,
    youAreHere: "أنت هنا",
  },
} as const;

/**
 * The emirate in words, for a heading that has to say WHICH branches these are.
 * The list is fetched per emirate, so "Nearest branches to you" was describing
 * the sort order and being read as the contents.
 */
const EMIRATE_NAME: Record<string, { en: string; ar: string }> = {
  AUH: { en: "Abu Dhabi", ar: "أبوظبي" },
  DXB: { en: "Dubai", ar: "دبي" },
  SHJ: { en: "Sharjah", ar: "الشارقة" },
  AJM: { en: "Ajman", ar: "عجمان" },
  UAQ: { en: "Umm Al Quwain", ar: "أم القيوين" },
  RAK: { en: "Ras Al Khaimah", ar: "رأس الخيمة" },
  FUJ: { en: "Fujairah", ar: "الفجيرة" },
};

/** Near enough that "nearest to you" is a true description, not a sort order. */
const NEAR_KM = 60;

export function ChatMap({
  emirate, bundle, onSelect, locale,
}: {
  emirate: string;
  bundle: string;
  onSelect: (text: string) => void;
  locale?: string;
}) {
  const t = MAP_STR[locale === "ar" ? "ar" : "en"];
  // Emirates Post send both names for every branch and this component was only
  // ever showing the English one -- on the pins, in the popups and in the list,
  // inside a conversation the customer was holding in Arabic. The name that goes
  // back to the chat is the name they read, so what they picked and what they
  // said they picked are the same string.
  const label = React.useCallback(
    (b: Branch) => (locale === "ar" && b.nameAr ? b.nameAr : b.name),
    [locale]
  );
  // The embed always lives at /embed/<slug>; derive it rather than thread a prop.
  const agentSlug = React.useMemo(
    () => (typeof window !== "undefined" ? window.location.pathname.match(/\/embed\/([^/?#]+)/)?.[1] : "") || "nxn-dialog",
    []
  );
  const [phase, setPhase] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [branches, setBranches] = React.useState<Branch[]>([]);
  const [userLoc, setUserLoc] = React.useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  /** FB-1801: filter a long branch list by area or name. */
  const [query, setQuery] = React.useState("");
  const mapEl = React.useRef<HTMLDivElement | null>(null);
  const mapObj = React.useRef<any>(null);
  const mapboxRef = React.useRef<any>(null);

  /**
   * Is the customer actually among these branches?
   *
   * The list is fetched per emirate, so a distance is always computable and
   * always beside the point when they are in another one. This is what decides
   * whether "nearest to you" is a description or just a sort order — and
   * whether their pin is allowed to drag the map across the country.
   */
  const nearby = React.useMemo(
    () => Boolean(userLoc) && branches.some((b) => typeof b.dist === "number" && b.dist <= NEAR_KM),
    [userLoc, branches]
  );

  const select = React.useCallback((b: Branch) => {
    if (selected) return;
    setSelected(b.id);
    onSelect(label(b));
  }, [selected, onSelect, label]);

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
    /**
     * THE BRANCHES DECIDE THE VIEW (FB-1797).
     *
     * "Map is not pointing to the right place (location is enabled in the
     * browser). Selected Abu Dhabi, then clicked on near branches."
     *
     * The list is fetched per EMIRATE and the map was centred on the CUSTOMER,
     * with their position folded into the bounds. Choose Abu Dhabi from Dubai
     * and fitBounds zooms out to cover both, so the map opens on a stretch of
     * desert between them: the wrong place, above a list of Abu Dhabi branches.
     *
     * So the frame is the branches. Their pin still goes on the map when they
     * are near enough for it to mean anything — it just no longer drags the
     * view across an emirate to include itself.
     */
    const center = { lat: branches[0]!.lat, lng: branches[0]!.lng };
    let map: any;
    try {
      map = new mapboxgl.Map({
        container: mapEl.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [center.lng, center.lat],
        zoom: 10,
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
        .setPopup(new mapboxgl.Popup({ offset: 14, closeButton: false }).setText(t.youAreHere))
        .addTo(map);
      // Only if they are actually among these branches. Otherwise their pin
      // stays on the map and out of the frame, which is the honest picture:
      // these are that emirate's branches, and they are not there.
      if (nearby) bounds.extend([userLoc.lng, userLoc.lat]);
    }
    branches.slice(0, 15).forEach((b) => {
      const el = document.createElement("div");
      el.className = "dlg-map-pin";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", label(b));
      const marker = new mapboxgl.Marker(el)
        .setLngLat([b.lng, b.lat])
        .setPopup(new mapboxgl.Popup({ offset: 16, closeButton: false }).setText(label(b)))
        .addTo(map);
      el.addEventListener("click", (e) => { e.stopPropagation(); marker.togglePopup(); select(b); });
      bounds.extend([b.lng, b.lat]);
    });
    if (!bounds.isEmpty()) {
      try { map.fitBounds(bounds, { padding: 44, maxZoom: 13, duration: 0 }); } catch { /* ignore */ }
    }
    return () => { try { map.remove(); } catch { /* ignore */ } mapObj.current = null; };
  }, [phase, branches, userLoc, nearby, select, label, t]);

  if (phase === "idle") {
    return (
      <div className="dlg-map">
        <button type="button" className="dlg-map-cta" onClick={browse}>
          <NavigationArrow size={16} weight="fill" />
          {t.browse}
        </button>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status">
          <ArrowClockwise size={15} weight="bold" className="spin" />
          {t.finding}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="dlg-map">
        <div className="dlg-map-status is-error">
          <Warning size={15} weight="fill" />
          {t.failed}
        </div>
      </div>
    );
  }

  // ready
  /**
   * SEARCH AN AREA TO PICK A BRANCH (FB-1801).
   *
   * Six rows of a seventy-five branch emirate, and no way past them but the
   * map. Matched on the branch name in whichever language it is shown, which is
   * where the area is — "Al Barsha Post Office", "Naif Post Office" — so typing
   * a district finds it without us needing an area field we do not have.
   *
   * The cap lifts while searching: six is a sensible preview of a list nobody
   * asked to filter, and a wall when somebody did.
   */
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? branches.filter((b) => label(b).toLowerCase().includes(needle) || (b.hours ?? "").toLowerCase().includes(needle))
    : branches;
  const topN = needle ? matched.slice(0, 20) : matched.slice(0, 6);
  const emirateName = EMIRATE_NAME[emirate.toUpperCase()]?.[locale === "ar" ? "ar" : "en"];
  return (
    <div className="dlg-map is-ready">
      {mapboxRef.current ? <div ref={mapEl} className="dlg-map-canvas" /> : null}
      <div className="dlg-map-head">
        {/* WHICH branches these are, not how they happen to be sorted. "Nearest
            branches to you" described the sort order and was read as the
            contents — with Abu Dhabi's branches under it and the customer in
            Dubai. Their distance is still on every row. */}
        {nearby ? t.nearest : emirateName ? t.inEmirate(emirateName) : t.branches}
      </div>
      {branches.length > 6 ? (
        <div className="dlg-map-search">
          <MagnifyingGlass size={15} weight="bold" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchArea}
            aria-label={t.searchArea}
            disabled={!!selected}
          />
          {needle ? <span className="dlg-map-found">{t.showingAll(matched.length)}</span> : null}
        </div>
      ) : null}
      <div className="dlg-map-list">
        {needle && !matched.length ? <div className="dlg-map-status">{t.noMatch}</div> : null}
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
              <span className="dlg-map-name">{label(b)}</span>
              {b.hours ? <span className="dlg-map-hours">{b.hours}</span> : null}
            </span>
            {typeof b.dist === "number" ? <span className="dlg-map-dist">{b.dist < 1 ? t.metres(Math.round(b.dist * 1000)) : t.km(b.dist.toFixed(1))}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
