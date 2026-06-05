import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'Cambria', 'Times New Roman', 'serif']
      },
      colors: {
        // Novyx — Luxury Hotel palette
        novyx: {
          bg: '#0A0A0A',
          surface: '#161210',
          border: '#3A352A',
          gold: '#B89865',
          goldHi: '#D9B97A',
          cream: '#E8DDC9',
          muted: '#9A8E72',
          subtle: '#7A6E5A',
          ok: '#7FB97F',
          warn: '#D9A14F',
          danger: '#B85C3C'
        }
      }
    }
  },
  plugins: []
};

export default config;
