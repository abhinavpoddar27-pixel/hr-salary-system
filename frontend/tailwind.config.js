/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a'
        },
        surface: {
          DEFAULT: '#f8fafc',
          elevated: 'rgba(255,255,255,0.85)',
          glass: 'rgba(255,255,255,0.65)',
          overlay: 'rgba(15,23,42,0.5)',
        },
        present: '#16a34a',
        absent: '#dc2626',
        halfday: '#d97706',
        nightshift: '#7c3aed',
        weekoff: '#6b7280',
        corrected: '#b45309'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      },
      boxShadow: {
        'glass-sm': '0 1px 4px 0 rgba(0,0,0,0.04)',
        'glass': '0 4px 24px -4px rgba(0,0,0,0.06), 0 1px 2px 0 rgba(0,0,0,0.04)',
        'glass-lg': '0 8px 40px -8px rgba(0,0,0,0.08), 0 2px 6px 0 rgba(0,0,0,0.04)',
        'glass-xl': '0 16px 56px -12px rgba(0,0,0,0.1), 0 4px 12px 0 rgba(0,0,0,0.04)',
        'inner-sm': 'inset 0 1px 2px 0 rgba(0,0,0,0.05)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulse2: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'slide-down': 'slideDown 0.25s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 2s infinite linear',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-slow': 'pulse2 2s ease-in-out infinite',
      },
      screens: {
        '3xl': '1920px',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
    }
  },
  plugins: []
}
