import { randomBytes } from "node:crypto"; // idempotency keys
import { expect, test, type APIRequestContext } from "@playwright/test"; // test runner
import { API_URL, deviceRequest } from "./device"; // signed terminal calls

// Prerequisites (README "Smoke test"): backend on :8000 with `python -m scripts.seed` run,
// student 220000001 enrolled in slot 1 of the terminal, and DEVICE_ID / DEVICE_SECRET from the seed output in the environment.
const DEVICE_ID = Number(process.env.DEVICE_ID); // terminal under test
const DEVICE_SECRET = process.env.DEVICE_SECRET ?? ""; // its HMAC secret
const EMAIL = process.env.E2E_LECTURER_EMAIL || "lecturer@tut.ac.za"; // seed lecturer (dev only)
const PASSWORD = process.env.E2E_LECTURER_PASSWORD || "ChangeMe123"; // seed password (dev only)
const SLOT = Number(process.env.E2E_SLOT || 1); // sensor slot holding the enrolled student
const STUDENT = process.env.E2E_STUDENT_NUMBER || "220000001"; // who is in that slot

async function apiToken(request: APIRequestContext): Promise<string> { // log in through the API (for setup/cleanup)
  const res = await request.post(`${API_URL}/auth/login`, { form: { username: EMAIL, password: PASSWORD } }); // form-encoded, like the dashboard
  expect(res.ok(), "lecturer login failed — did you run python -m scripts.seed?").toBeTruthy(); // clear failure message
  return (await res.json()).access_token as string; // bearer token
}

async function closeOpenSessionsOnDevice(request: APIRequestContext, token: string): Promise<void> { // free the terminal (one open session per device)
  const headers = { Authorization: `Bearer ${token}` }; // auth
  const list = await (await request.get(`${API_URL}/lecturer/sessions?open_only=true&limit=50`, { headers })).json(); // open sessions I can see
  for (const s of list.items as { id: number; device_id: number }[]) { // each one
    if (s.device_id === DEVICE_ID) await request.post(`${API_URL}/lecturer/sessions/${s.id}/close`, { headers }); // close it
  }
}

test("lecturer opens a session and a fingerprint scan appears on the live roster", async ({ page, request }) => { // the §10 demo in one test
  test.skip(!DEVICE_ID || !DEVICE_SECRET, "Set DEVICE_ID and DEVICE_SECRET (printed by `python -m scripts.seed`)."); // can't sign terminal calls without them

  const token = await apiToken(request); // setup token
  await closeOpenSessionsOnDevice(request, token); // start from a free terminal
  const devices = await (await request.get(`${API_URL}/lecturer/devices`, { headers: { Authorization: `Bearer ${token}` } })).json(); // terminal names
  const deviceName = (devices as { id: number; name: string }[]).find((d) => d.id === DEVICE_ID)?.name; // e.g. terminal-01
  expect(deviceName, `terminal ${DEVICE_ID} not found or disabled`).toBeTruthy(); // fail clearly

  // 1. sign in through the UI
  await page.goto("/login"); // login page
  await page.getByLabel("Email address").fill(EMAIL); // email
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD); // password
  await page.getByRole("button", { name: "Sign in" }).click(); // submit
  await expect(page).toHaveURL(/\/lecturer$/); // landed on Sessions

  // 2. open a session through the dialog
  await page.getByRole("button", { name: "Open session" }).first().click(); // header button
  const dialog = page.getByRole("dialog", { name: "Open session" }); // the modal
  const course = dialog.getByRole("combobox", { name: "Course" }); // course picker
  if ((await course.textContent())?.includes("Choose a course")) { // not preselected (more than one course)
    await course.click(); // open it
    await page.getByRole("option").first().click(); // take the first course
  }
  await dialog.getByRole("combobox", { name: "Terminal" }).click(); // terminal picker
  await page.getByRole("option", { name: new RegExp(deviceName as string) }).click(); // our terminal
  await dialog.getByLabel("Venue").fill("Playwright smoke test"); // venue
  await dialog.getByRole("button", { name: "Start session" }).click(); // POST /lecturer/sessions
  await expect(page).toHaveURL(/\/lecturer\/sessions\/\d+/); // live page
  const sessionId = Number(page.url().split("/").pop()?.split("?")[0]); // new session id

  try { // always close the session afterwards, even if an assertion fails
    // 3. the terminal sees the session
    const current = await deviceRequest(request, DEVICE_ID, DEVICE_SECRET, "GET", "/device/session"); // signed GET
    expect((await current.json()).session_id).toBe(sessionId); // same session

    // 4. a fingerprint scan
    const scan = await deviceRequest(request, DEVICE_ID, DEVICE_SECRET, "POST", "/device/attendance", { // signed POST
      idempotency_key: randomBytes(16).toString("hex"), // fresh event
      session_id: sessionId, // this session
      slot_number: SLOT, // enrolled slot
      confidence: 120, // strong match
    });
    expect((await scan.json()).status).toBe("recorded"); // saved

    // 5. the row turns present without reloading (3 s polling)
    const row = page.getByRole("row", { name: new RegExp(STUDENT) }); // the student's row
    await expect(row.getByText("Present", { exact: true })).toBeVisible(); // live update arrived
    await expect(row.getByText("Fingerprint", { exact: true })).toBeVisible(); // method badge
  } finally { // cleanup
    await request.post(`${API_URL}/lecturer/sessions/${sessionId}/close`, { headers: { Authorization: `Bearer ${token}` } }); // leave the terminal free
  }
});
