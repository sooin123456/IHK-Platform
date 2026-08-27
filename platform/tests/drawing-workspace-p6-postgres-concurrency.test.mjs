import test from "node:test";

const required = process.env.P6_REAL_POSTGRES_REQUIRED === "1";
const databaseUrl = process.env.P6_REAL_POSTGRES_DATABASE_URL;

test(
  "P6 real PostgreSQL concurrency authority is explicitly configured",
  { skip: !required },
  () => {
    if (!databaseUrl) throw new Error("P6 real PostgreSQL gate is UNEXECUTED");
  },
);
