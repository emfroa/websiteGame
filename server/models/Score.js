import mongoose from 'mongoose';

const scoreSchema = new mongoose.Schema({
  username: { type: String, required: true },
  totalScore: { type: Number, required: true },
  totalTime: { type: Number, required: true },
  roundsSurvived: { type: Number, required: true },
  powerupHistory: { type: [String], default: [] },
  date: { type: Date, default: Date.now },
});

const Score = mongoose.model('Score', scoreSchema);

export default Score;
