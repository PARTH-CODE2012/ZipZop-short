import express from 'express';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/kinetic/create', authenticate, async (req, res) => {
  try {
    const { filename, captions } = req.body;

    res.json({
      ok: true,
      message: 'Kinetic captions created'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kinetic/preview', authenticate, async (req, res) => {
  try {
    const { filename } = req.body;

    res.json({
      ok: true,
      preview: '/preview.mp4'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
