import { Queue, Worker } from "bullmq";

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
};

// Queue for future position monitoring tasks
export const monitorQueue = new Queue("position-monitor", { connection });

// Worker stub (will implement position scanning + HF logic later)
new Worker(
  "position-monitor",
  async (job) => {
    // Placeholder logic:
    console.log("Processing job", job.id, job.data);
  },
  { connection },
);

console.log("Worker started for queue: position-monitor");
