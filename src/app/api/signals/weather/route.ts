import { NextResponse } from "next/server";
import { z } from "zod";

const RETRY_DELAYS_MS = [500, 1500];

async function fetchWithRetry(url: string) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Open-Meteo gagal: ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Open-Meteo error");
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Open-Meteo error");
}

const paramSchema = z.object({
  lat: z.coerce.number(),
  lon: z.coerce.number()
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cacheHeaders = {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
  };
  const errorHeaders = { "Cache-Control": "no-store" };
  const parsed = paramSchema.safeParse({
    lat: url.searchParams.get("lat"),
    lon: url.searchParams.get("lon")
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().formErrors.join(", ") },
      { status: 400, headers: errorHeaders }
    );
  }

  const { lat, lon } = parsed.data;
  const apiUrl = new URL("https://api.open-meteo.com/v1/forecast");
  apiUrl.searchParams.set("latitude", String(lat));
  apiUrl.searchParams.set("longitude", String(lon));
  apiUrl.searchParams.set("hourly", "precipitation_probability,precipitation");
  apiUrl.searchParams.set("forecast_days", "2");
  apiUrl.searchParams.set("timezone", "Asia/Jakarta");

  try {
    const response = await fetchWithRetry(apiUrl.toString());
    const data = (await response.json()) as {
      hourly: { time: string[]; precipitation_probability: number[] };
    };

    const next24 = data.hourly.time.slice(0, 24).map((time, index) => ({
      time,
      precipitationProbability: data.hourly.precipitation_probability[index] ?? 0
    }));

    return NextResponse.json(
      {
        hourly: next24
      },
      { headers: cacheHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open-Meteo error" },
      { status: 500, headers: errorHeaders }
    );
  }
}
