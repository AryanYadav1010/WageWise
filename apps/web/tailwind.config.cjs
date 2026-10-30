const color = name => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: color('page'), raised: color('raised'), ink: color('ink'), muted: color('muted'), faint: color('faint'),
        accent: color('accent'), 'on-accent': color('on-accent'), danger: color('danger'), warn: color('warn')
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Newsreader Variable"', 'ui-serif', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
};
