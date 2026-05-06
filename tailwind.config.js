/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/panel/**/*.{tsx,ts,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        st: {
          bg: 'var(--st-bg)',
          'bg-surface': 'var(--st-bg-surface)',
          'bg-elevated': 'var(--st-bg-elevated)',
          'text-primary': 'var(--st-text-primary)',
          'text-secondary': 'var(--st-text-secondary)',
          'text-tertiary': 'var(--st-text-tertiary)',
          accent: 'var(--st-accent)',
          'accent-contrast': 'var(--st-accent-contrast)',
          'accent-light': 'var(--st-accent-light)',
          'accent-hover': 'var(--st-accent-hover)',
          'accent-faint': 'var(--st-accent-faint)',
          border: 'var(--st-border)',
          'border-light': 'var(--st-border-light)',
          'source-accent': 'var(--st-source-accent)',
          error: 'var(--st-error)',
          'error-bg': 'var(--st-error-bg)',
          'error-border': 'var(--st-error-border)',
          'error-text': 'var(--st-error-text)',
          success: 'var(--st-success)',
          'success-bg': 'var(--st-success-bg)',
        },
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
