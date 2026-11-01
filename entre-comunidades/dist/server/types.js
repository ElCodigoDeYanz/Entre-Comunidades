export const INTERESTS = [
    { id: "arte", label: "Arte y creación", symbol: "◈", color: "peach" },
    { id: "futbol", label: "Fútbol", symbol: "◉", color: "mint" },
    { id: "programacion", label: "Programación", symbol: "⌘", color: "lilac" },
    { id: "fotografia", label: "Fotografía", symbol: "▣", color: "yellow" },
    { id: "lectura", label: "Lectura", symbol: "✳", color: "pink" },
    { id: "naturaleza", label: "Naturaleza", symbol: "❋", color: "mint" },
];
export const ZONES = [
    "Lima Centro",
    "Lima Norte",
    "Lima Sur",
    "Lima Este",
    "Callao",
    "Arequipa",
    "Trujillo",
    "Otra zona",
];
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
];
export const POLICY_VERSION = "piloto-0.1-2026-10";
export const LIMITS = {
    body: 32768,
    sessionHours: 12,
    passwordMax: 128,
    messages: 100,
    capacity: 100,
    eventsPerUser: 50,
};
export class Problem extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
