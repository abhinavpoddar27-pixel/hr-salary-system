// Same Tailwind setup as the app, plus this harness folder in the content globs.
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import base from '../tailwind.config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export default {
  plugins: [
    tailwindcss({ ...base, content: [path.join(here, '..', 'src/**/*.{js,jsx}'), path.join(here, '*.{html,jsx}')] }),
    autoprefixer(),
  ],
}
