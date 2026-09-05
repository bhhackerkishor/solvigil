import { Redis } from "@upstash/redis";

// Hardcode your Upstash credentials directly for testing
const redis = new Redis({
  url: "https://super-moray-92945.upstash.io", // Replace with your Upstash REST URL
  token: "gQAAAAAAAWsRAAIgcDE2OWU0NzBlYjNjMjQ0ZjQ5YjJkM2ZkYWFmOWUyNTNlZQ", // Replace with your Upstash REST Token
});

async function testUpstashConnection() {
  console.log("🔄 Testing Upstash Redis Connection (HTTP)...");

  try {
    // 1. Ping the server
    const pingResult = await redis.ping();
    console.log("✅ PING response:", pingResult); // Expected output: "PONG"

    // 2. Write a test key with a 60-second TTL
    const testKey = "solvigil:test:key";
    const testValue = { status: "OK", timestamp: new Date().toISOString() };
    await redis.set(testKey, JSON.stringify(testValue), { ex: 60 });
    console.log(`✅ Set key "${testKey}" successfully.`);

    // 3. Read the key back
    const retrieved = await redis.get(testKey);
    console.log("✅ Retrieved value:", retrieved);

    // 4. Delete the test key
    await redis.del(testKey);
    console.log("✅ Deleted test key.");

    console.log("\n🎉 Upstash Redis connection is working perfectly!");
  } catch (error) {
    console.error("❌ Upstash Redis Connection Error:", error);
  }
}

testUpstashConnection();