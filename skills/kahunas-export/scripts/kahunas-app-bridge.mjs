// In-page bridge for the current Kahunas web app (https://<workspace>.kahunas.app).
//
// The app is a TanStack Start SPA. Data is loaded through server functions
// (`/_serverFn/<build-hash>`) whose responses are seroval-encoded and whose hashes
// change on every Kahunas deploy, so calling them directly is brittle. Instead this
// bridge:
//
//   1. navigates with the app's own router (`window.__TSR_ROUTER__`),
//   2. waits for TanStack Query to settle, and
//   3. reads the already-decoded data from the app's QueryClient cache.
//
// Pagination: list queries send `{ page, pageSize, ... }` inside the server-function
// payload. The bridge wraps `fetch` so that, while an override is active, `page` and
// `pageSize` in that payload are rewritten. Re-running a cached query's `queryFn`
// under an override returns any page at any size, decoded by the app itself.
//
// `installKahunasBridge` is serialized by Playwright and executed inside the page, so
// it must stay self-contained (no imports, no closure over module scope).

export function installKahunasBridge() {
  const VERSION = 3;
  if (window.__kx && window.__kx.version === VERSION) {
    return true;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const router = () => window.__TSR_ROUTER__;
  const queryClient = () => router()?.options?.context?.queryClient;

  // Rewrites fields inside a seroval-encoded server-function payload. Objects are encoded
  // as {t:10, p:{k:[keys], v:[values]}}; numbers as {t:0,s:n}; strings as {t:1,s:"..."}.
  // Only objects that contain every overridden key are touched.
  const rewritePayload = (text, override) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { text, applied: false };
    }
    const keys = Object.keys(override);
    let applied = false;
    const walk = (node) => {
      if (!node || typeof node !== "object") {
        return;
      }
      if (node.p && Array.isArray(node.p.k) && Array.isArray(node.p.v) && keys.every((key) => node.p.k.includes(key))) {
        for (const [key, value] of Object.entries(override)) {
          node.p.v[node.p.k.indexOf(key)] = typeof value === "number" ? { t: 0, s: value } : { t: 1, s: String(value) };
        }
        applied = true;
      }
      for (const child of Object.values(node)) {
        walk(child);
      }
    };
    walk(parsed);
    return { text: JSON.stringify(parsed), applied };
  };

  // The fetch wrapper is installed once per page, but always delegates to the latest
  // rewrite function so a newer bridge version takes effect without a reload.
  window.__kxRewrite = rewritePayload;
  if (!window.__kxOriginalFetch) {
    window.__kxOriginalFetch = window.fetch;
    window.fetch = function patchedFetch(input, init) {
      const rewritePayload = window.__kxRewrite;
      const override = window.__kxOverride;
      if (override) {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : null;
        if (rawUrl && rawUrl.includes("/_serverFn/")) {
          const url = new URL(rawUrl, location.href);
          const payload = url.searchParams.get("payload");
          if (payload) {
            const result = rewritePayload(payload, override);
            if (result.applied) {
              url.searchParams.set("payload", result.text);
              input = url.pathname + url.search;
              window.__kxOverrideHits += 1;
            }
          } else if (init && typeof init.body === "string") {
            const result = rewritePayload(init.body, override);
            if (result.applied) {
              init = { ...init, body: result.text };
              window.__kxOverrideHits += 1;
            }
          }
        }
      }
      return window.__kxOriginalFetch.call(this, input, init);
    };
  }

  const matchKey = (key, pattern) => {
    if (!Array.isArray(key) || key.length < pattern.length) {
      return false;
    }
    return pattern.every((expected, index) => {
      if (expected === null || expected === undefined) {
        return true;
      }
      const actual = key[index];
      if (typeof expected === "object" && "$ne" in expected) {
        return actual !== expected.$ne;
      }
      if (typeof expected === "object") {
        return actual && typeof actual === "object" && Object.entries(expected).every(([k, v]) => actual[k] === v);
      }
      return actual === expected;
    });
  };

  const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

  const settle = async (timeoutMs = 20000) => {
    const started = Date.now();
    await sleep(400);
    while (Date.now() - started < timeoutMs) {
      if (queryClient().isFetching() === 0) {
        await sleep(400);
        if (queryClient().isFetching() === 0) {
          return true;
        }
      }
      await sleep(250);
    }
    return false;
  };

  const allQueries = () => queryClient().getQueryCache().getAll();

  window.__kx = {
    version: VERSION,

    ready() {
      return Boolean(router() && queryClient());
    },

    location() {
      return { host: location.host, path: location.pathname };
    },

    routeIds() {
      return Object.keys(router()?.routesById || {});
    },

    async visit(to, params = {}, search = undefined) {
      const before = new Set(allQueries().map((query) => query.queryHash));
      await router().navigate({ to, params, search });
      const settled = await settle();
      const added = allQueries()
        .filter((query) => !before.has(query.queryHash))
        .map((query) => ({ key: query.queryKey, data: query.state.data, error: query.state.error ? String(query.state.error) : undefined }));
      return plain({ settled, path: location.pathname, added });
    },

    find(pattern) {
      return plain(allQueries()
        .filter((query) => matchKey(query.queryKey, pattern))
        .map((query) => ({ key: query.queryKey, data: query.state.data })));
    },

    // Re-runs a cached query's queryFn with fields of its server-function payload replaced.
    // Returns { data, applied } where applied tells whether the override hit the payload.
    async fetchWith(pattern, override) {
      const query = allQueries().find((candidate) => matchKey(candidate.queryKey, pattern) && candidate.options?.queryFn);
      if (!query) {
        return { data: null, applied: false, error: "query not in cache" };
      }
      await settle(5000);
      window.__kxOverrideHits = 0;
      window.__kxOverride = override;
      try {
        const data = await query.options.queryFn({
          queryKey: query.queryKey,
          signal: new AbortController().signal,
          meta: query.meta,
          client: queryClient()
        });
        return plain({ data, applied: window.__kxOverrideHits > 0 });
      } catch (error) {
        return { data: null, applied: window.__kxOverrideHits > 0, error: String(error?.message || error) };
      } finally {
        window.__kxOverride = null;
      }
    },

    async fetchPage(pattern, page, pageSize) {
      const result = await this.fetchWith(pattern, { page, pageSize });
      return result.data;
    },

    // Walks every page of a cached paginated query ({ page, pageCount, rows, totalRows }).
    async fetchAll(pattern, pageSize = 100, maxPages = 1000) {
      const rows = [];
      const seen = new Set();
      const pages = [];
      let totalRows;
      for (let page = 1; page <= maxPages; page += 1) {
        const data = await this.fetchPage(pattern, page, pageSize);
        if (!data || !Array.isArray(data.rows)) {
          pages.push({ page, error: data ? "no rows array" : "query not in cache" });
          break;
        }
        totalRows = data.totalRows;
        let added = 0;
        for (const row of data.rows) {
          const id = row?.id ?? JSON.stringify(row);
          if (!seen.has(id)) {
            seen.add(id);
            rows.push(row);
            added += 1;
          }
        }
        pages.push({ page, returned: data.rows.length, added, pageCount: data.pageCount, totalRows: data.totalRows });
        if (!data.rows.length || added === 0 || page >= (data.pageCount || 1)) {
          break;
        }
      }
      return plain({ rows, totalRows, pages });
    }
  };

  return true;
}
