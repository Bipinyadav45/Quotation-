import { useCallback, useEffect, useState } from 'react'

/**
 * The whole data-fetching layer. Five screens and five users do not need a
 * caching library; they need `fetch` with the error handling written once.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * A request that never reached the server at all.
 *
 * `fetch` rejects with a bare "Failed to fetch" for every one of these — the
 * server not running, the dev proxy pointed at the wrong port, the machine
 * asleep — and that sentence went straight to the screen. It says nothing a
 * desk can act on, and it was on screen for a whole afternoon while the actual
 * fault was a proxy aimed at a port with nothing on it.
 *
 * Status 0, so callers can tell "never arrived" from "arrived and was refused".
 */
function unreachable(err: unknown): ApiError {
  const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
  return new ApiError(
    `Could not reach the Quotation Desk server${detail}. It may have stopped — ` +
      'check the window it is running in, then try again.',
    0,
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (err) {
    throw unreachable(err)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    throw new ApiError(
      (body.error as string) ?? `${res.status} ${res.statusText}`,
      res.status,
      body.issues as Array<{ path: string; message: string }> | undefined,
    )
  }

  return res.json() as Promise<T>
}

export const apiGet = <T,>(path: string) => request<T>(path)

export const apiPost = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const apiPut = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const apiDelete = <T,>(path: string) => request<T>(path, { method: 'DELETE' })

/** Download a binary response (a .docx or .pdf) and hand it to the browser. */
export async function apiDownload(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as Record<string, unknown>)
    throw new ApiError((detail.error as string) ?? `${res.status} ${res.statusText}`, res.status)
  }

  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'download'

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type ApiState<T> = { data: T | null; error: Error | null; loading: boolean }

/** GET-on-mount with a manual reload. Deliberately small. */
export function useApi<T>(path: string): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true })

  const load = useCallback(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    apiGet<T>(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: Error) => !cancelled && setState({ data: null, error, loading: false }))
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(load, [load])

  return { ...state, reload: load }
}
