import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0b0f19",
          color: "#ffffff",
          fontSize: 160,
          fontWeight: 700,
          fontFamily: "Inter, system-ui, sans-serif"
        }}
      >
        MC
      </div>
    ),
    {
      width: 512,
      height: 512
    }
  );
}
