// P2-01 harness: exercises Modal / ConfirmDialog `busy` and the useConfirm queue, which no app page uses yet.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Modal from '../src/components/ui/Modal'
import ConfirmDialog from '../src/components/ui/ConfirmDialog'
import { confirmDialog } from '../src/hooks/useConfirm'

window.__log = []
const log = (x) => window.__log.push(x)

function App() {
  const [busy, setBusy] = useState(true)
  const [which, setWhich] = useState(null)
  const [variant, setVariant] = useState('danger')
  window.__setBusy = setBusy
  window.__show = setWhich
  window.__variant = setVariant
  window.__confirm = (o) => confirmDialog(o).then(v => { log(`answer:${o.title}:${v}`); return v })
  if (which === 'modal') {
    return (
      <Modal title="Busy modal" busy={busy} onClose={() => { log('modal-close'); setWhich(null) }}>
        <button>inside</button>
      </Modal>
    )
  }
  if (which === 'confirm') {
    return (
      <ConfirmDialog title="Busy confirm" message="Message" busy={busy} variant={variant}
        onConfirm={() => { log('confirm'); setWhich(null) }}
        onCancel={() => { log('cancel'); setWhich(null) }} />
    )
  }
  return null
}

createRoot(document.getElementById('root')).render(<App />)
