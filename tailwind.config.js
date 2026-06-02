/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        veloxa: {
          50: '#eef4ff',
          100: '#dbe6ff',
          200: '#bfd2ff',
          300: '#92b3ff',
          400: '#5e87ff',
          500: '#3a60ff',
          600: '#1f3df5',
          700: '#1a30dc',
          800: '#1c2bb1',
          900: '#1c2b8c',
          950: '#141a52',
        },
        ink: {
          900: '#0b0d12',
          800: '#11141b',
          700: '#171b25',
          600: '#1f2430',
          500: '#2a3040',
          400: '#3a4255',
          300: '#5a6477',
          200: '#8d96a8',
          100: '#c5cad6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(58,96,255,0.25), 0 8px 24px -8px rgba(58,96,255,0.45)',
        card: '0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
    },
  },
  plugins: [],
};
