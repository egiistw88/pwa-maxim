"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { type GeoJsonFeatureCollection } from "../lib/types";

export type LeafletMapHandle = {
  fitBounds: (bounds: [[number, number], [number, number]]) => void;
  setView: (center: [number, number], zoom?: number) => void;
};

type GeoJsonLayer = {
  id: string;
  data: GeoJsonFeatureCollection;
  style: any;
  visible: boolean;
};

type LeafletMapProps = {
  center: [number, number];
  zoom: number;
  layers: GeoJsonLayer[];
};

const leafletCss = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const leafletJs = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function loadLeaflet() {
  return new Promise<any>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Leaflet hanya bisa di client"));
      return;
    }

    if (window.L) {
      resolve(window.L);
      return;
    }

    if (!document.querySelector(`link[href="${leafletCss}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = leafletCss;
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = leafletJs;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Gagal memuat Leaflet"));
    document.body.appendChild(script);
  });
}

export const LeafletMap = forwardRef<LeafletMapHandle, LeafletMapProps>(
  ({ center, zoom, layers }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const leafletRef = useRef<any>(null);
    const [ready, setReady] = useState(false);
    const geoLayersRef = useRef<Record<string, any>>({});

    useImperativeHandle(ref, () => ({
      fitBounds: (bounds) => {
        mapRef.current?.fitBounds(bounds);
      },
      setView: (nextCenter, nextZoom) => {
        mapRef.current?.setView(nextCenter, nextZoom ?? mapRef.current.getZoom());
      }
    }));

    useEffect(() => {
      let isMounted = true;
      loadLeaflet()
        .then((leaflet) => {
          if (!isMounted || !containerRef.current) {
            return;
          }
          leafletRef.current = leaflet;
          const map = leaflet.map(containerRef.current).setView(center, zoom);
          leaflet
            .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
              attribution: "© OpenStreetMap contributors"
            })
            .addTo(map);
          mapRef.current = map;
          setReady(true);
        })
        .catch(() => {
          setReady(false);
        });

      return () => {
        isMounted = false;
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      };
    }, [center, zoom]);

    useEffect(() => {
      if (!ready || !mapRef.current || !leafletRef.current) {
        return;
      }

      const leaflet = leafletRef.current;
      const nextIds = new Set(layers.map((layer) => layer.id));
      Object.keys(geoLayersRef.current).forEach((id) => {
        if (!nextIds.has(id)) {
          mapRef.current?.removeLayer(geoLayersRef.current[id]);
          delete geoLayersRef.current[id];
        }
      });

      layers.forEach((layer) => {
        const existing = geoLayersRef.current[layer.id];
        if (existing) {
          mapRef.current?.removeLayer(existing);
          delete geoLayersRef.current[layer.id];
        }
        if (!layer.visible) {
          return;
        }
        const geoLayer = leaflet.geoJSON(layer.data, {
          style: layer.style
        });
        geoLayer.addTo(mapRef.current!);
        geoLayersRef.current[layer.id] = geoLayer;
      });
    }, [layers, ready]);

    return <div className="map-wrapper" ref={containerRef} />;
  }
);

LeafletMap.displayName = "LeafletMap";
