import { ImageResponse } from "next/og"; // renders JSX to a PNG at build time
import { COBALT_BRIGHT, GRAPHITE } from "@/lib/token-hex"; // image generation can't read CSS variables

const SIZES = [32, 192, 512]; // favicon + the two PWA sizes Chrome needs (spec §12, WP9)

export function generateImageMetadata() { // one PNG per size → /icon/32, /icon/192, /icon/512
  return SIZES.map((size) => ({ id: String(size), size: { width: size, height: size }, contentType: "image/png" })); // metadata per image
}

export default async function Icon({ id }: { id: Promise<string | number> }) { // our own fingerprint glyph (not a brand logo)
  const size = Number(await id); // which size is being rendered
  const stroke = size <= 32 ? 5 : 3.5; // thicker lines survive at favicon size
  return new ImageResponse( // JSX → PNG
    (
      // full-bleed graphite square (works as a maskable icon too: the glyph stays inside the safe zone)
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: GRAPHITE }}>
        {/* four nested arches = a stylised fingerprint, drawn on a 64×64 grid */}
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64" fill="none" stroke={COBALT_BRIGHT} strokeWidth={stroke} strokeLinecap="round">
          <path d="M12 46 L12 34 A20 20 0 0 1 52 34 L52 42" />
          <path d="M19 52 L19 34 A13 13 0 0 1 45 34 L45 50" />
          <path d="M26 56 L26 34 A6 6 0 0 1 38 34 L38 56" />
          <path d="M32 34 L32 50" />
        </svg>
      </div>
    ),
    { width: size, height: size }, // PNG dimensions
  );
}
