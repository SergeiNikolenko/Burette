import{o as e}from"./rolldown-runtime-C0FnF6B9.js";import{t}from"./react-D33dIfjE.js";import n from"./Miew.module-DAEFDz7-.js";var r=e(t()),i={536:e=>{e.exports=function(e){var t=[];return t.toString=function(){return this.map((function(t){var n=``,r=t[5]!==void 0;return t[4]&&(n+=`@supports (${t[4]}) {`),t[2]&&(n+=`@media ${t[2]} {`),r&&(n+=`@layer${t[5].length>0?` ${t[5]}`:``} {`),n+=e(t),r&&(n+=`}`),t[2]&&(n+=`}`),t[4]&&(n+=`}`),n})).join(``)},t.i=function(e,n,r,i,a){typeof e==`string`&&(e=[[null,e,void 0]]);var o={};if(r)for(var s=0;s<this.length;s++){var c=this[s][0];c!=null&&(o[c]=!0)}for(var l=0;l<e.length;l++){var u=[].concat(e[l]);r&&o[u[0]]||(a!==void 0&&(u[5]===void 0||(u[1]=`@layer${u[5].length>0?` ${u[5]}`:``} {${u[1]}}`),u[5]=a),n&&(u[2]&&(u[1]=`@media ${u[2]} {${u[1]}}`),u[2]=n),i&&(u[4]?(u[1]=`@supports (${u[4]}) {${u[1]}}`,u[4]=i):u[4]=`${i}`),t.push(u))}},t}},784:e=>{e.exports=function(e){var t=e[1],n=e[3];return n?typeof btoa==`function`?[t,`/*# ${`sourceMappingURL=data:application/json;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(n))))}`} */`].join(`
`):[t].join(`
`):t}},32:(e,t,n)=>{n.d(t,{A:()=>c,z:()=>s});var r=n(784),i=n.n(r),a=n(536),o=n.n(a)()(i());o.push([e.id,`.DVOOardsIBZOO3FaW5Nw {
  width: 100%;
  height: 100%;
}
`,``,{version:3,sources:[`webpack://./src/Viewer.module.scss`],names:[],mappings:`AAAA;EACE,WAAW;EACX,YAAY;AACd`,sourcesContent:[`.root {\r
  width: 100%;\r
  height: 100%;\r
}\r
`],sourceRoot:``}]);var s=`DVOOardsIBZOO3FaW5Nw`;let c=o},920:(e,t,n)=>{n.d(t,{A:()=>s});var r=n(784),i=n.n(r),a=n(536),o=n.n(a)()(i());o.push([e.id,`@keyframes spinner-line-fade-more {
  0%, 100% {
    opacity: 0; /* minimum opacity */
  }
  1% {
    opacity: 1;
  }
}

@keyframes spinner-line-fade-quick {
  0%, 39%, 100% {
    opacity: 0.25; /* minimum opacity */
  }
  40% {
    opacity: 1;
  }
}

@keyframes spinner-line-fade-default {
  0%, 100% {
    opacity: 0.22; /* minimum opacity */
  }
  1% {
    opacity: 1;
  }
}

@keyframes spinner-line-shrink {
  0%, 25%, 100% {
    /* minimum scale and opacity */
    transform: scale(0.5);
    opacity: 0.25;
  }
  26% {
    transform: scale(1);
    opacity: 1;
  }
}

.miew-canvas > canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.miew-container,
.miew-canvas {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.miew-message {
  /* trick for centered error-reporting*/
  background-color: #ccc;
  display: table;
  width: 100%;
  height: 100%;
}

.miew-message p {
    display: table-cell;
    vertical-align: middle;
    text-align: center;
    font-size: large;
  }

.mode-message {
  position: absolute;
  top: 10px;
  right: 10px;
  border-radius: 4px;
  color: silver;
  background-color: rgba(64, 64, 64, 0.75);
  display: flex;
  align-items: left;
  justify-content: left;
  opacity: 0;
}

.atom-info {
  margin: 10px;
  text-align: left;
}

.overlay {
  pointer-events: none;
}
`,``,{version:3,sources:[`webpack://./../miew/dist/Miew.css`],names:[],mappings:`AAAA;EACE;IACE,UAAU,EAAE,oBAAoB;EAClC;EACA;IACE,UAAU;EACZ;AACF;;AAEA;EACE;IACE,aAAa,EAAE,oBAAoB;EACrC;EACA;IACE,UAAU;EACZ;AACF;;AAEA;EACE;IACE,aAAa,EAAE,oBAAoB;EACrC;EACA;IACE,UAAU;EACZ;AACF;;AAEA;EACE;IACE,8BAA8B;IAC9B,qBAAqB;IACrB,aAAa;EACf;EACA;IACE,mBAAmB;IACnB,UAAU;EACZ;AACF;;AAEA;EACE,cAAc;EACd,WAAW;EACX,YAAY;AACd;;AAEA;;EAEE,WAAW;EACX,YAAY;EACZ,gBAAgB;EAChB,kBAAkB;AACpB;;AAEA;EACE,sCAAsC;EACtC,sBAAsB;EACtB,cAAc;EACd,WAAW;EACX,YAAY;AACd;;AAEA;IACI,mBAAmB;IACnB,sBAAsB;IACtB,kBAAkB;IAClB,gBAAgB;EAClB;;AAEF;EACE,kBAAkB;EAClB,SAAS;EACT,WAAW;EACX,kBAAkB;EAClB,aAAa;EACb,wCAAwC;EACxC,aAAa;EACb,iBAAiB;EACjB,qBAAqB;EACrB,UAAU;AACZ;;AAEA;EACE,YAAY;EACZ,gBAAgB;AAClB;;AAEA;EACE,oBAAoB;AACtB`,sourcesContent:[`@keyframes spinner-line-fade-more {
  0%, 100% {
    opacity: 0; /* minimum opacity */
  }
  1% {
    opacity: 1;
  }
}

@keyframes spinner-line-fade-quick {
  0%, 39%, 100% {
    opacity: 0.25; /* minimum opacity */
  }
  40% {
    opacity: 1;
  }
}

@keyframes spinner-line-fade-default {
  0%, 100% {
    opacity: 0.22; /* minimum opacity */
  }
  1% {
    opacity: 1;
  }
}

@keyframes spinner-line-shrink {
  0%, 25%, 100% {
    /* minimum scale and opacity */
    transform: scale(0.5);
    opacity: 0.25;
  }
  26% {
    transform: scale(1);
    opacity: 1;
  }
}

.miew-canvas > canvas {\r
  display: block;\r
  width: 100%;\r
  height: 100%;\r
}

.miew-container,\r
.miew-canvas {\r
  width: 100%;\r
  height: 100%;\r
  overflow: hidden;\r
  position: relative;\r
}

.miew-message {\r
  /* trick for centered error-reporting*/\r
  background-color: #ccc;\r
  display: table;\r
  width: 100%;\r
  height: 100%;\r
}

.miew-message p {\r
    display: table-cell;\r
    vertical-align: middle;\r
    text-align: center;\r
    font-size: large;\r
  }

.mode-message {\r
  position: absolute;\r
  top: 10px;\r
  right: 10px;\r
  border-radius: 4px;\r
  color: silver;\r
  background-color: rgba(64, 64, 64, 0.75);\r
  display: flex;\r
  align-items: left;\r
  justify-content: left;\r
  opacity: 0;\r
}

.atom-info {\r
  margin: 10px;\r
  text-align: left;\r
}

.overlay {\r
  pointer-events: none;\r
}\r
`],sourceRoot:``}]);let s=o},591:e=>{var t=[];function n(e){for(var n=-1,r=0;r<t.length;r++)if(t[r].identifier===e){n=r;break}return n}function r(e,r){for(var a={},o=[],s=0;s<e.length;s++){var c=e[s],l=r.base?c[0]+r.base:c[0],u=a[l]||0,d=`${l} ${u}`;a[l]=u+1;var f=n(d),p={css:c[1],media:c[2],sourceMap:c[3],supports:c[4],layer:c[5]};if(f!==-1)t[f].references++,t[f].updater(p);else{var m=i(p,r);r.byIndex=s,t.splice(s,0,{identifier:d,updater:m,references:1})}o.push(d)}return o}function i(e,t){var n=t.domAPI(t);return n.update(e),function(t){if(t){if(t.css===e.css&&t.media===e.media&&t.sourceMap===e.sourceMap&&t.supports===e.supports&&t.layer===e.layer)return;n.update(e=t)}else n.remove()}}e.exports=function(e,i){var a=r(e||=[],i||={});return function(e){e||=[];for(var o=0;o<a.length;o++){var s=n(a[o]);t[s].references--}for(var c=r(e,i),l=0;l<a.length;l++){var u=n(a[l]);t[u].references===0&&(t[u].updater(),t.splice(u,1))}a=c}}},128:e=>{var t={};e.exports=function(e,n){var r=function(e){if(t[e]===void 0){var n=document.querySelector(e);if(window.HTMLIFrameElement&&n instanceof window.HTMLIFrameElement)try{n=n.contentDocument.head}catch{n=null}t[e]=n}return t[e]}(e);if(!r)throw Error(`Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.`);r.appendChild(n)}},51:e=>{e.exports=function(e){var t=document.createElement(`style`);return e.setAttributes(t,e.attributes),e.insert(t,e.options),t}},855:(e,t,n)=>{e.exports=function(e){var t=n.nc;t&&e.setAttribute(`nonce`,t)}},740:e=>{e.exports=function(e){if(typeof document>`u`)return{update:function(){},remove:function(){}};var t=e.insertStyleElement(e);return{update:function(n){(function(e,t,n){var r=``;n.supports&&(r+=`@supports (${n.supports}) {`),n.media&&(r+=`@media ${n.media} {`);var i=n.layer!==void 0;i&&(r+=`@layer${n.layer.length>0?` ${n.layer}`:``} {`),r+=n.css,i&&(r+=`}`),n.media&&(r+=`}`),n.supports&&(r+=`}`);var a=n.sourceMap;a&&typeof btoa<`u`&&(r+=`
/*# sourceMappingURL=data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(a))))} */`),t.styleTagTransform(r,e,t.options)})(t,e,n)},remove:function(){(function(e){if(e.parentNode===null)return!1;e.parentNode.removeChild(e)})(t)}}}},656:e=>{e.exports=function(e,t){if(t.styleSheet)t.styleSheet.cssText=e;else{for(;t.firstChild;)t.removeChild(t.firstChild);t.appendChild(document.createTextNode(e))}}}},a={};function o(e){var t=a[e];if(t!==void 0)return t.exports;var n=a[e]={id:e,exports:{}};return i[e](n,n.exports,o),n.exports}o.n=e=>{var t=e&&e.__esModule?()=>e.default:()=>e;return o.d(t,{a:t}),t},o.d=(e,t)=>{for(var n in t)o.o(t,n)&&!o.o(e,n)&&Object.defineProperty(e,n,{enumerable:!0,get:t[n]})},o.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),o.nc=void 0;var s={};o.d(s,{A:()=>O});var c=(l={default:()=>n},u={},o.d(u,l),u),l,u,d=(e=>{var t={};return o.d(t,e),t})({default:()=>r.default,useLayoutEffect:()=>r.useLayoutEffect,useRef:()=>r.useRef}),f=o(591),p=o.n(f),m=o(740),h=o.n(m),g=o(128),_=o.n(g),v=o(855),y=o.n(v),b=o(51),x=o.n(b),S=o(656),C=o.n(S),w=o(32),T={};T.styleTagTransform=C(),T.setAttributes=y(),T.insert=_().bind(null,`head`),T.domAPI=h(),T.insertStyleElement=x(),p()(w.A,T),w.A&&w.A.locals&&w.A.locals;var E=o(920),D={};function O(e){let{onInit:t,options:n}=e,r=(0,d.useRef)(),i=(0,d.useRef)();return(0,d.useLayoutEffect)((()=>{let e={axes:!1,fps:!1,...n?.settings};return function(e,t,n){if(!e.current){let r=new c.default(t);r.init()&&(e.current=r,r.run(),typeof n==`function`&&n(r))}}(r,{...n,container:i.current,settings:e},t),()=>function(e){e.current&&e.current.term(),e.current=null}(r)}),[t,n]),d.default.createElement(`div`,{className:w.z,ref:i},`Viewer`)}D.styleTagTransform=C(),D.setAttributes=y(),D.insert=_().bind(null,`head`),D.domAPI=h(),D.insertStyleElement=x(),p()(E.A,D),E.A&&E.A.locals&&E.A.locals;var k=s.A;export{k as default};