/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/AsemicApp.tsx',
    './src/standalone/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Cormorant Infant', 'serif']
      }
    }
  },
  plugins: [
    function ({ addVariant, e }) {
      addVariant('touch', '@media (hover: none)')
    }
  ]
}
