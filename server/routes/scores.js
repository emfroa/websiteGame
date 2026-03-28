import { Router } from 'express';
import Score from '../models/Score.js';

const router = Router();

router.post('/', async (req, res) => {
  const { username, totalScore, totalTime, date } = req.body;
  if (!username || typeof totalScore !== 'number' || typeof totalTime !== 'number') {
    return res.status(400).json({ ok: false, message: 'Invalid payload' });
  }

  try {
    const score = new Score({
      username,
      totalScore,
      totalTime,
      date: date ? new Date(date) : undefined,
    });
    await score.save();
    return res.json({ ok: true, score });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const scores = await Score.find().sort({ totalScore: -1, date: -1 }).limit(20);
    return res.json({ ok: true, scores });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
