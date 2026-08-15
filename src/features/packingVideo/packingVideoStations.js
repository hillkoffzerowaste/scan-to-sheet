/**
 * Packing stations are a fixed list rather than a Firestore collection.
 *
 * The warehouse has a handful of benches and they change rarely, so a constant avoids an extra
 * read on every session start and a whole admin screen. Move this to Firestore only when
 * someone actually needs to add a station without a deploy.
 */
export const PACKING_STATIONS = [
  { id: 'PACK-A', label: 'PACK-A (จุดแพ็ค A)' },
  { id: 'PACK-B', label: 'PACK-B (จุดแพ็ค B)' },
  { id: 'PACK-C', label: 'PACK-C (จุดแพ็ค C)' },
  { id: 'PACK-D', label: 'PACK-D (จุดแพ็ค D)' },
];

export const PACKING_STATION_IDS = PACKING_STATIONS.map((station) => station.id);

export function isKnownStation(stationId) {
  return PACKING_STATION_IDS.includes(String(stationId ?? '').trim().toUpperCase());
}

export function packingStationLabel(stationId) {
  const id = String(stationId ?? '').trim().toUpperCase();
  return PACKING_STATIONS.find((station) => station.id === id)?.label ?? id;
}
