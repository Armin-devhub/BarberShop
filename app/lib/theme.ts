// Novyx Barbershop — Modern Admin palette.
// Light, minimal, warm-neutral surfaces with a single ink accent.
// Shared style tokens so screens look consistent. Tweak in one place.

export const colors = {
  // surfaces
  bg: '#F7F6F4', // app canvas
  surface: '#FFFFFF', // cards, sidebar, headers
  surfaceAlt: '#F1F0EC', // subtle fills / hover / inactive
  border: '#E7E5E0', // hairline borders

  // typography
  text: '#1C1A17', // primary headings + body emphasis
  textCream: '#26231F', // body text
  muted: '#74706A', // secondary text + labels
  subtle: '#A8A39B', // placeholders / faint detail

  // brand / accent — kept as keys for compatibility; now ink-based, used sparingly
  gold: '#1C1A17', // emphasis text + active fills (formerly the gold accent)
  goldDeep: '#74706A', // secondary labels

  // actions
  primary: '#1C1A17', // primary button = ink
  primaryText: '#FFFFFF',
  secondary: '#FFFFFF',
  secondaryText: '#1C1A17',

  // status — tuned for a light background. The base hues stay as-is so white
  // button text and small status text keep AA contrast; the soft variants are
  // tinted fills used to color buttons/pills without shouting.
  ok: '#0E9F6E',
  okSoft: '#E6F5EE',
  warn: '#B45309',
  warnSoft: '#FBF1E3',
  danger: '#DC2626',
  dangerSoft: '#FCEBEA',

  // chat brand (kept literal so receipt buttons stay recognizable)
  whatsapp: '#25D366',

  // Premium brand accents — the dark/cream/gold used on the PDF header and the
  // logo mark. Used sparingly for hero panels and data-viz highlights.
  ink: '#0F0E0C', // near-black hero surface
  inkSoft: '#1C1A17', // raised element on ink
  cream: '#E8DDC9', // text on ink
  accent: '#B89865', // brand gold
  accentDeep: '#94703F', // deeper gold for emphasis
  accentSoft: '#F4ECDD' // gold tint fill on light surfaces
} as const;

// Modern admin: soft, consistent rounding.
export const radius = { sm: 8, md: 10, lg: 14 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Soft, low shadow for cards on the light canvas (replaces gold hairlines).
export const cardShadow = {
  shadowColor: '#1C1A17',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 2
} as const;

// Page header used at the top of every admin screen.
export const pageHeader = {
  title: { fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: -0.2 } as const,
  subtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 2,
    letterSpacing: 1
  } as const,
  wrap: { marginBottom: space.md } as const
};

// Reusable card style for list rows
export const cardBase = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: radius.md,
  padding: space.md,
  ...cardShadow
} as const;

// Brand
export const brand = {
  name: 'Novyx Barbershop',
  short: 'Novyx'
};

// Modern admin-dashboard palette. Independent of the customer-facing gold/ink
// brand — used for the analytics dashboard's cards and charts.
export const dash = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  border: '#ECEEF1',
  text: '#0F172A',
  muted: '#64748B',
  subtle: '#94A3B8',
  track: '#EEF0F3',

  primary: '#6366F1',
  primaryDeep: '#4F46E5',
  violet: '#8B5CF6',
  emerald: '#10B981',
  amber: '#F59E0B',
  sky: '#0EA5E9',
  rose: '#F43F5E',

  primarySoft: '#EEF0FE',
  emeraldSoft: '#E7F8F1',
  amberSoft: '#FEF4E6',
  skySoft: '#E6F6FD',
  roseSoft: '#FEECEF',
  violetSoft: '#F1ECFE'
} as const;

// Ordered palette for multi-series charts (donut slices, etc.).
export const chartPalette = [
  '#6366F1',
  '#10B981',
  '#F59E0B',
  '#0EA5E9',
  '#F43F5E',
  '#8B5CF6'
];
