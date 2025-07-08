import { Worker } from "bullmq";
import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";

dotenv.config();

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY!,
  appSecret: process.env.TWITTER_APP_SECRET!,
  accessToken: process.env.TWITTER_ACCESS_TOKEN!,
  accessSecret: process.env.TWITTER_ACCESS_SECRET!,
});

const connection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT)
};

const worker = new Worker(
  "tweetQueue",
  async (job) => {
    console.log("Posting tweet:", job.data.message);
    await twitterClient.v2.tweet(job.data.message);
    console.log("Tweet posted successfully");
  },
  { connection }
);

console.log("Worker started and listening for jobs...");

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} failed:`, err.message);
});
