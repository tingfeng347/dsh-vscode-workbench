const fs=require('node:fs');
const path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {GIFEncoder,quantize,applyPalette}=require('gifenc');
const {GifReader}=require('omggif');
const OUT=path.resolve(__dirname,'..');
const QA=path.join(require('node:os').tmpdir(),'dsh-workbench-v3-export');
fs.mkdirSync(QA,{recursive:true});
const whale="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z";
const N=96, SIZE=640;
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
const phase=(t,a,b,c)=>ease((t-a)/(b-a))*(1-ease((t-b)/(c-b)));

function svgAt(t=0, animated=false){
  const bob=-2.4*Math.sin(2*Math.PI*t);
  const turn=.85*Math.sin(2*Math.PI*t);
  const blue=phase(t,.10,.30,.53);
  const typing=phase(t,.43,.66,.87);
  const caret=.25+.75*Math.pow(Math.cos(4*Math.PI*t),2);
  const typed=60*typing;
  const a=animated ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -2.4;0 0;0 2.4;0 0" dur="4.8s" repeatCount="indefinite"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
<title id="title">DSH Workbench</title>
<desc id="desc">A graphite split-pane workbench with the DeepSeek whale and a quiet blue terminal prompt. Community plugin design based on official DeepSeek Harness visual references.</desc>
<metadata>Whale silhouette reference: https://www.deepseek.com/harness/favicon.svg ; desktop style reference: https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/resources/icon-macos.svg . Workbench composition and motion created for dsh-vscode-workbench.</metadata>
<defs>
 <linearGradient id="paper" x1=".15" y1="0" x2=".75" y2="1"><stop stop-color="#FCFDFE"/><stop offset="1" stop-color="#EEF1F6"/></linearGradient>
 <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#292E37"/><stop offset="1" stop-color="#444C59"/></linearGradient>
 <linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="230" y1="340" x2="340" y2="370"><stop stop-color="#91B6FC"/><stop offset="1" stop-color="#6489DF"/></linearGradient>
 <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#19273F" flood-opacity=".14"/></filter>
</defs>
<rect x="48" y="44" width="416" height="416" rx="96" fill="url(#paper)" filter="url(#shadow)"/>
<rect x="49" y="45" width="414" height="414" rx="95" fill="none" stroke="#FFFFFF" stroke-opacity=".90" stroke-width="1.5"/>
<g fill="none" stroke="url(#ink)" stroke-linecap="round" stroke-linejoin="round">
 <rect x="112" y="136" width="288" height="244" rx="26" stroke-width="11"/>
 <path d="M114 181H398M169 184V376" stroke-width="8"/>
</g>
<g fill="#8F99A8"><circle cx="135" cy="159" r="3.6"/><circle cx="150" cy="159" r="3.6"/></g>
<g fill="none" stroke-linecap="round" stroke-width="6.5">
 <path d="M134 216H147M134 241H144" stroke="#A4ADBB"/>
 <path d="M134 216H147" stroke="#7D9EE8" opacity="${blue}"/>
 <path d="M134 241H144" stroke="#7D9EE8" opacity="${typing}"/>
</g>
<g transform="translate(0 ${bob})">${a}<g transform="rotate(${turn} 284 270)"><g transform="translate(207 192) scale(3.15)" fill="url(#ink)"><path d="${whale}"/></g></g></g>
<g fill="none" stroke="url(#accent)" stroke-linecap="round" stroke-linejoin="round" stroke-width="7">
 <path d="M238 344L248 353L238 362"/>
 <path d="M${264+typed} 362H${284+typed}" opacity="${caret}"/>
</g>
<g stroke="#8F9DB4" stroke-linecap="round" stroke-width="3.5" opacity="${typing}"><path d="M265 345H${265+typed*.8}"/><path d="M265 352H${265+typed*.55}"/></g>
</svg>`;
}

(async()=>{
  fs.writeFileSync(path.join(OUT,'dsh-workbench.svg'),svgAt());
  const canvas=createCanvas(SIZE,SIZE), c=canvas.getContext('2d');
  async function render(t,background='#FFFFFF'){
    c.clearRect(0,0,SIZE,SIZE);
    if(background){c.fillStyle=background;c.fillRect(0,0,SIZE,SIZE);}
    c.drawImage(await loadImage(Buffer.from(svgAt(t))),0,0,SIZE,SIZE);
    return c.getImageData(0,0,SIZE,SIZE).data;
  }
  const hi=createCanvas(1024,1024);
  hi.getContext('2d').drawImage(await loadImage(Buffer.from(svgAt())),0,0,1024,1024);
  fs.writeFileSync(path.join(OUT,'dsh-workbench.png'),hi.toBuffer('image/png'));
  await render(0);fs.writeFileSync(path.join(OUT,'dsh-workbench-preview.png'),canvas.toBuffer('image/png'));
  const samples=[];
  for(let i=0;i<N;i+=6){const pixels=await render(i/(N-1));for(let p=0;p<pixels.length;p+=40)samples.push(pixels[p],pixels[p+1],pixels[p+2],255);}
  const palette=quantize(Uint8Array.from(samples),256,{format:'rgb565'});
  const gif=GIFEncoder();
  for(let i=0;i<N;i++){const pixels=await render(i/(N-1));gif.writeFrame(applyPalette(pixels,palette,'rgb565'),SIZE,SIZE,{palette:i===0?palette:undefined,delay:50,repeat:0});}
  gif.finish();const dest=path.join(OUT,'dsh-workbench.gif');fs.writeFileSync(dest,gif.bytes());
  const board=createCanvas(1280,1280),bc=board.getContext('2d');
  for(const [i,t] of [0,.25,.5,.7].entries()){await render(t);bc.drawImage(canvas,(i%2)*640,Math.floor(i/2)*640);}
  fs.writeFileSync(path.join(QA,'storyboard.png'),board.toBuffer('image/png'));
  const small=createCanvas(640,320),sc=small.getContext('2d');sc.fillStyle='#FFFFFF';sc.fillRect(0,0,640,320);sc.fillStyle='#182131';sc.fillRect(320,0,320,320);
  const im=await loadImage(Buffer.from(svgAt()));
  for(const [i,size] of [128,64,32].entries()){sc.drawImage(im,20+i*100,70,size,size);sc.drawImage(im,340+i*100,70,size,size);}
  fs.writeFileSync(path.join(QA,'scale-check.png'),small.toBuffer('image/png'));
  const reader=new GifReader(fs.readFileSync(dest));let first,last,duration=0;
  for(let i=0;i<reader.numFrames();i++){const p=new Uint8Array(SIZE*SIZE*4);reader.decodeAndBlitFrameRGBA(i,p);if(!i)first=p;if(i===reader.numFrames()-1)last=p;duration+=reader.frameInfo(i).delay*10;}
  let seam=0;for(let i=0;i<first.length;i+=4)if(first[i]!==last[i]||first[i+1]!==last[i+1]||first[i+2]!==last[i+2])seam++;
  const report={width:reader.width,height:reader.height,frames:reader.numFrames(),durationMs:duration,loopCount:reader.loopCount(),seamChangedPixels:seam,bytes:fs.statSync(dest).size};
  fs.writeFileSync(path.join(OUT,'source/export-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})();
