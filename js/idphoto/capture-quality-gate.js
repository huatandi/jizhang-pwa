(function(g){'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function grayStats(ctx,x,y,w,h){
    const d=ctx.getImageData(x,y,w,h).data; let n=0,sum=0,sum2=0,edge=0,prev=null,hi=0,clip=0,lo=0;
    for(let i=0;i<d.length;i+=16){const lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];sum+=lum;sum2+=lum*lum;n++;if(lum>=225)hi++;if(lum>=248)clip++;if(lum<=55)lo++;if(prev!=null)edge+=Math.abs(lum-prev);prev=lum;}
    const mean=n?sum/n:0, variance=n?sum2/n-mean*mean:0; return {mean,variance,edge:n?edge/n:0,highlightRatio:n?hi/n:0,clipRatio:n?clip/n:0,shadowRatio:n?lo/n:0};
  }
  function assess({imageWidth,imageHeight,face,faceCount=1,stats,target={}}){
    const issues=[]; if(faceCount!==1) issues.push({code:faceCount>1?'MULTIPLE_FACES':'NO_FACE',severity:'block',message:faceCount>1?'检测到多人，请只保留一人':'未检测到清晰人脸'});
    if(!face||!imageWidth||!imageHeight) return {ok:false,score:0,issues};
    const fw=face.width/imageWidth, fh=face.height/imageHeight;
    const top=face.y/imageHeight, left=face.x/imageWidth, right=(imageWidth-face.x-face.width)/imageWidth;
    const effectiveFacePx=Math.min(face.width,face.height);
    if(fh>.72||fw>.62||top<.035||left<.035||right<.035) issues.push({code:'TOO_CLOSE',severity:'block',message:'距离太近，后期缺少缩小和裁切余量，请后退一些'});
    else if(fh>.60) issues.push({code:'CLOSE',severity:'warn',message:'稍微偏近，建议后退一点以保留头顶和肩部空间'});
    const minFacePx=Number(target.minFacePx||420);
    const desiredHead=Number(target.headHeightRatio||0);
    if(desiredHead>0){
      if(fh>desiredHead*1.55) issues.push({code:'SPEC_TOO_CLOSE',severity:'block',message:'按当前证件规格计算，人物过近，后期没有足够缩小余量'});
      else if(fh<desiredHead*.62) issues.push({code:'SPEC_TOO_FAR',severity:'warn',message:'按当前证件规格计算，人脸偏小，建议靠近以保留更多真实细节'});
    }
    if(effectiveFacePx<minFacePx) issues.push({code:'TOO_FAR',severity:effectiveFacePx<minFacePx*.72?'block':'warn',message:'距离偏远，人脸有效像素不足，放大后可能模糊，请靠近一些'});
    if(stats){
      if(stats.edge<8) issues.push({code:'BLUR',severity:'block',message:'画面可能失焦或抖动，请保持稳定并重新对焦'});
      if(stats.mean<55) issues.push({code:'DARK',severity:'warn',message:'脸部光线偏暗，请增加正面柔和光线'});
      if(stats.mean>215) issues.push({code:'OVEREXPOSED',severity:'warn',message:'脸部过亮，请降低直射光或曝光'});
      if(stats.shadowDelta>32) issues.push({code:'FACE_SHADOW',severity:'warn',message:'左右脸光照差异较大，建议调整正面光源'});
      if(stats.highlightRatio>.22) issues.push({code:'HIGHLIGHT_STRONG',severity:'warn',message:'脸部高光面积偏大，将尝试压制高光；若已纯白则无法恢复真实纹理'});
      if(stats.clipRatio>.055) issues.push({code:'HIGHLIGHT_CLIPPED',severity:'warn',message:'检测到局部过曝信息丢失；可降低亮度，但不能伪造已经丢失的皮肤细节'});
    }
    let score=100; for(const i of issues) score-=i.severity==='block'?25:10; score=clamp(score,0,100);
    return {ok:!issues.some(i=>i.severity==='block'),score,issues,face:{x:face.x,y:face.y,width:face.width,height:face.height},metrics:{faceHeightRatio:fh,faceWidthRatio:fw,effectiveFacePx,topMarginRatio:top,leftMarginRatio:left,rightMarginRatio:right,meanLuma:stats&&stats.mean,shadowDelta:stats&&stats.shadowDelta,highlightRatio:stats&&stats.highlightRatio,clipRatio:stats&&stats.clipRatio,shadowRatio:stats&&stats.shadowRatio}};
  }
  async function analyzeImage(img,target={}){
    const w=img.naturalWidth||img.videoWidth||img.width,h=img.naturalHeight||img.videoHeight||img.height;
    let faces=[];
    if('FaceDetector' in g){try{const fd=new FaceDetector({fastMode:true,maxDetectedFaces:3});faces=await fd.detect(img);}catch(_){}}
    if(!faces.length) return {ok:false,score:0,issues:[{code:'FACE_DETECTOR_UNAVAILABLE',severity:'block',message:'当前浏览器未能完成人脸定位；请使用支持的人脸检测能力或稍后安装本地模型'}],metrics:{imageWidth:w,imageHeight:h}};
    const b=faces[0].boundingBox; const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
    const x=Math.max(0,Math.floor(b.x)),y=Math.max(0,Math.floor(b.y)),fw=Math.min(w-x,Math.floor(b.width)),fh=Math.min(h-y,Math.floor(b.height));
    const all=grayStats(ctx,x,y,fw,fh), l=grayStats(ctx,x,y,Math.max(1,Math.floor(fw/2)),fh), r=grayStats(ctx,x+Math.floor(fw/2),y,Math.max(1,fw-Math.floor(fw/2)),fh);
    return assess({imageWidth:w,imageHeight:h,face:{x,y,width:fw,height:fh},faceCount:faces.length,stats:{...all,leftMean:l.mean,rightMean:r.mean,shadowDelta:Math.abs(l.mean-r.mean)},target});
  }
  g.IDPhotoCaptureQualityGate={assess,analyzeImage};
})(window);
