"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { type GeoJsonFeatureCollection } from "../lib/types";
import { loadLeaflet, type LeafletNS } from "../lib/leafletLoader";

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

export const LeafletMap = forwardRef<LeafletMapHandle, LeafletMapProps>(
  ({ center, zoom, layers }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const layersRef = useRef<Record<string, any>>({});
    const leafletRef = useRef<LeafletNS | null>(null);

    useImperativeHandle(ref, () => ({
      fitBounds: (bounds) => {
        mapRef.current?.fitBounds(bounds as any);
      },
      setView: (nextCenter, nextZoom) => {
        const map = mapRef.current;
        if (!map) {
          return;
        }
        map.setView(nextCenter as any, nextZoom ?? map.getZoom() ?? 12);
      }
    }));

    useEffect(() => {
      let cancelled = false;

      loadLeaflet()
        .then((leaflet) => {
          if (cancelled || mapRef.current || !containerRef.current) {
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
        })
        .catch(() => {
          // ignore load errors
        });

      return () => {
        cancelled = true;
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (!mapRef.current || !leafletRef.current) {
        return;
      }

      mapRef.current.setView(center as any, zoom);
    }, [center, zoom]);

    useEffect(() => {
      const map = mapRef.current;
      const leaflet = leafletRef.current;
      if (!map || !leaflet) {
        return;
      }

      const nextIds = new Set(layers.map((layer) => layer.id));
      Object.keys(layersRef.current).forEach((id) => {
        if (!nextIds.has(id)) {
          map.removeLayer(layersRef.current[id]);
          delete layersRef.current[id];
        }
      });

      layers.forEach((layer) => {
        const existing = layersRef.current[layer.id];
        if (existing) {
          map.removeLayer(existing);
          delete layersRef.current[layer.id];
        }
        if (!layer.visible) {
          return;
        }
        const geoLayer = leaflet.geoJSON(layer.data, {
          style: layer.style
        });
        geoLayer.addTo(map);
        layersRef.current[layer.id] = geoLayer;
      });
    }, [layers]);

    return <div className="map-wrapper" ref={containerRef} />;
  }
);

LeafletMap.displayName = "LeafletMap";
