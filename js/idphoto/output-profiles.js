(function(g){'use strict';
const PRESETS={single:{label:'单张电子照片'},shop:{label:'拿到照相店打印'},home:{label:'家庭打印'},custom:{label:'自定义'}};
function mm(v,u){v=Number(v)||0;return u==='inch'?v*25.4:u==='cm'?v*10:v}
function read(){let v=id=>{let e=document.getElementById(id);return e?e.value:''};return{purpose:v('idpPurpose')||'shop',format:v('idpFormat')||'jpeg',quality:Number(v('idpQualityOut')||92)/100,dpi:Number(v('idpDpi')||300),paper:v('idpPaper')||'4x6',paperWidthMm:mm(v('idpPaperW'),v('idpPaperUnit')||'mm'),paperHeightMm:mm(v('idpPaperH'),v('idpPaperUnit')||'mm'),count:Number(v('idpCount')||999),marginMm:Number(v('idpMargin')||3),gapMm:Number(v('idpGap')||3),cropMarks:!!(document.getElementById('idpCropMarks')||{}).checked}}
g.IDPhotoOutputProfiles={PRESETS,read,mmFromUnit:mm,VERSION:1};
})(window);