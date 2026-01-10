export const regions = {
  timur: {
    label: "Bandung Timur",
    bbox: [107.64, -6.96, 107.74, -6.86]
  },
  tengah: {
    label: "Bandung Tengah",
    bbox: [107.58, -6.95, 107.64, -6.88]
  },
  utara: {
    label: "Bandung Utara",
    bbox: [107.57, -6.88, 107.69, -6.8]
  },
  selatan: {
    label: "Bandung Selatan",
    bbox: [107.57, -7.02, 107.69, -6.95]
  },
  barat: {
    label: "Bandung Barat",
    bbox: [107.5, -6.96, 107.58, -6.86]
  }
};

export type RegionKey = keyof typeof regions;
