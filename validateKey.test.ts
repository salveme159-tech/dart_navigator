import { afterEach, describe, expect, it } from "vitest";
import { validateDartApiKey } from "./realDartClient";

const KEY = "a".repeat(40);
const realFetch = (globalThis as any).fetch;
const setFetch = (impl: (...args: any[]) => Promise<any>) => { (globalThis as any).fetch = impl; };
const json = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("인증키 검증: 서버 미연결과 키 오류를 구분", () => {
  afterEach(() => { (globalThis as any).fetch = realFetch; delete (globalThis as any).window; });

  it("서버가 404(JSON 아님)를 주면 키 오류가 아니라 서버 연결 문제(network)로 본다", async () => {
    setFetch(() => Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error("not json"); } }));
    const r = await validateDartApiKey(KEY);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("network");
  });

  it("fetch 자체가 실패하면 network", async () => {
    setFetch(() => Promise.reject(new Error("Failed to fetch")));
    expect((await validateDartApiKey(KEY)).reason).toBe("network");
  });

  it("서버가 valid:false를 명시하면 invalid(저장 키 삭제 대상)", async () => {
    setFetch(() => json(200, { result: { data: { json: { valid: false, message: "등록되지 않은 키" } } } }));
    const r = await validateDartApiKey(KEY);
    expect(r.reason).toBe("invalid");
    expect(r.message).toContain("등록되지 않은 키");
  });

  it("서버가 valid:true면 성공", async () => {
    setFetch(() => json(200, { result: { data: { json: { valid: true, companyCount: 3000 } } } }));
    const r = await validateDartApiKey(KEY);
    expect(r.valid).toBe(true);
    expect(r.message).toContain("3,000");
  });

  it("GitHub Pages에서 서버 주소가 없으면 호출 전에 no-server로 안내한다", async () => {
    let called = false;
    setFetch(() => { called = true; return json(200, {}); });
    (globalThis as any).window = { location: { hostname: "salveme159-tech.github.io" } };
    const r = await validateDartApiKey(KEY);
    expect(r.reason).toBe("no-server");
    expect(r.message).toContain("VITE_API_BASE_URL");
    expect(called).toBe(false);
  });

  it("형식이 틀리면 format", async () => {
    expect((await validateDartApiKey("short")).reason).toBe("format");
  });
});
