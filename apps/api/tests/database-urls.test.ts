import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl, describeDatabase, isPooledConnection, withStrictSsl } from "../src/db/pool.ts";

const neonMainPooled = "postgresql://u:secret@ep-main-123-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require";
const neonMainDirect = "postgresql://u:secret@ep-main-123.eu-west-2.aws.neon.tech/neondb?sslmode=require";
const neonTestDirect = "postgresql://u:secret@ep-test-456.eu-west-2.aws.neon.tech/neondb?sslmode=require";

describe("database URL safety", () => {
  it("recognises Neon pooled endpoints", () => {
    expect(isPooledConnection(neonMainPooled)).toBe(true);
    expect(isPooledConnection(neonMainDirect)).toBe(false);
  });

  it("never includes the password in log descriptions", () => {
    expect(describeDatabase(neonMainDirect)).toBe("ep-main-123.eu-west-2.aws.neon.tech:5432/neondb");
  });

  it("accepts a direct test URL on a different branch", () => {
    expect(() => assertSafeTestDatabaseUrl(neonTestDirect, neonMainPooled)).not.toThrow();
  });

  it("refuses a pooled test URL", () => {
    expect(() => assertSafeTestDatabaseUrl(neonMainPooled.replace("ep-main-123", "ep-test-456"), neonMainPooled)).toThrow(/direct/);
  });

  it("refuses to run tests against the main branch", () => {
    expect(() => assertSafeTestDatabaseUrl(neonMainDirect, neonMainPooled)).toThrow(/separate Neon branch/);
  });

  it("allows a local server, where tests use their own throwaway databases", () => {
    expect(() => assertSafeTestDatabaseUrl("postgresql://u:p@localhost:5432/postgres", "postgresql://u:p@localhost:5432/wagewise")).not.toThrow();
  });

  it("makes Neon's sslmode=require explicitly strict, keeping other parameters", () => {
    const strict = new URL(withStrictSsl(`${neonMainDirect}&channel_binding=require`));
    expect(strict.searchParams.get("sslmode")).toBe("verify-full");
    expect(strict.searchParams.get("channel_binding")).toBe("require");
  });
});
