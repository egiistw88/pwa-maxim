import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bboxParam = url.searchParams.get("bbox");

  if (!bboxParam) {
    return NextResponse.json(
      { error: "bbox harus berisi minLon,minLat,maxLon,maxLat" },
      { status: 400 }
    );
  }

  const values = bboxParam.split(",").map((entry) => Number(entry.trim()));
  if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
    return NextResponse.json(
      { error: "bbox harus berisi minLon,minLat,maxLon,maxLat" },
      { status: 400 }
    );
  }

  const [minLon, minLat, maxLon, maxLat] = values;
  const query = `
    [out:json][timeout:25];
    (
      nwr["amenity"~"university|hospital|marketplace|bus_station|taxi|restaurant|cafe|fast_food|food_court"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
      nwr["shop"~"mall|supermarket|convenience|marketplace"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
      nwr["leisure"~"park|sports_centre"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
      nwr["public_transport"~"station|platform"][bbox:${minLat},${minLon},${maxLat},${maxLon}];
    );
    out center;
  `;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: {
        "Content-Type": "text/plain"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Overpass gagal: ${response.status}` },
        { status: 502 }
      );
    }

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

    return NextResponse.json({
      points,
      count: points.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Overpass error" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
