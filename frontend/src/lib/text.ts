/** Lowercase without accents, for matching typed searches ("medellin" finds "Medellín"). */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
