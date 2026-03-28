import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import scoresRouter from './routes/scores.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const mongoUri = process.env.MONGO_URI || 'mongodb+srv://proakiefroakie_db_user:thrtrvbzwQLT4Rye@cluster0.h9o8fc9.mongodb.net/?retryWrites=true&w=majority';
const port = Number(process.env.PORT || 4000);

mongoose.connect(mongoUri)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

app.use('/api/scores', scoresRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
