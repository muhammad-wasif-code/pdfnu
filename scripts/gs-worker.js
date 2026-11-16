/* Ghostscript WASM worker (classic worker so gs.js can be loaded with importScripts).
 * Message in:  { id, input: ArrayBuffer, args: string[] }
 * Message out: { id, ok: true, output: ArrayBuffer } | { id, ok: false, error }
 * Files never leave this worker; nothing is sent over the network. */
importScripts('gs.js');
var compiled = null;
function getWasm() {
  if (!compiled) {
    compiled = (WebAssembly.compileStreaming
      ? WebAssembly.compileStreaming(fetch('gs.wasm'))
      : fetch('gs.wasm').then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.compile(b); }));
    compiled.catch(function () { compiled = null; });
  }
  return compiled;
}
self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type === 'warmup') { getWasm().then(function () { self.postMessage({ id: msg.id, ok: true }); }, function (err) { self.postMessage({ id: msg.id, ok: false, error: String(err) }); }); return; }
  var log = [];
  getWasm()
    .then(function (mod) {
      return Module({
        noInitialRun: true,
        print: function () {},
        printErr: function (s) { log.push(s); },
        instantiateWasm: function (imports, done) {
          WebAssembly.instantiate(mod, imports).then(function (inst) { done(inst, mod); });
          return {};
        },
      });
    })
    .then(function (gs) {
      gs.FS.writeFile('/in.pdf', new Uint8Array(msg.input));
      var code;
      try { code = gs.callMain(msg.args); } catch (err) { code = -1; log.push(String(err && err.message || err)); }
      var out = null;
      try { out = gs.FS.readFile('/out.pdf'); } catch (_) {}
      if (code !== 0 || !out || out.length < 100) {
        self.postMessage({ id: msg.id, ok: false, error: log.join('\n').slice(-2000) || ('exit ' + code) });
        return;
      }
      var buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      self.postMessage({ id: msg.id, ok: true, output: buf }, [buf]);
    })
    .catch(function (err) {
      self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
    });
};
