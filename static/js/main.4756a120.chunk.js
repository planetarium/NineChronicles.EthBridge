(this["webpackJsonpbridge-www"]=this["webpackJsonpbridge-www"]||[]).push([[0],{142:function(e,n){},151:function(e,n){},158:function(e,n,t){"use strict";t.r(n);var c=t(174),r=t(68),a=t(0),o=t.n(a),i=t(96),d=t.n(i),s=t(53),b=t(129),l=t(175),j=t(14),u=function(e){var n=e.connect;return Object(j.jsx)(l.a,{onClick:function(){return n()},children:"Connect Wallet"})},O=t(8),f=t(11),h=t(177),v=t(90),g=t.n(v),x=t(27),w=t(36),C=t(21),p=t(1),m=t(17),S=t(176),k=function(e){var n=e.onChange,t=e.label,c=Object(m.a)(e,["onChange","label"]);return Object(j.jsx)("div",{children:Object(j.jsx)(S.a,Object(p.a)({labelLeft:t,onChange:function(e){void 0!==n&&n(e.target.value)}},c))})},A=t(116),y=function(e){var n=e.address,t=Object(s.g)().chain,c=Object(a.useMemo)((function(){return(null===t||void 0===t?void 0:t.id)===A.a.id?"0xf203ca1769ca8e9e8fe1da9d147db68b6c919817":(null===t||void 0===t?void 0:t.id)===A.b.id?"0xeaa982f3424338598738c496153e55b1df11f625":"0x5F2e568E7085Ce18fA7b68e13fd5C04e99F044C4"}),[t]),r=Object(s.d)({addressOrName:n,token:c}),o=r.data,i=r.isLoading,d=r.error,b=Object(s.h)().data,u=Object(s.f)({addressOrName:c,contractInterface:["function burn(uint256 amount, bytes32 to) public"].concat(Object(f.a)(C.f)),signerOrProvider:b}),v=Object(a.useState)(""),p=Object(O.a)(v,2),m=p[0],S=p[1],y=Object(a.useState)("0"),N=Object(O.a)(y,2),E=N[0],F=N[1],I=Object(a.useMemo)((function(){try{return new g.a(E||"0").mul(new g.a(10).pow(18))}catch(e){return null}}),[E]);return Object(j.jsxs)("div",{className:"App",children:[Object(j.jsx)(k,{label:"Contract Address",value:c,readOnly:!0}),Object(j.jsxs)(h.a,{children:["Your wNCG : ",i?Object(j.jsx)(h.a,{children:"\ud83d\udd51"}):Object(j.jsx)(h.a,{weight:"bold",span:!0,children:void 0!==o?new g.a(o.value.toString()).div(new g.a(10).pow(o.decimals)).toString():null===d||void 0===d?void 0:d.message})]}),Object(j.jsx)(k,{label:"Amount",onChange:F}),Object(j.jsx)(k,{label:"To",onChange:S}),null!==u&&null!==I&&-1===I.toString().indexOf(".")&&Object(w.isAddress)(m)?Object(j.jsx)(l.a,{onClick:function(e){e.preventDefault(),console.log(u),u.burn(x.a.from(I.toString()),m+"0".repeat(24)).then(console.debug)},children:"Burn"}):Object(j.jsx)(h.a,{weight:"bold",children:"Fill corret values"})]})};var N=function(){var e=Object(s.c)(),n=e.address,t=e.isConnected,c=Object(s.e)({connector:new b.a}).connect;return t?void 0===n?Object(j.jsx)("b",{children:"Error occurred while fetching address."}):Object(j.jsx)(y,{address:n}):Object(j.jsx)(u,{connect:c})},E=Object(s.b)({autoConnect:!0,provider:function(e){return Object(r.getDefaultProvider)(e.chainId)}});d.a.render(Object(j.jsx)(o.a.StrictMode,{children:Object(j.jsx)(c.a,{children:Object(j.jsx)(s.a,{client:E,children:Object(j.jsx)(N,{})})})}),document.getElementById("root"))}},[[158,1,2]]]);
//# sourceMappingURL=main.4756a120.chunk.js.map