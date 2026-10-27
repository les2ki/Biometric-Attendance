import type { TokenOut } from "@/lib/types"; // login response shape

const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL; // inlined at build time from .env.local
if (!RAW_API_URL) { // missing env var = every request would fail mysteriously
  throw new Error("NEXT_PUBLIC_API_URL is not set. Copy Frontend/.env.example to Frontend/.env.local."); // fail loudly at import
}
export const API_URL = RAW_API_URL.replace(/\/+$/, ""); // e.g. http://127.0.0.1:8000 (no trailing slash)

export class ApiError extends Error { // every failed request becomes one of these
  status: number; // HTTP status (0 = network failure)
  code: string; // machine-readable code from the backend, e.g. "device_busy"
  fieldErrors?: Record<string, string>; // 422 validation messages keyed by field name
  row?: number; // CSV import errors point at a row
  extra?: Record<string, unknown>; // any other keys from the JSON error body (e.g. { row: 7 })

  constructor(status: number, code: string, fieldErrors?: Record<string, string>, row?: number, extra?: Record<string, unknown>) { // build an error
    super(code); // message = code (handy in logs)
    this.name = "ApiError"; // shows up in stack traces
    this.status = status; // keep the status
    this.code = code; // keep the code
    this.fieldErrors = fieldErrors; // keep field errors (if any)
    this.row = row; // keep the CSV row (if any)
    this.extra = extra; // keep the rest of the body
  }
}

let onUnauthorized: (() => void) | null = null; // set by the AuthProvider: logs the user out
export function setUnauthorizedHandler(handler: (() => void) | null): void { // register / clear the 401 handler
  onUnauthorized = handler; // remember it
}

interface ValidationItem { loc?: unknown[]; msg?: string; } // one entry of FastAPI's 422 detail list

async function toApiError(res: Response): Promise<ApiError> { // turn a non-2xx response into an ApiError
  let body: unknown = null; // parsed JSON body (if any)
  try { // the body may be empty or not JSON
    body = await res.json(); // FastAPI errors are JSON
  } catch { // not JSON
    body = null; // fall through to the generic code
  }
  const record = (body ?? {}) as { detail?: unknown; row?: unknown }; // loosely typed view of the body
  if (typeof record.detail === "string") { // {"detail": "device_busy"}
    const row = typeof record.row === "number" ? record.row : undefined; // {"detail": "bad_csv", "row": 3}
    const { detail, ...rest } = record as Record<string, unknown>; // everything except detail
    return new ApiError(res.status, String(detail), undefined, row, Object.keys(rest).length ? rest : undefined); // the normal case
  }
  if (Array.isArray(record.detail)) { // 422: {"detail": [{"loc": [...], "msg": "..."}]}
    const fieldErrors: Record<string, string> = {}; // field name -> message
    for (const item of record.detail as ValidationItem[]) { // each invalid field
      const loc = Array.isArray(item.loc) ? item.loc : []; // e.g. ["body", "venue"]
      const field = String(loc[loc.length - 1] ?? "form"); // last element is the field name
      fieldErrors[field] = item.msg ?? "Invalid value"; // keep the first useful message
    }
    return new ApiError(res.status, "validation_error", fieldErrors); // highlighted fields
  }
  return new ApiError(res.status, `http_${res.status}`); // unexpected shape
}

export interface FetchOptions { // options for apiFetch
  method?: string; // GET by default
  body?: unknown; // JSON-serialisable object, or FormData for uploads
  token?: string | null; // bearer token (omit for public endpoints)
  signal?: AbortSignal; // lets TanStack Query cancel stale requests
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> { // the ONE way components talk to the API
  const headers: Record<string, string> = {}; // request headers
  let body: BodyInit | undefined; // request body
  if (opts.body instanceof FormData) { // file upload
    body = opts.body; // the browser sets the multipart boundary itself
  } else if (opts.body !== undefined) { // JSON body
    headers["Content-Type"] = "application/json"; // tell FastAPI it's JSON
    body = JSON.stringify(opts.body); // serialise
  }
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`; // authenticate
  let res: Response; // the response
  try { // fetch only throws on network failure
    res = await fetch(API_URL + path, { method: opts.method ?? "GET", headers, body, signal: opts.signal }); // send it
  } catch (err) { // backend down, CORS blocked, or request aborted
    if (err instanceof DOMException && err.name === "AbortError") throw err; // let TanStack Query see the abort
    throw new ApiError(0, "network_error"); // friendly "is the backend running?" message
  }
  if (res.status === 204) return undefined as T; // no content (e.g. change password)
  if (!res.ok) { // 4xx / 5xx
    const error = await toApiError(res); // parse the error body
    if (res.status === 401 && opts.token && onUnauthorized) onUnauthorized(); // expired/invalid token → global logout
    throw error; // caller shows a toast
  }
  return (await res.json()) as T; // typed JSON body
}

export async function apiUpload<T>(path: string, file: File, token: string | null): Promise<T> { // multipart upload (field name "file")
  const form = new FormData(); // the browser sets the multipart boundary (no Content-Type header from us)
  form.append("file", file); // FastAPI's UploadFile parameter is called "file"
  return apiFetch<T>(path, { method: "POST", body: form, token }); // apiFetch passes FormData through untouched
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string { // build "?a=1&b=2", skipping empty values
  const search = new URLSearchParams(); // encoder
  for (const [key, value] of Object.entries(params)) { // each parameter
    if (value === undefined || value === null || value === "") continue; // leave it out
    search.set(key, String(value)); // add it
  }
  const text = search.toString(); // "a=1&b=2"
  return text ? `?${text}` : ""; // empty when nothing was set
}

export async function loginRequest(email: string, password: string): Promise<TokenOut> { // POST /auth/login as a FORM (OAuth2PasswordRequestForm)
  let res: Response; // the response
  try { // network failure throws
    res = await fetch(`${API_URL}/auth/login`, { // the login endpoint
      method: "POST", // form post
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, // NOT JSON
      body: new URLSearchParams({ username: email, password }), // OAuth2 field names
    });
  } catch { // backend unreachable
    throw new ApiError(0, "network_error"); // friendly message
  }
  if (!res.ok) throw await toApiError(res); // usually 401 invalid_credentials
  return (await res.json()) as TokenOut; // token + user
}

function filenameFrom(disposition: string | null): string | null { // read the filename out of Content-Disposition
  if (!disposition) return null; // header missing (or not exposed by CORS)
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition); // attachment; filename="x.csv"
  return match ? decodeURIComponent(match[1]) : null; // the name, or nothing
}

export async function downloadFile(path: string, token: string): Promise<string> { // authenticated file download; returns the filename
  let res: Response; // the response
  try { // network failure throws
    res = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${token}` } }); // fetch with the token
  } catch { // backend unreachable
    throw new ApiError(0, "network_error"); // friendly message
  }
  if (!res.ok) { // 4xx / 5xx
    const error = await toApiError(res); // parse
    if (res.status === 401 && onUnauthorized) onUnauthorized(); // expired token → logout
    throw error; // caller shows a toast
  }
  const filename = filenameFrom(res.headers.get("Content-Disposition")) ?? "attendance.csv"; // server-chosen name
  saveBlob(await res.blob(), filename); // hand it to the browser
  return filename; // for the success toast
}

export function saveBlob(blob: Blob, filename: string): void { // trigger a browser download for in-memory data
  const url = URL.createObjectURL(blob); // temporary object URL
  const link = document.createElement("a"); // invisible link
  link.href = url; // point at the blob
  link.download = filename; // download instead of navigate
  document.body.appendChild(link); // Firefox needs it in the DOM
  link.click(); // start the download
  link.remove(); // clean up the element
  setTimeout(() => URL.revokeObjectURL(url), 1000); // free the memory once the download has started
}
