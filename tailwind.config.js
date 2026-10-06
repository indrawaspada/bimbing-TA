/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0f2340', 50: '#f3f6fb', 100: '#e4ebf5', 200: '#c6d4e8', 300: '#9bb2d4', 500: '#41608f', 700: '#1c3559', 800: '#14294a', 900: '#0f2340', 950: '#0a172b' },
        teal: { 50: '#ecfbf8', 100: '#d0f4ec', 200: '#a3e8da', 400: '#3fc6b0', 500: '#1ea995', 600: '#138878', 700: '#126d62', 800: '#13574f' },
        paper: '#f6f8fb',
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      boxShadow: { card: '0 1px 2px rgba(15,35,64,.06), 0 4px 16px -8px rgba(15,35,64,.12)' },
    },
  },
  plugins: [],
};
