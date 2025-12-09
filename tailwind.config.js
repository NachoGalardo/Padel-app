/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{tsx,ts}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        accent: '#14b8a6',
        background: '#f8fafc',
        surface: '#ffffff',
        muted: '#94a3b8',
        error: '#dc2626',
      },
    },
  },
  plugins: [],
};

