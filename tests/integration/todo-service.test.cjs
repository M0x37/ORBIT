const test = require("node:test");
const assert = require("node:assert/strict");
const { todoRequest } = require("../../lib/todo-service.cjs");

const baseConfig = {
  baseUrl: "https://todo.example",
  apiKey: "public-key",
  table: "todos"
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body))
  };
}

test("todoRequest sends auth headers and parses JSON", async () => {
  let requestedUrl;
  let requestedOptions;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return jsonResponse(200, [{ id: 1, title: "Task" }]);
  };

  const rows = await todoRequest({
    ...baseConfig,
    fetchImpl,
    search: "?select=id,title",
    options: { method: "POST", headers: { Prefer: "return=representation" } }
  });

  assert.deepEqual(rows, [{ id: 1, title: "Task" }]);
  assert.equal(requestedUrl, "https://todo.example/rest/v1/todos?select=id,title");
  assert.equal(requestedOptions.method, "POST");
  assert.equal(requestedOptions.headers.apikey, "public-key");
  assert.equal(requestedOptions.headers.Authorization, "Bearer public-key");
  assert.equal(requestedOptions.headers["Content-Type"], "application/json");
  assert.equal(requestedOptions.headers.Prefer, "return=representation");
  assert.ok(requestedOptions.signal);
});

test("todoRequest returns null for 204 and empty bodies", async () => {
  const noContent = await todoRequest({
    ...baseConfig,
    fetchImpl: async () => jsonResponse(204, undefined),
    search: ""
  });
  assert.equal(noContent, null);

  const emptyBody = await todoRequest({
    ...baseConfig,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "", json: async () => null }),
    search: ""
  });
  assert.equal(emptyBody, null);
});

test("todoRequest surfaces the API error message", async () => {
  await assert.rejects(
    todoRequest({
      ...baseConfig,
      fetchImpl: async () => jsonResponse(400, { message: "duplicate key value" }),
      search: ""
    }),
    /duplicate key value/
  );
});

test("todoRequest falls back to the HTTP status message", async () => {
  await assert.rejects(
    todoRequest({
      ...baseConfig,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => { throw new SyntaxError("not json"); },
        text: async () => ""
      }),
      search: ""
    }),
    /returned HTTP 500/
  );
});

test("todoRequest reports network failures", async () => {
  await assert.rejects(
    todoRequest({
      ...baseConfig,
      fetchImpl: async () => { throw new TypeError("fetch failed"); },
      search: ""
    }),
    /Could not reach the To-Do service/
  );
});
