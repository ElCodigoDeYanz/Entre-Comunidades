export type Row = Record<string, string | number | null>;
export type Profile = {
  id: string;
  alias: string;
  bio: string;
  zone: string;
  interests: string[];
  ageDeclaration: string;
  role: string;
};
export const INTERESTS = [
  { id: "arte", label: "Arte y creación", symbol: "◈", color: "peach" },
  { id: "futbol", label: "Fútbol", symbol: "◉", color: "mint" },
  { id: "programacion", label: "Programación", symbol: "⌘", color: "lilac" },
  { id: "fotografia", label: "Fotografía", symbol: "▣", color: "yellow" },
  { id: "lectura", label: "Lectura", symbol: "✳", color: "pink" },
  { id: "naturaleza", label: "Naturaleza", symbol: "❋", color: "mint" },
] as const;
export const ZONES = [
  "Lima Centro",
  "Lima Norte",
  "Lima Sur",
  "Lima Este",
  "Callao",
  "Arequipa",
  "Trujillo",
  "Otra zona",
] as const;
export const VENUES = [
  {
    id: "plaza-demo",
    label: "Plaza pública de ejemplo",
    zone: "Lima Centro",
    public: true,
    synthetic: true,
  },
  {
    id: "biblioteca-demo",
    label: "Biblioteca pública de ejemplo",
    zone: "Lima Centro",
    public: true,
    synthetic: true,
  },
  {
    id: "cancha-demo",
    label: "Cancha pública de ejemplo",
    zone: "Lima Norte",
    public: true,
    synthetic: true,
  },
  {
    id: "parque-demo",
    label: "Parque público de ejemplo",
    zone: "Lima Sur",
    public: true,
    synthetic: true,
  },
  {
    id: "espacio-demo",
    label: "Espacio cultural público de ejemplo",
    zone: "Arequipa",
    public: true,
    synthetic: true,
  },
] as const;
export const POLICY_VERSION = "piloto-0.1-2026-10";
export const LIMITS = {
  body: 32768,
  sessionHours: 12,
  passwordMax: 128,
  messages: 100,
  capacity: 100,
  eventsPerUser: 50,
} as const;
export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
