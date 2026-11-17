# Headless Canvas (ticket 02)

This new entry is separate from the legacy companion. Use a disposable/new project;
do not point it at an existing user project. It is the text-card bootstrap slice,
not the collaborative editor or native daemon. Node 22.18+ (native TypeScript
stripping) is required; verified with Node 25.8.1 on Windows.

From the repository root:

```powershell
'{"cards":[{"id":"idea-1","text":"原文 **Markdown**","x":0,"y":0,"width":320,"height":180}]}' | node runtime/canvas/bang.mjs generate --project D:/tmp/bang-demo --topic demo
node runtime/canvas/bang.mjs read --project D:/tmp/bang-demo --topic demo
$env:BANG_CANVAS_PROJECT='D:/tmp/bang-demo'
cd prototypes/whiteboard-integration
npm run dev
```

Open `http://127.0.0.1:5180/canvas.html?topic=demo`. The original `/` route is
unchanged. `/api/canvas/demo` reads the same `.bang/topics/demo/current.canvas`;
the HTTP boundary is read-only. No scene or other writable current projection is
saved. Opening/reloading does not write the Canvas. Generation creates a topic
once and refuses to overwrite it; explicit editing and revisioned commits follow
in ticket 03, crash recovery in ticket 05. This bootstrap does not claim atomic
publication under concurrent reads, daemon ownership, or external-file import.

`contract.ts` is dependency-free and DOM-free. The shared field schema supplies
both inferred TypeScript card types and runtime validation. Compilation copies
caller-provided identity, original text and integer geometry without layout,
randomness or model calls. Input array order is standard z-order. The current
supported subset is text nodes and empty edges; other node types/edges are rejected
on read rather than silently dropped. See the [JSON Canvas 1.0 specification](https://jsoncanvas.org/spec/1.0/).

## Evidence

On Windows / Node 25.8.1 with the frozen frontend dependencies:

- `node --test tests/canvas-runtime.test.mjs tests/legacy-runtime.test.mjs tests/legacy-http.test.mjs`: eight passing public CLI/HTTP/compiler and legacy tests.
- `npm run build` in `prototypes/whiteboard-integration`: TypeScript and production build pass (existing large-bundle warning).
- `node tests/canvas-browser.mjs`: actual headless Chrome, CLI-generated temporary project, real HTTP, production Excalidraw, reload, identity/body/geometry/order and unchanged Canvas content/mtime. No request interception or injected scene. Screenshot saved locally as ignored `canvas-browser.png`.
- `node tests/legacy-browser.mjs`: original rectangle gesture/save/reload passes.

The CLI/HTTP and browser tests first failed on missing entry/page; the standard
integer-geometry tests failed before the validator fix. Local networking and
Chrome required execution outside the restricted sandbox. Screenshot inspected:
front card covers the back card, matching Canvas order.

This proves the narrow ticket 02 path. No real host/model ingestion, Linux,
Windows 10, editable round trip, edges/complex layout or performance claim is made.
The frozen baseline remains in `baselines/whiteboard-v1`.
