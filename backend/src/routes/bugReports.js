const express = require('express');
const { requireAuth } = require('../middleware/auth');

// Webhook router — no auth. HMAC signature verification lives on the handler
// itself (added in a later step). Mounted BEFORE the authed router so that
// requests to /webhook/sarvam are served without going through requireAuth.
const webhookRouter = express.Router();

webhookRouter.post('/webhook/sarvam', (req, res) => {
  res.status(501).json({ error: 'not_implemented', endpoint: 'webhook_sarvam' });
});

// Authed router — all other /api/bug-reports/* paths. requireAuth is applied
// at the router level so mount-site code doesn't need to remember to wrap it.
const authedRouter = express.Router();
authedRouter.use(requireAuth);

function stub(name) {
  return (req, res) => res.status(501).json({ error: 'not_implemented', endpoint: name });
}

authedRouter.post ('/',                       stub('create'));
authedRouter.get  ('/',                       stub('list'));
authedRouter.get  ('/:id',                    stub('read'));
authedRouter.patch('/:id',                    stub('update'));
authedRouter.get  ('/:id/attachment/:kind',   stub('attachment'));

module.exports = { authedRouter, webhookRouter };
