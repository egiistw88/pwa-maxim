import { NextResponse } from "next/server";
import { z } from "zod";

const RETRY_DELAYS_MS = [500, 1500];

async function fetchWithRetry(url: string, body: string) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "text/plain"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Overpass gagal: ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass error");
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Overpass error");
}

const querySchema = z
  .string()
  .transform((value) => value.split(",").map((entry) => Number(entry.trim())))
  .refine((values) => values.length === 4 && values.every((v) => !Number.isNaN(v)), {
    message: "bbox harus berisi minLon,minLat,maxLon,maxLat"
  })
  .transform(([minLon, minLat, maxLon, maxLat]) => ({
    minLon,
    minLat,
    maxLon,
    maxLat
  }));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bboxParam = url.searchParams.get("bbox");
  const cacheHeaders = {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
  };
  const errorHeaders = { "Cache-Control": "no-store" };

  const parsed = querySchema.safeParse(bboxParam ?? "");
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().formErrors.join(", ") },
      { status: 400, headers: errorHeaders }
    );
  }

  const { minLon, minLat, maxLon, maxLat } = parsed.data;
  const query = `
    [out:json][timeout:25];
    (
      nwr["amenity"~"restaurant|cafe|fast_food|food_court|marketplace|bus_station|taxi"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
      nwr["shop"~"supermarket|convenience|marketplace"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
      nwr["public_transport"~"station|platform"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
    );
    out center;
  `;

  try {
    const response = await fetchWithRetry("https://overpass-api.de/api/interpreter", query);
    const data = (await response.json()) as {
      elements: Array<{
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    const points = data.elements
      .map((element) => {
        if (element.lat && element.lon) {
          return { lat: element.lat, lon: element.lon, tags: element.tags ?? {} };
        }
        if (element.center) {
          return {
            lat: element.center.lat,
            lon: element.center.lon,
            tags: element.tags ?? {}
          };
        }
        return null;
      })
      .filter((item): item is { lat: number; lon: number; tags: Record<string, string> } =>
        Boolean(item)
      );

    return NextResponse.json(
      {
        points,
        count: points.length
      },
      { headers: cacheHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Overpass error" },
      { status: 500, headers: errorHeaders }
    );
  }
}
