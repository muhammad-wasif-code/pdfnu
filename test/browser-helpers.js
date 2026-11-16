// Dev-only helpers for driving tool islands in the local preview. Loaded with: await import('/__test__/browser-helpers.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = () => document.querySelector('section[aria-label$=" tool"]').innerText.replace(/\n+/g, ' | ');
const btn = (re) => [...document.querySelectorAll('section[aria-label$=" tool"] button')].find((x) => re.test(x.textContent.trim()));
async function load(names, sel = 'section[aria-label$=" tool"] input[type=file]') {
  const dt = new DataTransfer();
  for (const n of names) {
    const b = await (await fetch('/__test__/' + n)).blob();
    dt.items.add(new File([b], n, { type: n.endsWith('.pdf') ? 'application/pdf' : b.type }));
  }
  const inp = document.querySelector(sel);
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
}
async function wait(re, ms = 120000) {
  for (let i = 0; i < ms / 250; i++) { await sleep(250); if (re.test(tool())) return true; }
  return false;
}
function dl(re = /^Download/) {
  let cap, nm;
  const o = URL.createObjectURL;
  URL.createObjectURL = (b) => { cap = b; return o(b); };
  const c = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { nm = this.download; };
  btn(re).click();
  return new Promise(async (res) => {
    for (let i = 0; i < 200 && !cap; i++) await sleep(50);
    HTMLAnchorElement.prototype.click = c; URL.createObjectURL = o;
    window.__last = cap;
    res(nm + ' ' + (cap && cap.size));
  });
}
/** count pages of a PDF blob by scanning for /Type /Page objects (works for non-object-stream page dicts only) */
async function pdfText(blob) { return new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer())); }
function setInput(selOrEl, value) {
  const el = typeof selOrEl === 'string' ? document.querySelector(selOrEl) : selOrEl;
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
Object.assign(window, { sleep, tool, btn, load, wait, dl, pdfText, setInput });
export default true;
