/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Geist"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        bg:         '#0a0a0b',
        surface:    '#131316',
        surface2:   '#1a1a1e',
        border:     '#26262b',
        'border-dim':'#1d1d22',
        text:       '#e8e6e1',
        'text-dim': '#8c8a85',
        'text-mute':'#52504c',
        amber:      '#f59e0b',
        'amber-dim':'#b87806',
        cyan:       '#06b6d4',
        green:      '#10b981',
        red:        '#ef4444',
        yellow:     '#fbbf24',
        violet:     '#8b5cf6',
      },
      boxShadow: {
        'glow-amber': '0 0 30px -8px rgba(245, 158, 11, 0.6)',
        'glow-green': '0 0 20px -6px rgba(16, 185, 129, 0.5)',
        'inset-line': 'inset 0 1px 0 0 rgba(255,255,255,0.04)',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.5', transform: 'scale(0.85)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up':   'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'sweep':     'sweep 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
