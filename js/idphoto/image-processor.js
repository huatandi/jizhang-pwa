(function(g){'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const hexToRgb=(hex)=>{const s=String(hex||'#ffffff').replace('#','');const n=parseInt(s.length===3?s.split('').map(x=>x+x).join(''):s,16);return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};};
  function cloneCanvas(canvas){const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,0);return c;}
  function canvasFromImage(img){const c=document.createElement('canvas');c.width=img.naturalWidth||img.videoWidth||img.width;c.height=img.naturalHeight||img.videoHeight||img.height;c.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,c.width,c.height);return c;}
  function faceWeight(x,y,face,w,h){if(!face)return 1;const cx=face.x+face.width*.5,cy=face.y+face.height*.52;const rx=Math.max(1,face.width*.72),ry=Math.max(1,face.height*.82);const dx=(x-cx)/rx,dy=(y-cy)/ry;const r=dx*dx+dy*dy;return r>=1?0:Math.pow(1-r,1.8);}
  function relight(canvas,strength=.45,face=null){
    // V219 identity-safe dual-zone relighting: recover low-frequency shadow and
    // compress recoverable highlights independently. Never synthesizes texture.
    strength=clamp(Number(strength)||0,0,.9);if(!strength)return cloneCanvas(canvas);
    const c=cloneCanvas(canvas),x=c.getContext('2d',{willReadFrequently:true}),im=x.getImageData(0,0,c.width,c.height),d=im.data;
    const gw=24,gh=24,sum=new Float64Array(gw*gh),cnt=new Uint32Array(gw*gh);let global=0,gn=0;
    const step=Math.max(1,Math.floor(Math.min(c.width,c.height)/420));
    for(let yy=0;yy<c.height;yy+=step)for(let xx=0;xx<c.width;xx+=step){const i=(yy*c.width+xx)*4,lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2],gx=Math.min(gw-1,Math.floor(xx/c.width*gw)),gy=Math.min(gh-1,Math.floor(yy/c.height*gh)),q=gy*gw+gx;sum[q]+=lum;cnt[q]++;global+=lum;gn++;}
    global=global/(gn||1);const field=new Float64Array(gw*gh);
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){let acc=0,wt=0;for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){const xx=clamp(gx+ox,0,gw-1),yy=clamp(gy+oy,0,gh-1),q=yy*gw+xx,w=1/(1+Math.abs(ox)+Math.abs(oy));if(cnt[q]){acc+=(sum[q]/cnt[q])*w;wt+=w}}field[gy*gw+gx]=wt?acc/wt:global;}
    const target=clamp(global,105,182);
    for(let yy=0;yy<c.height;yy++)for(let xx=0;xx<c.width;xx++){const i=(yy*c.width+xx)*4,fw=face?faceWeight(xx,yy,face,c.width,c.height):1;if(fw<=0)continue;const fx=xx/Math.max(1,c.width-1)*(gw-1),fy=yy/Math.max(1,c.height-1)*(gh-1),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(gw-1,x0+1),y1=Math.min(gh-1,y0+1),tx=fx-x0,ty=fy-y0,a=field[y0*gw+x0]*(1-tx)+field[y0*gw+x1]*tx,b=field[y1*gw+x0]*(1-tx)+field[y1*gw+x1]*tx,local=a*(1-ty)+b*ty;
      const lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
      const shadowNeed=clamp((target-local)/82,0,.72),highlightNeed=clamp((local-target)/74,0,.68);
      const shadowPixel=clamp((175-lum)/120,0,1),highlightPixel=clamp((lum-175)/75,0,1);
      let gain=1+shadowNeed*shadowPixel*strength*.72-highlightNeed*highlightPixel*strength*.42;
      // clipped pixels can be darkened but never treated as recovered detail
      if(lum>=248)gain=Math.min(gain,1-strength*.08);gain=clamp(gain,.72,1.34);
      const mix=fw*strength;for(let k=0;k<3;k++){const corrected=d[i+k]*gain;d[i+k]=clamp(Math.round(d[i+k]*(1-mix)+corrected*mix),0,255);}
    }
    x.putImageData(im,0,0);return c;
  }
  function backgroundMatte(canvas,color='#ffffff',tolerance=44,softness=28){
    const c=cloneCanvas(canvas),x=c.getContext('2d',{willReadFrequently:true}),im=x.getImageData(0,0,c.width,c.height),d=im.data;const sample=[],step=Math.max(1,Math.floor(Math.min(c.width,c.height)/80));
    for(let xx=0;xx<c.width;xx+=step){for(const yy of [0,Math.min(c.height-1,step),c.height-1,Math.max(0,c.height-1-step)]){const i=(yy*c.width+xx)*4;sample.push([d[i],d[i+1],d[i+2]]);}}
    for(let yy=0;yy<c.height;yy+=step){for(const xx of [0,Math.min(c.width-1,step),c.width-1,Math.max(0,c.width-1-step)]){const i=(yy*c.width+xx)*4;sample.push([d[i],d[i+1],d[i+2]]);}}
    const bg={r:0,g:0,b:0};for(const a of sample){bg.r+=a[0];bg.g+=a[1];bg.b+=a[2];}bg.r/=sample.length||1;bg.g/=sample.length||1;bg.b/=sample.length||1;const out=hexToRgb(color);
    for(let i=0;i<d.length;i+=4){const dr=d[i]-bg.r,dg=d[i+1]-bg.g,db=d[i+2]-bg.b,dist=Math.sqrt(dr*dr+dg*dg+db*db);let a=clamp((dist-tolerance)/Math.max(1,softness),0,1);a=a*a*(3-2*a);d[i]=Math.round(out.r*(1-a)+d[i]*a);d[i+1]=Math.round(out.g*(1-a)+d[i+1]*a);d[i+2]=Math.round(out.b*(1-a)+d[i+2]*a);}x.putImageData(im,0,0);return c;
  }
  function cropToSpec(canvas,spec,face){const widthMm=Number(spec&&spec.widthMm)||35,heightMm=Number(spec&&spec.heightMm)||49,ratio=widthMm/heightMm;let cx=canvas.width/2,desiredH=canvas.height;if(face){cx=face.x+face.width/2;const targetHead=Number(spec&&spec.headHeightRatio)||.46;desiredH=face.height/clamp(targetHead,.28,.68);}let h=Math.min(canvas.height,desiredH),w=h*ratio;if(w>canvas.width){w=canvas.width;h=w/ratio;}let y=face?clamp(face.y-face.height*.28,0,canvas.height-h):Math.max(0,(canvas.height-h)/2),xx=clamp(cx-w/2,0,canvas.width-w);const c=document.createElement('canvas');const dpi=Number(spec&&spec.dpi)||300;c.width=Math.max(1,Math.round(widthMm/25.4*dpi));c.height=Math.max(1,Math.round(heightMm/25.4*dpi));c.getContext('2d').drawImage(canvas,xx,y,w,h,0,0,c.width,c.height);return c;}
  async function encode(canvas,{format='jpeg',quality=.92,targetKb=null,maxKb=null}={}){const mime=format==='png'?'image/png':'image/jpeg';if(format==='png')return await new Promise(r=>canvas.toBlob(r,mime));const hi=Number(maxKb)||Number(targetKb)||0;if(!hi)return await new Promise(r=>canvas.toBlob(r,mime,quality));let lo=.35,up=.98,best=null;for(let n=0;n<9;n++){const q=(lo+up)/2,blob=await new Promise(r=>canvas.toBlob(r,mime,q));if(!blob)break;best=blob;blob.size/1024>hi?up=q:lo=q;}return best;}
  async function toJpegTargetKb(canvas,targetKb,maxKb){return encode(canvas,{format:'jpeg',targetKb,maxKb});}
  function paperMm(paper,w,h){if(paper==='a4')return[210,297];if(paper==='5x7')return[127,177.8];if(paper==='custom')return[Number(w)||101.6,Number(h)||152.4];return[101.6,152.4];}
  function layoutCapacity(photo,{paper='4x6',paperWidthMm,paperHeightMm,dpi=300,gapMm=3,marginMm=3,allowRotate=true}={}){const [mw,mh]=paperMm(paper,paperWidthMm,paperHeightMm),W=Math.round(mw/25.4*dpi),H=Math.round(mh/25.4*dpi),gap=Math.round(gapMm/25.4*dpi),margin=Math.round(marginMm/25.4*dpi);const cap=(pw,ph)=>Math.max(0,Math.floor((W-2*margin+gap)/(pw+gap))*Math.floor((H-2*margin+gap)/(ph+gap)));const normal=cap(photo.width,photo.height),rot=allowRotate?cap(photo.height,photo.width):0;return {capacity:Math.max(normal,rot),rotate:rot>normal,widthPx:W,heightPx:H,paperMm:[mw,mh]};}
  function makePrintSheet(photo,opts={}){const dpi=Number(opts.dpi)||300,gapMm=Number(opts.gapMm??3),marginMm=Number(opts.marginMm??3),count=Number(opts.count)||999;const meta=layoutCapacity(photo,{...opts,dpi,gapMm,marginMm});const c=document.createElement('canvas');c.width=meta.widthPx;c.height=meta.heightPx;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);const gap=Math.round(gapMm/25.4*dpi),margin=Math.round(marginMm/25.4*dpi),drawW=meta.rotate?photo.height:photo.width,drawH=meta.rotate?photo.width:photo.height;let px=margin,py=margin,n=0;while(n<Math.min(count,meta.capacity)&&py+drawH<=c.height-margin){if(px+drawW>c.width-margin){px=margin;py+=drawH+gap;if(py+drawH>c.height-margin)break;}x.save();if(meta.rotate){x.translate(px+drawW,py);x.rotate(Math.PI/2);x.drawImage(photo,0,0);}else x.drawImage(photo,px,py);x.restore();if(opts.cropMarks!==false){x.strokeStyle='#a0a0a0';x.lineWidth=1;x.strokeRect(px-.5,py-.5,drawW+1,drawH+1);}px+=drawW+gap;n++;}return {canvas:c,placed:n,capacity:meta.capacity,rotated:meta.rotate,paperMm:meta.paperMm,dpi};}
  g.IDPhotoImageProcessor={canvasFromImage,cloneCanvas,relight,backgroundMatte,cropToSpec,encode,toJpegTargetKb,layoutCapacity,makePrintSheet,VERSION:3};
})(window);
