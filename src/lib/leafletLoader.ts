export type LeafletNS = {
  map: (idOrEl: HTMLElement, opts?: any) => any;
  tileLayer: (url: string, opts?: any) => { addTo: (map: any) => void };
  geoJSON: (geojson: any, opts?: any) => { addTo: (map: any) => void };
  latLngBounds: (a: any, b?: any) => any;
};

let leafletPromise: Promise<LeafletNS> | null = null;

export function loadLeaflet(): Promise<LeafletNS> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Leaflet can only load on client"));
  }

  if (leafletPromise) {
    return leafletPromise;
  }

  leafletPromise = new Promise((resolve, reject) => {
    const w = window as typeof window & { L?: LeafletNS };
    if (w.L) {
      resolve(w.L);
      return;
    }

    const cssId = "leaflet-css-cdn";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const scriptId = "leaflet-js-cdn";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener(
        "load",
        () => {
          const w2 = window as typeof window & { L?: LeafletNS };
          if (!w2.L) {
            reject(new Error("Leaflet loaded but window.L missing"));
            return;
          }
          resolve(w2.L);
        },
        { once: true }
      );
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Leaflet script")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => {
      const w2 = window as typeof window & { L?: LeafletNS };
      if (!w2.L) {
        reject(new Error("Leaflet loaded but window.L missing"));
        return;
      }
      resolve(w2.L);
    };
    script.onerror = () => reject(new Error("Failed to load Leaflet script"));
    document.head.appendChild(script);
  });

  return leafletPromise;
}
