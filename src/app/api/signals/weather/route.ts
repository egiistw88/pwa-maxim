import { NextResponse } from "next/server";
import { z } from "zod";

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(apiUrl.toString(), {
      signal: controller.signal
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Open-Meteo gagal: ${response.status}` },
        { status: 502, headers: errorHeaders }
      );
    }

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
  } finally {
    clearTimeout(timeout);
  }
}
