// Shared Tailwind preset for all LeadPilot apps.
// Brand color tokens match the mockup at /Users/sitefyapp/leadpilot-mockups/index.html.

import type { Config } from 'tailwindcss';

const preset: Partial<Config> = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-2': 'rgb(var(--line-2) / <alpha-value>)',
        txt: 'rgb(var(--txt) / <alpha-value>)',
        'txt-2': 'rgb(var(--txt-2) / <alpha-value>)',
        'txt-3': 'rgb(var(--txt-3) / <alpha-value>)',
        teal: {
          DEFAULT: 'rgb(var(--teal) / <alpha-value>)',
          fg: 'rgb(var(--teal-fg) / <alpha-value>)',
        },
        // Sub-brand tones
        hp: { DEFAULT: '#f97316', fg: '#fff7ed', soft: '#fed7aa' }, // HomePro Appointments — orange
        vl: { DEFAULT: '#ec4899', fg: '#fdf2f8', soft: '#fbcfe8' }, // Virgin Leads — pink
        bs: { DEFAULT: '#3b82f6', fg: '#eff6ff', soft: '#bfdbfe' }, // Buyer Signals — blue
        ll: { DEFAULT: '#22c55e', fg: '#f0fdf4', soft: '#bbf7d0' }, // Live Leads — green
        hb: { DEFAULT: '#a855f7', fg: '#faf5ff', soft: '#e9d5ff' }, // HomePro Bids — purple
        bi: { DEFAULT: '#f59e0b', fg: '#fffbeb', soft: '#fde68a' }, // Buyer Incentives — amber
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default preset;
