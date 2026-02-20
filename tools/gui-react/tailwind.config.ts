import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          dark: '#1a1a2e',
        },
        panel: {
          DEFAULT: '#f8f9fa',
          dark: '#16213e',
        },
        accent: {
          DEFAULT: '#4361ee',
          dark: '#7b8cff',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
