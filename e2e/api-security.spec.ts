import { expect, test } from "@playwright/test";
import { signupFresh, writeAndEvaluate } from "./helpers";

test("API requires authentication", async ({ request }) => {
  const r = await request.get("/api/attempts");
  expect(r.status()).toBe(401);
});

test("P1: model answer is 403 ATTEMPT_REQUIRED before an attempt", async ({ page }) => {
  await signupFresh(page);
  const r = await page.request.get("/api/questions/gs2-rti-accountability/model-answer");
  expect(r.status()).toBe(403);
  expect((await r.json()).error.code).toBe("ATTEMPT_REQUIRED");
});

test("one student cannot read another student's attempt or hints", async ({ browser }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  await signupFresh(pa, "Alice");
  const attemptId = await writeAndEvaluate(pa);
  expect((await pa.request.get(`/api/attempts/${attemptId}`)).status()).toBe(200);

  const b = await browser.newContext();
  const pb = await b.newPage();
  await signupFresh(pb, "Bob");
  expect((await pb.request.get(`/api/attempts/${attemptId}`)).status()).toBe(404);
  expect((await pb.request.get(`/api/attempts/${attemptId}/hints`)).status()).toBe(404);
  expect((await pb.request.get(`/api/attempts/${attemptId}/evaluation`)).status()).toBe(404);
  await pb.goto(`/attempt/${attemptId}`);
  await expect(pb.getByText(/went off-topic/)).toBeVisible();
  await a.close();
  await b.close();
});

test("cross-site POSTs are rejected", async ({ page }) => {
  await signupFresh(page);
  const r = await page.request.post("/api/attempts", { data: { question_id: "gs2-rti-accountability", mode: "typed" }, headers: { origin: "https://evil.example" } });
  expect(r.status()).toBe(403);
  expect((await r.json()).error.code).toBe("BAD_ORIGIN");
});

test("session cookie is httpOnly and SameSite=Lax; security headers present", async ({ page, context }) => {
  await signupFresh(page);
  const c = (await context.cookies()).find((x) => x.name === "mmw_session")!;
  expect(c.httpOnly).toBe(true);
  expect(c.sameSite).toBe("Lax");
  const r = await page.request.get("/how-we-evaluate");
  expect(r.headers()["x-frame-options"]).toBe("DENY");
  expect(r.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("upload validation rejects a renamed executable", async ({ page }) => {
  await signupFresh(page);
  const created = await page.request.post("/api/attempts", { data: { question_id: "gs3-monetary-transmission", mode: "handwritten" } });
  const { attempt } = await created.json();
  const r = await page.request.post(`/api/attempts/${attempt.id}/uploads`, {
    multipart: { file: { name: "answer.jpg", mimeType: "image/jpeg", buffer: Buffer.from("MZ\x90\x00 not really an image") } },
  });
  expect(r.status()).toBe(422);
});

test("non-admins cannot use reviewer endpoints", async ({ page }) => {
  await signupFresh(page);
  const r = await page.request.post("/api/admin/qotd", { data: { exam_code: "x", date: "2026-10-17", question_id: "x" } });
  expect(r.status()).toBe(403);
});
