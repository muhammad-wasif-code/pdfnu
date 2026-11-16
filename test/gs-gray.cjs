const fs=require('fs');const factory=require('@jspawn/ghostscript-wasm');
const wasm=new WebAssembly.Module(fs.readFileSync(require.resolve('@jspawn/ghostscript-wasm/gs.wasm')));
(async()=>{const g=await factory({noInitialRun:true,print(){},printErr(){},instantiateWasm:(i,d)=>{WebAssembly.instantiate(wasm,i).then(x=>d(x,wasm));return{}}});
g.FS.writeFile('/in.pdf',fs.readFileSync(process.argv[2]));
const args=['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dQUIET','-dSAFER','-dAutoRotatePages=/None','-sColorConversionStrategy=Gray','-dProcessColorModel=/DeviceGray','-dOverrideICC','-dCompatibilityLevel=1.5','-sOutputFile=/out.pdf','/in.pdf'];
const c=g.callMain(args);const o=g.FS.readFile('/out.pdf');fs.writeFileSync('test/out/gray.pdf',o);console.log({code:c,in:fs.statSync(process.argv[2]).size,out:o.length});})();
