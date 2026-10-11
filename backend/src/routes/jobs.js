const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/roles'); // P2-11 role guards
const { enqueue, getJob } = require('../services/jobQueue');

router.post('/', requireAdmin, (req, res) => {
  const { type, params } = req.body;
  if (!type) return res.status(400).json({ success: false, error: 'type is required' });
  const jobId = enqueue(type, params || {});
  res.json({ success: true, jobId });
});

router.get('/:id', (req, res) => {
  const job = getJob(parseInt(req.params.id));
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  res.json({ success: true, data: job });
});

module.exports = router;
