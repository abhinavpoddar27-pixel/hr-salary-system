// P2-08 useDraft harness — a tiny form that uses the real hook. Test data is fictional.
import React from 'react'
import { createRoot } from 'react-dom/client'
import useDraft, { DraftRestoredBanner } from '../../../frontend/src/hooks/useDraft.js'
import { allowForcedUnload } from '../../../frontend/src/utils/sessionReturn.js'

const h = React.createElement
const START = { note: '', days: '' }

function Form() {
  const d = useDraft('harness-form', START)
  window.__draft = { dirty: d.dirty, restored: d.restored, value: d.value }
  const field = (name) => h('input', {
    'data-testid': name, 'aria-label': name, value: d.value[name],
    onChange: (e) => d.setValue((v) => ({ ...v, [name]: e.target.value })),
  })
  return h('div', null,
    h(DraftRestoredBanner, { draft: d }),
    field('note'), field('days'),
    h('span', { 'data-testid': 'dirty' }, String(d.dirty)),
    h('button', { type: 'button', onClick: d.markSaved }, 'Save'),
    h('button', { type: 'button', onClick: d.clear }, 'Save and reset'),
    h('button', { type: 'button', onClick: () => { allowForcedUnload(); window.location.href = '/other.html' } }, 'Forced leave'),
  )
}

function App() {
  const [shown, setShown] = React.useState(true)
  return h('div', null,
    h('button', { type: 'button', onClick: () => setShown((s) => !s) }, shown ? 'Unmount form' : 'Mount form'),
    shown ? h(Form) : null)
}

createRoot(document.getElementById('root')).render(h(App))
