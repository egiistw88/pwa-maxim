import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="card grid" style={{ gap: 16 }}>
      <h2>Anda offline</h2>
      <p className="helper-text">
        Koneksi internet tidak tersedia. Data trip dan dompet tetap bisa diakses karena
        tersimpan di perangkat.
      </p>
      <div className="form-row">
        <Link className="tab" href="/heatmap">
          Buka Heatmap
        </Link>
        <Link className="tab" href="/wallet">
          Buka Dompet
        </Link>
      </div>
    </div>
  );
}
