export function parseRestSeconds(rest: string | number | null | undefined): number {
  if (rest == null) return 0;
  if (typeof rest === "number") return Number.isFinite(rest) && rest > 0 ? Math.floor(rest) : 0;
  const s = String(rest).trim().toLowerCase();
  if (!s) return 0;

  if (/^\d+:\d{1,2}$/.test(s)) {
    const [m, sec] = s.split(":").map(Number);
    return m * 60 + sec;
  }

  const compound = s.match(/^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/);
  if (compound && (compound[1] || compound[2])) {
    return parseInt(compound[1] || "0", 10) * 60 + parseInt(compound[2] || "0", 10);
  }

  const bare = parseInt(s, 10);
  if (!isNaN(bare)) return bare;

  return 0;
}

export function formatMmSs(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
