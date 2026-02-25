/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}', './index.html'],
  theme: {
    extend: {
      colors: {
        claude: {
          bg: '#0F0F0F',
          surface: '#1A1A1A',
          card: '#242424',
          border: '#3A3A3A',
          orange: '#CC785C',
          'orange-light': '#E8926E',
          'orange-dim': 'rgba(204, 120, 92, 0.2)',
          text: '#ECECEC',
          dim: '#9A9A9A',
          bright: '#FFFFFF',
          error: '#E05252',
          success: '#52A77C',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.5s ease-in-out infinite',
        'stream-dot': 'stream-dot 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
