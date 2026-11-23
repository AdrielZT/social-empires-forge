import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("sef-server health", () => {
  it("responds with 200 and version metadata", async () => {
    const app = await createServer();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.targetVersion).toBe("1.4.07");
    await app.close();
  });
});
