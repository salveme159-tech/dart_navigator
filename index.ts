import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "256kb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  // Lightweight in-memory rate limit for the public DART surface.
  // This is intentionally simple for the competition demo; production deployments
  // should move the counter to a shared store.
  const requests = new Map<string, { start: number; count: number }>();
  app.use("/api/trpc", (req, res, next) => {
    const now = Date.now();
    const ip = req.socket.remoteAddress ?? "unknown";
    const entry = requests.get(ip);
    if (!entry || now - entry.start >= 60_000) {
      requests.set(ip, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > 60) {
      res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
      return;
    }
    next();
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
