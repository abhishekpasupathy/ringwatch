import { retryDatabaseOperation } from "../lib/retry-db";

async function main() {
  let attempts = 0;
  const result = await retryDatabaseOperation(
    async () => {
      attempts++;
      if (attempts < 3) {
        const error = Object.assign(new Error("Server has closed the connection."), {
          code: "P1017",
        });
        throw error;
      }
      return "ok";
    },
    { retries: 3, baseDelayMs: 1 }
  );

  if (result !== "ok" || attempts !== 3) {
    throw new Error(`FAIL: expected 3 attempts and ok result; got ${attempts} attempts`);
  }

  console.log("PASS: transient Prisma connection failures are retried");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
