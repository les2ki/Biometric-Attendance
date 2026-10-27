import { createHmac, randomBytes } from "node:crypto"; // HMAC-SHA256 + random nonces
import type { APIRequestContext } from "@playwright/test"; // Playwright's HTTP client

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, ""); // FastAPI base URL

export function computeSignature(secret: string, method: string, path: string, timestamp: number, nonce: string, body: string): string { // same recipe as Backend/app/security.py
  const message = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n` + body; // exact string the terminal signs
  return createHmac("sha256", secret).update(message).digest("hex"); // lowercase hex
}

export async function deviceRequest(request: APIRequestContext, deviceId: number, secret: string, method: "GET" | "POST", path: string, payload?: unknown) { // one signed terminal call (like scripts/fake_terminal.py)
  const body = payload === undefined ? "" : JSON.stringify(payload); // the exact bytes that get signed
  const timestamp = Math.floor(Date.now() / 1000); // Unix seconds
  const nonce = randomBytes(16).toString("hex"); // single-use nonce
  const headers = { // the four auth headers + JSON type
    "X-Device-Id": String(deviceId), // which terminal
    "X-Timestamp": String(timestamp), // freshness
    "X-Nonce": nonce, // replay protection
    "X-Signature": computeSignature(secret, method, path, timestamp, nonce, body), // HMAC
    "Content-Type": "application/json", // body type
  };
  return method === "GET" ? request.get(API_URL + path, { headers }) : request.post(API_URL + path, { headers, data: body }); // send the signed bytes as-is
}
