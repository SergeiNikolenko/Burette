import{M as e,_ as t,j as n}from"./string-DZSE9m-9.js";import{t as r}from"./arc-BUUx0xGN.js";import{i,p as a}from"./chunk-NSK5VX7P-Cmbg4Bnt.js";import{n as o}from"./ordinal-BeZAVUpG.js";import"./src-DkOkGT2N.js";import{n as s}from"./mermaid-parser.core-B0qjC7As.js";import{n as c}from"./chunk-Y2CYZVJY-DsF7k-Jl.js";import{t as l}from"./chunk-X3CZISLH-C5MQD9l6.js";import{H as u,K as d,U as f,a as p,c as m,f as h,v as g,w as _,x as v,y}from"./chunk-I66GZJ75-D7wKg_Y_.js";import{t as b}from"./chunk-3NCLNEKW-D1etVJZx.js";import{t as x}from"./chunk-JWPE2WC7-DVXcaiue.js";function S(e,t){return t<e?-1:t>e?1:t>=e?0:NaN}function C(e){return e}function w(){var r=C,i=S,a=null,o=e(0),s=e(n),c=e(0);function l(e){var l,u=(e=t(e)).length,d,f,p=0,m=Array(u),h=Array(u),g=+o.apply(this,arguments),_=Math.min(n,Math.max(-n,s.apply(this,arguments)-g)),v,y=Math.min(Math.abs(_)/u,c.apply(this,arguments)),b=y*(_<0?-1:1),x;for(l=0;l<u;++l)(x=h[m[l]=l]=+r(e[l],l,e))>0&&(p+=x);for(i==null?a!=null&&m.sort(function(t,n){return a(e[t],e[n])}):m.sort(function(e,t){return i(h[e],h[t])}),l=0,f=p?(_-u*b)/p:0;l<u;++l,g=v)d=m[l],x=h[d],v=g+(x>0?x*f:0)+b,h[d]={data:e[d],index:l,value:x,startAngle:g,endAngle:v,padAngle:y};return h}return l.value=function(t){return arguments.length?(r=typeof t==`function`?t:e(+t),l):r},l.sortValues=function(e){return arguments.length?(i=e,a=null,l):i},l.sort=function(e){return arguments.length?(a=e,i=null,l):a},l.startAngle=function(t){return arguments.length?(o=typeof t==`function`?t:e(+t),l):o},l.endAngle=function(t){return arguments.length?(s=typeof t==`function`?t:e(+t),l):s},l.padAngle=function(t){return arguments.length?(c=typeof t==`function`?t:e(+t),l):c},l}var T=h.pie,E={sections:new Map,showData:!1,config:T},D=E.sections,O=E.showData,k=structuredClone(T),A={getConfig:c(()=>structuredClone(k),`getConfig`),clear:c(()=>{D=new Map,O=E.showData,p()},`clear`),setDiagramTitle:d,getDiagramTitle:_,setAccTitle:f,getAccTitle:y,setAccDescription:u,getAccDescription:g,addSection:c(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);D.has(e)||(D.set(e,t),l.debug(`added new section: ${e}, with value: ${t}`))},`addSection`),getSections:c(()=>D,`getSections`),setShowData:c(e=>{O=e},`setShowData`),getShowData:c(()=>O,`getShowData`)},j=c((e,t)=>{x(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},`populateDb`),M={parse:c(async e=>{let t=await s(`pie`,e);l.debug(t),j(t,A)},`parse`)},N=c(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,`getStyles`),P=c(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),n=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return w().value(e=>e.value).sort(null)(n)},`createPieArcs`),F={parser:M,db:A,renderer:{draw:c((e,t,n,s)=>{l.debug(`rendering pie chart
`+e);let c=s.db,u=v(),d=i(c.getConfig(),u.pie),f=b(t),p=f.append(`g`);p.attr(`transform`,`translate(225,225)`);let{themeVariables:h}=u,[g]=a(h.pieOuterStrokeWidth);g??=2;let _=d.legendPosition,y=d.textPosition,x=d.donutHole>0&&d.donutHole<=.9?d.donutHole:0,S=r().innerRadius(x*185).outerRadius(185),C=r().innerRadius(185*y).outerRadius(185*y),w=p.append(`g`);w.append(`circle`).attr(`cx`,0).attr(`cy`,0).attr(`r`,185+g/2).attr(`class`,`pieOuterCircle`);let T=c.getSections(),E=P(T),D=[h.pie1,h.pie2,h.pie3,h.pie4,h.pie5,h.pie6,h.pie7,h.pie8,h.pie9,h.pie10,h.pie11,h.pie12],O=0;T.forEach(e=>{O+=e});let k=E.filter(e=>(e.data.value/O*100).toFixed(0)!==`0`),A=o(D).domain([...T.keys()]);w.selectAll(`mySlices`).data(k).enter().append(`path`).attr(`d`,S).attr(`fill`,e=>A(e.data.label)).attr(`class`,e=>{let t=`pieCircle`;return d.highlightSlice===`hover`?t+=` highlightedOnHover`:d.highlightSlice===e.data.label&&(t+=` highlighted`),t}),w.selectAll(`mySlices`).data(k).enter().append(`text`).text(e=>(e.data.value/O*100).toFixed(0)+`%`).attr(`transform`,e=>`translate(`+C.centroid(e)+`)`).style(`text-anchor`,`middle`).attr(`class`,`slice`);let j=p.append(`text`).text(c.getDiagramTitle()).attr(`x`,0).attr(`y`,-400/2).attr(`class`,`pieTitleText`),M=[...T.entries()].map(([e,t])=>({label:e,value:t})),N=p.selectAll(`.legend`).data(M).enter().append(`g`).attr(`class`,`legend`);N.append(`rect`).attr(`width`,18).attr(`height`,18).style(`fill`,e=>A(e.label)).style(`stroke`,e=>A(e.label)),N.append(`text`).attr(`x`,22).attr(`y`,14).text(e=>c.getShowData()?`${e.label} [${e.value}]`:e.label);let F=Math.max(...N.selectAll(`text`).nodes().map(e=>e?.getBoundingClientRect().width??0)),I=450,L=490,R=M.length*22;switch(_){case`center`:N.attr(`transform`,(e,t)=>{let n=22*M.length/2,r=-F/2-22,i=t*22-n;return`translate(`+r+`,`+i+`)`});break;case`top`:I+=R,N.attr(`transform`,(e,t)=>`translate(${-F/2-22}, ${t*22-185})`),w.attr(`transform`,()=>`translate(0, ${R+22})`);break;case`bottom`:I+=R,N.attr(`transform`,(e,t)=>{let n=-F/2-22,r=t*22- -207;return`translate(`+n+`,`+r+`)`});break;case`left`:L+=22+F,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(-207,`+(t*22-n)+`)`}),w.attr(`transform`,()=>`translate(${F+18+4}, 0)`);break;default:L+=22+F,N.attr(`transform`,(e,t)=>{let n=22*M.length/2;return`translate(216,`+(t*22-n)+`)`});break}let z=j.node()?.getBoundingClientRect().width??0,B=450/2-z/2,V=450/2+z/2,H=Math.min(0,B),U=Math.max(L,V)-H;f.attr(`viewBox`,`${H} 0 ${U} ${I}`),m(f,I,U,d.useMaxWidth)},`draw`)},styles:N};export{F as diagram};