function e(e){let n=e.replace(/\r\n?/gu,`
`).split(`
`);if(n[3]?.includes(`V3000`)){let e=n.findIndex(e=>e.trimEnd()===`M  V30 BEGIN ATOM`),r=n.findIndex(e=>e.trimEnd()===`M  V30 END ATOM`);return e<5||r<=e?[]:n.slice(e+1,r).join(`
`).replace(/-\nM  V30 /gu,``).split(`
`).map(e=>/^M  V30\s+\d+\s+(?:"[^"]*"|\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\d+(?:\s|$)/u.exec(e)?.slice(1).map(t)??[])}let r=Number(n[3]?.slice(0,3));return!Number.isInteger(r)||r<1||!/^\s*\d+\s*$/u.test(n[3].slice(0,3))?[]:n.slice(4,4+r).map(e=>[0,10,20].map(n=>t(e.slice(n,n+10).trim())))}function t(e){return/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(e)?Number(e):NaN}export{e as t};