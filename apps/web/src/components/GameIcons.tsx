import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

export function ResourceIcon(props: { type: "g" | "w" | "s" | "f" | "c" | "pop" | "mana" | string; className?: string }) {
  const cls = props.className ?? "h-4 w-4 shrink-0";
  switch (props.type) {
    case "g":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#f59e0b" stroke="#92400e" strokeWidth="2" />
          <circle cx="12" cy="12" r="6.5" fill="#fde047" stroke="#d97706" strokeWidth="1.2" />
          <path d="M12 7.5v9M9.5 10.5c0-1.1 1.1-1.8 2.5-1.8s2.5.7 2.5 1.8-1.1 1.6-2.5 1.9-2.5.8-2.5 1.9 1.1 1.8 2.5 1.8 2.5-.7 2.5-1.8" stroke="#92400e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "w":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <rect x="3" y="9" width="18" height="8" rx="4" fill="#9a5325" stroke="#451a03" strokeWidth="1.8" />
          <ellipse cx="19" cy="13" rx="2.6" ry="3.8" fill="#e5b37c" stroke="#451a03" strokeWidth="1.4" />
          <path d="M6 12h9M7 15h7" stroke="#5c2d10" strokeWidth="1.3" strokeLinecap="round" />
          <rect x="6" y="4.5" width="12" height="5.5" rx="2.5" fill="#b46531" stroke="#451a03" strokeWidth="1.6" />
        </svg>
      );
    case "s":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path d="M4 17l3-8 6-4 7 4 1 8-6 3H7z" fill="#94a3b8" stroke="#334155" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M7 9l6 2 7-2M13 11l-1 9" stroke="#475569" strokeWidth="1.3" fill="none" />
          <path d="M7 9l6-4 4 2.5-4 3.5z" fill="#cbd5e1" opacity="0.7" />
        </svg>
      );
    case "f":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path d="M16.5 4.5c2.6 2.6 2.8 6.8.2 9.4-1.8 1.8-4.5 2.4-6.9 1.6l-3.3 3.3c-.6.6-1.6.6-2.2 0-.6-.6-.6-1.6 0-2.2l3.3-3.3c-.8-2.4-.2-5.1 1.6-6.9 2.6-2.6 6.8-2.4 9.3-1.9z" fill="#e11d48" stroke="#4c0519" strokeWidth="1.7" strokeLinejoin="round" />
          <ellipse cx="14.2" cy="8.8" rx="2.8" ry="1.8" transform="rotate(-35 14.2 8.8)" fill="#fda4af" />
          <circle cx="5.2" cy="18.8" r="1.4" fill="#fef3c7" stroke="#4c0519" strokeWidth="1" />
        </svg>
      );
    case "c":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="#16a34a" stroke="#14532d" strokeWidth="1.8" />
          <rect x="5" y="8.5" width="14" height="7" rx="1.2" fill="#4ade80" stroke="#15803d" strokeWidth="1" />
          <circle cx="12" cy="12" r="2.7" fill="#15803d" />
          <path d="M12 10.2v3.6" stroke="#dcfce7" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "pop":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <circle cx="9.5" cy="8.5" r="3.5" fill="#60a5fa" stroke="#1e3a8a" strokeWidth="1.6" />
          <path d="M3.5 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="16.5" cy="9.5" r="2.6" fill="#93c5fd" stroke="#1e3a8a" strokeWidth="1.4" />
          <path d="M15.5 14.2c2.4.4 4.5 2 4.5 4.8" fill="#60a5fa" stroke="#1e3a8a" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "mana":
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path d="M12 2.5C12 2.5 5.5 10.2 5.5 14.8a6.5 6.5 0 0013 0C18.5 10.2 12 2.5 12 2.5z" fill="#38bdf8" stroke="#0c4a6e" strokeWidth="1.8" />
          <path d="M9.5 14.2c0-1.8 1.5-4.3 2.5-5.8.7 1.3 1.4 3.2 1.4 4.8a2.3 2.3 0 01-3.9 1z" fill="#bae6fd" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="#fbbf24" stroke="#78350f" strokeWidth="2" />
        </svg>
      );
  }
}

export function HudIcon(props: {
  name:
    | "shop"
    | "map"
    | "goals"
    | "market"
    | "storage"
    | "army"
    | "magic"
    | "soundOn"
    | "soundOff"
    | "sfxOn"
    | "sfxOff"
    | "grid"
    | "center"
    | "sword"
    | "shield"
    | "range"
    | "speed"
    | "heart"
    | "home"
    | "biome";
  className?: string;
}) {
  const cls = props.className ?? "h-4 w-4 shrink-0";
  const wrap = (body: ReactNode) => (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  );

  switch (props.name) {
    case "shop":
      return wrap(
        <>
          <path d="M3 9l1.5-5h15L21 9" fill="#fde047" stroke="#78350f" />
          <path d="M4 9h16v11H4z" fill="#fef3c7" stroke="#78350f" />
          <path d="M9 20v-6h6v6" fill="#d97706" stroke="#78350f" />
        </>
      );
    case "map":
      return wrap(
        <>
          <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" fill="#fde68a" stroke="#78350f" />
          <path d="M9 4v14M15 6v14" stroke="#92400e" />
        </>
      );
    case "goals":
      return wrap(
        <>
          <path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" fill="#fef08a" stroke="#713f12" />
          <path d="M8 9h7M8 13h7M8 17h4" stroke="#713f12" />
        </>
      );
    case "market":
      return wrap(
        <>
          <path d="M12 4v16M6 7h12M4 13l2-6 2 6a2.2 2.2 0 01-4 0zM16 13l2-6 2 6a2.2 2.2 0 01-4 0zM8 20h8" stroke="#fcd34d" />
        </>
      );
    case "storage":
      return wrap(
        <>
          <rect x="3" y="8" width="18" height="12" rx="2" fill="#b45309" stroke="#fde68a" />
          <path d="M3 12h18M10 12v3h4v-3" stroke="#fde68a" />
          <path d="M5 8l2-4h10l2 4" fill="#d97706" stroke="#fde68a" />
        </>
      );
    case "army":
    case "sword":
      return wrap(
        <>
          <path d="M19 4l-9 9M14 4h5v5" stroke="#f87171" strokeWidth="2.2" />
          <path d="M7 11l6 6M5 19l4-4" stroke="#fbbf24" strokeWidth="2.2" />
        </>
      );
    case "shield":
      return wrap(
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" fill="#60a5fa" stroke="#1e3a8a" />
      );
    case "range":
      return wrap(
        <>
          <circle cx="12" cy="12" r="8" stroke="#f87171" />
          <circle cx="12" cy="12" r="3.5" fill="#ef4444" stroke="#fecaca" />
        </>
      );
    case "speed":
      return wrap(
        <path d="M13 3L5 14h6l-1 7 9-11h-6l0-7z" fill="#38bdf8" stroke="#0c4a6e" />
      );
    case "heart":
      return wrap(
        <path d="M12 20s-7.5-4.7-7.5-10.2A4.3 4.3 0 0112 6.8a4.3 4.3 0 017.5 3c0 5.5-7.5 10.2-7.5 10.2z" fill="#ef4444" stroke="#7f1d1d" />
      );
    case "magic":
      return wrap(
        <>
          <circle cx="12" cy="11" r="6.5" fill="#7c3aed" stroke="#c4b5fd" />
          <circle cx="10" cy="9" r="2" fill="#e9d5ff" stroke="none" />
          <path d="M7 20h10l-1.5-2.5h-7L7 20z" fill="#d97706" stroke="#fde68a" />
        </>
      );
    case "soundOn":
      return wrap(
        <>
          <path d="M5 9v6h4l5 4V5L9 9H5z" fill="currentColor" />
          <path d="M17.5 8.5a5 5 0 010 7M19.8 6.2a8.5 8.5 0 010 11.6" />
        </>
      );
    case "soundOff":
      return wrap(
        <>
          <path d="M5 9v6h4l5 4V5L9 9H5z" fill="currentColor" />
          <path d="M17 9l4 6M21 9l-4 6" />
        </>
      );
    case "sfxOn":
      return wrap(
        <>
          <path d="M18 16H6c1.2-1.5 2-3.2 2-6a4 4 0 118 0c0 2.8.8 4.5 2 6z" fill="currentColor" />
          <path d="M10 19a2 2 0 004 0" />
        </>
      );
    case "sfxOff":
      return wrap(
        <>
          <path d="M18 16H6c1.2-1.5 2-3.2 2-6a4 4 0 118 0" />
          <path d="M4 4l16 16" />
        </>
      );
    case "grid":
      return wrap(<path d="M4 9h16M4 15h16M9 4v16M15 4v16" />);
    case "center":
      return wrap(
        <>
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </>
      );
    case "home":
      return wrap(
        <>
          <path d="M3 11l9-7 9 7v9H3v-9z" fill="#fbbf24" stroke="#78350f" />
          <path d="M9 20v-6h6v6" fill="#78350f" stroke="#78350f" />
        </>
      );
    case "biome":
      return wrap(
        <>
          <path d="M12 3c4 4 6 7 6 10a6 6 0 11-12 0c0-3 2-6 6-10z" fill="#4ade80" stroke="#14532d" />
          <path d="M12 8v11" stroke="#14532d" />
        </>
      );
  }
}

export function SpellSvgIcon(props: { magicId: number; className?: string }) {
  const cls = props.className ?? "h-7 w-7 shrink-0";
  const palette: Record<number, { bg: string; fg: string; accent: string; glyph: ReactNode }> = {
    2: {
      bg: "#7c2d12",
      fg: "#fb923c",
      accent: "#fde047",
      glyph: <path d="M12 3c2 4 6 6 6 11a6 6 0 11-12 0c0-3 1.5-5.5 3-7 0 2 1.2 3 2.5 3C11.5 7 11 5 12 3z" fill="#fb923c" stroke="#fde047" strokeWidth="1.4" />
    },
    3: {
      bg: "#334155",
      fg: "#cbd5e1",
      accent: "#f8fafc",
      glyph: (
        <>
          <circle cx="8" cy="8" r="2.6" fill="#e2e8f0" />
          <circle cx="16" cy="10" r="2.8" fill="#cbd5e1" />
          <circle cx="11" cy="16" r="3" fill="#94a3b8" />
        </>
      )
    },
    4: {
      bg: "#0c4a6e",
      fg: "#38bdf8",
      accent: "#e0f2fe",
      glyph: <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#7dd3fc" strokeWidth="2.2" strokeLinecap="round" />
    },
    5: {
      bg: "#14532d",
      fg: "#4ade80",
      accent: "#bbf7d0",
      glyph: <path d="M12 5v14M5 12h14" stroke="#4ade80" strokeWidth="4" strokeLinecap="round" />
    },
    6: {
      bg: "#78350f",
      fg: "#d97706",
      accent: "#fde68a",
      glyph: <path d="M6 19l2-11 4-4 4 4 2 11H6z" fill="#d97706" stroke="#fde68a" strokeWidth="1.5" />
    },
    7: {
      bg: "#450a0a",
      fg: "#ef4444",
      accent: "#fb923c",
      glyph: <path d="M4 18l5-10 3 5 3-6 5 11H4z" fill="#dc2626" stroke="#fdba74" strokeWidth="1.4" />
    },
    8: {
      bg: "#365314",
      fg: "#a3e635",
      accent: "#ecfccb",
      glyph: (
        <>
          <circle cx="12" cy="10" r="5" fill="#84cc16" />
          <circle cx="10" cy="9.5" r="1.2" fill="#1a2e05" />
          <circle cx="14" cy="9.5" r="1.2" fill="#1a2e05" />
          <path d="M9 17h6" stroke="#bef264" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )
    },
    9: {
      bg: "#713f12",
      fg: "#facc15",
      accent: "#fef9c3",
      glyph: <path d="M12 4l6.5 2.8v4.8c0 4.2-2.7 7.2-6.5 8.8-3.8-1.6-6.5-4.6-6.5-8.8V6.8L12 4z" fill="#facc15" stroke="#fef9c3" strokeWidth="1.4" />
    },
    10: {
      bg: "#1e3a8a",
      fg: "#93c5fd",
      accent: "#ffffff",
      glyph: (
        <>
          <circle cx="12" cy="12" r="5.5" fill="#e0f2fe" />
          <circle cx="7.5" cy="7.5" r="2.2" fill="#bae6fd" />
          <circle cx="16.5" cy="7.5" r="2.2" fill="#bae6fd" />
          <circle cx="10" cy="11.5" r="1" fill="#1e3a8a" />
          <circle cx="14" cy="11.5" r="1" fill="#1e3a8a" />
        </>
      )
    },
    11: {
      bg: "#7c2d12",
      fg: "#f97316",
      accent: "#fef08a",
      glyph: <path d="M13 3L6 13h5l-1 8 8-10h-5l0-8z" fill="#facc15" stroke="#f97316" strokeWidth="1.3" />
    },
    12: {
      bg: "#7f1d1d",
      fg: "#f87171",
      accent: "#fde047",
      glyph: <path d="M4 14l4-6 4 3 4-5 4 8-4 4-4-2-4 2-4-4z" fill="#ef4444" stroke="#fde047" strokeWidth="1.4" />
    },
    13: {
      bg: "#1d4ed8",
      fg: "#60a5fa",
      accent: "#e0f2fe",
      glyph: <path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3z" fill="#93c5fd" stroke="#ffffff" strokeWidth="1.2" />
    },
    14: {
      bg: "#065f46",
      fg: "#34d399",
      accent: "#d1fae5",
      glyph: <path d="M5 7l6 5-6 5V7zm7 0l6 5-6 5V7z" fill="#34d399" />
    },
    15: {
      bg: "#4c1d95",
      fg: "#c084fc",
      accent: "#f3e8ff",
      glyph: (
        <>
          <circle cx="12" cy="12" r="7" stroke="#c084fc" strokeWidth="2" fill="none" />
          <circle cx="12" cy="12" r="2.8" fill="#f5d0fe" />
        </>
      )
    },
    16: {
      bg: "#3b0764",
      fg: "#a855f7",
      accent: "#f0abfc",
      glyph: (
        <>
          <circle cx="12" cy="12" r="7.5" fill="#090414" stroke="#a855f7" strokeWidth="2" />
          <circle cx="12" cy="12" r="4" stroke="#e879f9" strokeWidth="1.5" fill="none" strokeDasharray="4 2" />
        </>
      )
    }
  };

  const spec = palette[props.magicId] ?? palette[2]!;
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill={spec.bg} stroke={spec.accent} strokeWidth="1.4" />
      {spec.glyph}
    </svg>
  );
}
