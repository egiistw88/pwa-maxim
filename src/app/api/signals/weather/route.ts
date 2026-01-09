import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get("lat");
  const lonParam = url.searchParams.get("lon");
  const lat = Number(latParam);
  const lon = Number(lonParam);

  if (!latParam || !lonParam || Number.isNaN(lat) || Number.isNaN(lon)) {
    return NextResponse.json(
      { error: "lat/lon tidak valid" },
      { status: 400 }
    );
  }
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
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      hourly: { time: string[]; precipitation_probability: number[] };
    };

    const next24 = data.hourly.time.slice(0, 24).map((time, index) => ({
      time,
      precipitationProbability: data.hourly.precipitation_probability[index] ?? 0
    }));

    return NextResponse.json({
      hourly: next24
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open-Meteo error" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
