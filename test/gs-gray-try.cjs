const fs=require('fs');const factory=require('@jspawn/ghostscript-wasm');
const wasm=new WebAssembly.Module(fs.readFileSync(require.resolve('@jspawn/ghostscript-wasm/gs.wasm')));
const mk=()=>factory({noInitialRun:true,print(){},printErr(){},instantiateWasm:(i,d)=>{WebAssembly.instantiate(wasm,i).then(x=>d(x,wasm));return{}}});
async function run(input,args){const g=await mk();g.FS.writeFile('/in.pdf',input);let c;try{c=g.callMain(args)}catch(e){c=-1}let o=null;try{o=g.FS.readFile('/out.pdf')}catch{}return{c,o}}
async function maxDiff(pdf){const g=await mk();g.FS.writeFile('/in.pdf',pdf);g.callMain(['-sDEVICE=ppmraw','-r30','-dNOPAUSE','-dBATCH','-dQUIET','-sOutputFile=/o.ppm','/in.pdf']);const p=Buffer.from(g.FS.readFile('/o.ppm'));let pos=0,f=[];while(f.length<4){let l='';while(p[pos]!==10){l+=String.fromCharCode(p[pos]);pos++}pos++;if(l.startsWith('#'))continue;f.push(...l.trim().split(/\s+/))}let m=0;for(let i=pos;i+2<p.length;i+=3){m=Math.max(m,Math.abs(p[i]-p[i+1]),Math.abs(p[i+1]-p[i+2]))}return m}
module.exports={run,maxDiff};
if(require.main===module)(async()=>{const input=fs.readFileSync('test/fixtures/color.pdf');
const base=['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dQUIET','-dSAFER','-dAutoRotatePages=/None'];
const variants={
 A:['-sColorConversionStrategy=Gray','-dProcessColorModel=/DeviceGray'],
 B:['-sColorConversionStrategy=Gray','-dProcessColorModel=/DeviceGray','-dCompatibilityLevel=1.4'],
 C:['-sColorConversionStrategy=Gray','-sColorConversionStrategyForImages=Gray','-dProcessColorModel=/DeviceGray','-dPDFSETTINGS=/printer'],
 D:['-sColorConversionStrategy=Gray','-dProcessColorModel=/DeviceGray','-dNOTRANSPARENCY','-dPDFSETTINGS=/prepress'],
};
for(const [k,v] of Object.entries(variants)){const r=await run(input,[...base,...v,'-sOutputFile=/out.pdf','/in.pdf']);console.log(k,'code',r.c,'size',r.o&&r.o.length,'maxDiff',r.o?await maxDiff(r.o):'-');}})();
