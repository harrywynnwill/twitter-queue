import express from "express";
import { tweetQueue } from "./queue";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

app.post("/tweet", async (req, res) => {
  console.log("/tweet")
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Invalid or missing 'message'" });
  }

  await tweetQueue.add("sendTweet", { message });
  res.json({ success: true, enqueued: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
