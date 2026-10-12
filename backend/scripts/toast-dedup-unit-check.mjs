#!/usr/bin/env node
// Checks frontend/src/utils/toastDedup.js (P2-02) with a fake react-hot-toast and a fake clock.
// Run: node backend/scripts/toast-dedup-unit-check.mjs   (exit 1 on any failure)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const require = createRequire(path.join(root, 'frontend', 'package.json'))
const esbuild = require('esbuild')

const fakeToast = `
  export const calls = []
  const toast = (m, o) => { calls.push(['plain', m, o]); return 'x' }
  toast.error = (m, o) => { calls.push(['error', m, o]); return (o && o.id) || 'auto' }
  export default toast
`
const out = await esbuild.build({
  stdin: {
    contents: "export * from './toastDedup.js'; export { default as __toast, calls as __calls } from 'react-hot-toast'",
    resolveDir: path.join(root, 'frontend', 'src', 'utils'), loader: 'js',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'fake', setup(b) {
    b.onResolve({ filter: /^react-hot-toast$/ }, () => ({ path: 'fake', namespace: 'fake' }))
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: fakeToast, loader: 'js' }))
  } }],
})
const code = out.outputFiles[0].text
const mod = await import('data:text/javascript,' + encodeURIComponent(code))
const toast = mod.__toast, calls = mod.__calls

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, extra) } }
let t = 1000
mod.__resetToastDedupForTest(() => t)
const last = () => calls[calls.length - 1]

const id1 = mod.apiErrorToast('Server said no')
check('api toast gets fixed id', last()[2].id === 'api-error:Server said no' && id1 === 'api-error:Server said no')
mod.apiErrorToast('Server said no')
check('repeat of same failure reuses id', last()[2].id === id1)
t += 10
toast.error('Page text')
check('page toast inside window claims the id', last()[1] === 'Page text' && last()[2].id === id1)
toast.error('Second page toast')
check('claim is one-shot', !(last()[2] && last()[2].id))

mod.apiErrorToast('Boom')
t += 1501
toast.error('Late page toast')
check('no claim after the window', !(last()[2] && last()[2].id))

mod.apiErrorToast('Boom2')
t += 5
toast.error('Own id', { id: 'mine' })
check('caller id passes through untouched', last()[2].id === 'mine')
toast.error('Then page', { duration: 8000 })
check('options kept when claiming', last()[2].id === 'api-error:Boom2' && last()[2].duration === 8000)

check('no API error: plain toast unchanged', (toast.error('Validation'), last()[2] === undefined))
check('wrapper installs once', (mod.installToastDedup(), toast.error.__p202Dedup === true))
check('window constant 1500', mod.CLAIM_WINDOW_MS === 1500)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
