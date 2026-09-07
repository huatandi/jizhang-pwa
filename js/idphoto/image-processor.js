(function(g){'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const hexToRgb=(hex)=>{const s=String(hex||'#ffffff').replace('#','');const n=parseInt(s.length===3?s.split('').map(x=>x+x).join(''):s,16);return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};};
  function canvasFromImage(img){const c=document.createElement('canvas');c.width=img.naturalWidth||img.videoWidth||img.width;c.height=img.naturalHeight||img.videoHeight||img.height;c.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,c.width,c.height);return c;}
  function relight(canvas,strength=.45){
    strength=clamp(Number(strength)||0,0,.85); if(!strength)return canvas;
    const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(canvas,0,0);
    const im=x.getImageData(0,0,c.width,c.height),d=im.data;
    // Estimate left/right illumination from low-frequency column samples and compensate smoothly.
    let L=0,R=0,ln=0,rn=0;
    for(let y=0;y<c.height;y+=Math.max(1,Math.floor(c.height/90))) for(let xx=0;xx<c.width;xx+=Math.max(1,Math.floor(c.width/90))){const i=(y*c.width+xx)*4,lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];if(xx<c.width*.5){L+=lum;ln++;}else{R+=lum;rn++;}}
    L/=ln||1;R/=rn||1;const target=(L+R)/2;
    for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++){const i=(y*c.width+xx)*4;const pos=xx/Math.max(1,c.width-1),base=L*(1-pos)+R*pos;const gain=clamp(1+(target-base)/Math.max(40,target)*strength,.72,1.32);for(let k=0;k<3;k++){let v=d[i+k]*gain; // gentle highlight protection
      if(v>220)v=220+(v-220)*.35; d[i+k]=clamp(Math.round(v),0,255);}}
    x.putImageData(im,0,0);return c;
  }
  function backgroundMatte(canvas,color='#ffffff',tolerance=44,softness=28){
    // Local lightweight background cleanup for plain walls. It never fabricates face pixels.
    const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(canvas,0,0);const im=x.getImageData(0,0,c.width,c.height),d=im.data;
    const sample=[];const step=Math.max(1,Math.floor(Math.min(c.width,c.height)/80));
    for(let xx=0;xx<c.width;xx+=step){for(const yy of [0,Math.min(c.height-1,step)]){const i=(yy*c.width+xx)*4;sample.push([d[i],d[i+1],d[i+2]]);}for(const yy of [c.height-1,Math.max(0,c.height-1-step)]){const i=(yy*c.width+xx)*4;sample.push([d[i],d[i+1],d[i+2]]);}}
    for(let yy=0;yy<c.height;yy+=step){for(const xx of [0,Math.min(c.width-1,step),c.width-1,Math.max(0,c.width-1-step)]){const i=(yy*c.width+xx)*4;sample.push([d[i],d[i+1],d[i+2]]);}}
    const bg={r:0,g:0,b:0};for(const a of sample){bg.r+=a[0];bg.g+=a[1];bg.b+=a[2];}bg.r/=sample.length||1;bg.g/=sample.length||1;bg.b/=sample.length||1;const out=hexToRgb(color);
    for(let i=0;i<d.length;i+=4){const dr=d[i]-bg.r,dg=d[i+1]-bg.g,db=d[i+2]-bg.b;const dist=Math.sqrt(dr*dr+dg*dg+db*db);let a=clamp((dist-tolerance)/Math.max(1,softness),0,1);a=a*a*(3-2*a);d[i]=Math.round(out.r*(1-a)+d[i]*a);d[i+1]=Math.round(out.g*(1-a)+d[i+1]*a);d[i+2]=Math.round(out.b*(1-a)+d[i+2]*a);}
    x.putImageData(im,0,0);return c;
  }
  function cropToSpec(canvas,spec,face){
    const widthMm=Number(spec&&spec.widthMm)||35,heightMm=Number(spec&&spec.heightMm)||49,ratio=widthMm/heightMm;
    let cx=canvas.width/2,cy=canvas.height/2,desiredH=canvas.height;
    if(face){cx=face.x+face.width/2; const targetHead=Number(spec&&spec.headHeightRatio)||.46; desiredH=face.height/clamp(targetHead,.28,.68); cy=face.y+face.height*.48 + desiredH*.07;}
    let h=Math.min(canvas.height,desiredH),w=h*ratio;if(w>canvas.width){w=canvas.width;h=w/ratio;}
    let x=clamp(cx-w/2,0,canvas.width-w),y=clamp(cy-h*.42,0,canvas.height-h);
    const c=document.createElement('canvas');const dpi=Number(spec&&spec.dpi)||300;c.width=Math.max(1,Math.round(widthMm/25.4*dpi));c.height=Math.max(1,Math.round(heightMm/25.4*dpi));c.getContext('2d').drawImage(canvas,x,y,w,h,0,0,c.width,c.height);return c;
  }
  async function toJpegTargetKb(canvas,targetKb,maxKb){
    const hi=Number(maxKb)||Number(targetKb)||0;if(!hi)return await new Promise(r=>canvas.toBlob(r,'image/jpeg',.92));
    let lo=.35,up=.96,best=null;for(let n=0;n<8;n++){const q=(lo+up)/2;const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',q));if(!blob)break;best=blob;const kb=blob.size/1024;if(kb>hi)up=q;else lo=q;}return best;
  }
  function makePrintSheet(photo,{paper='4x6',count=8,dpi=300,gapMm=3}={}){
    const mm=paper==='a4'?[210,297]:[101.6,152.4],W=Math.round(mm[0]/25.4*dpi),H=Math.round(mm[1]/25.4*dpi),gap=Math.round(gapMm/25.4*dpi);const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,W,H);let px=gap,py=gap,n=0;while(n<count&&py+photo.height<=H-gap){if(px+photo.width>W-gap){px=gap;py+=photo.height+gap;if(py+photo.height>H-gap)break;}x.drawImage(photo,px,py);x.strokeStyle='#bbb';x.lineWidth=1;x.strokeRect(px-.5,py-.5,photo.width+1,photo.height+1);px+=photo.width+gap;n++;}return {canvas:c,placed:n};
  }
  g.IDPhotoImageProcessor={canvasFromImage,relight,backgroundMatte,cropToSpec,toJpegTargetKb,makePrintSheet,VERSION:1};
})(window);
