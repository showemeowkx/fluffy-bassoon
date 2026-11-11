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
  if (window.__kx && window.__kx.version === 1) {
    return true;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const router = () => window.__TSR_ROUTER__;
  const queryClient = () => router()?.options?.context?.queryClient;

  const rewritePayload = (text, override) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text;
    }
    const walk = (node) => {
      if (!node || typeof node !== "object") {
        return;
      }
      if (node.p && Array.isArray(node.p.k) && Array.isArray(node.p.v) && node.p.k.includes("pageSize")) {
        for (const [key, value] of Object.entries(override)) {
          const index = node.p.k.indexOf(key);
          if (index >= 0) {
            node.p.v[index] = { t: 0, s: value };
          }
        }
      }
      for (const child of Object.values(node)) {
        walk(child);
      }
    };
    walk(parsed);
    return JSON.stringify(parsed);
  };

  if (!window.__kxOriginalFetch) {
    window.__kxOriginalFetch = window.fetch;
    window.fetch = function patchedFetch(input, init) {
      const override = window.__kxOverride;
      if (override) {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : null;
        if (rawUrl && rawUrl.includes("/_serverFn/")) {
          const url = new URL(rawUrl, location.href);
          const payload = url.searchParams.get("payload");
          if (payload && payload.includes("pageSize")) {
            url.searchParams.set("payload", rewritePayload(payload, override));
            input = url.pathname + url.search;
          } else if (init && typeof init.body === "string" && init.body.includes("pageSize")) {
            init = { ...init, body: rewritePayload(init.body, override) };
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
    version: 1,

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

    async fetchPage(pattern, page, pageSize) {
      const query = allQueries().find((candidate) => matchKey(candidate.queryKey, pattern) && candidate.options?.queryFn);
      if (!query) {
        return null;
      }
      await settle(5000);
      window.__kxOverride = { page, pageSize };
      try {
        const data = await query.options.queryFn({
          queryKey: query.queryKey,
          signal: new AbortController().signal,
          meta: query.meta,
          client: queryClient()
        });
        return plain(data);
      } finally {
        window.__kxOverride = null;
      }
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
