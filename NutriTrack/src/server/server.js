
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('錯誤：請在 .env 設定 GEMINI_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NutriTrack API',
  });
});

app.get('/test-gemini', async (req, res) => {
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: '請只回覆：Gemini 連線成功',
    });

    res.json({
      success: true,
      message: result.text,
    });
  } catch (error) {
    console.error('Gemini API 呼叫失敗：', error.message);

    res.status(502).json({
      success: false,
      message: 'Gemini API 呼叫失敗，請檢查 API Key、模型可用性與免費額度。',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NutriTrack API 已啟動：http://localhost:${PORT}`);
});
