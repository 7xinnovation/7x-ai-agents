"use strict";var DialogEmbed=(()=>{var h="dialog-embed-style";function w(){let e=document.currentScript??document.querySelector("script[data-agent]"),t=e?.dataset??{},i=t.host||new URL(e?.src||location.href).origin;return{agent:t.agent||"default",host:i,locale:t.locale||"en",position:t.position==="bottom-left"?"bottom-left":"bottom-right",uaePassToken:t.uaepassToken||y(t.tokenKey)||x(t.tokenCookie)||void 0,tokenKey:t.tokenKey||p,tokenCookie:t.tokenCookie||b,bridgeUrl:t.bridgeUrl||void 0,positionPinned:t.position==="bottom-left"||t.position==="bottom-right"}}var p="accessToken",b="dlg_host_token";function x(e){let t=`${e||b}=`,i=String(document.cookie||"").split(";");for(let a of i){let d=a.trim();if(!d.startsWith(t))continue;let r=d.slice(t.length);if(!r)return null;try{let s=decodeURIComponent(r);return s.trim()?s.trim():null}catch{return r.trim()?r.trim():null}}return null}function y(e){try{let t=window.localStorage.getItem(e||p);return t&&t.trim()?t.trim():null}catch{return null}}function v(e){if(document.getElementById(h))return;let t=e.position==="bottom-left",i=`
  :root{--dlg-accent:#2626a1;--dlg-accent-2:#1c1c7d;--dlg-accent-fg:#fff;
    --dlg-bottom:24px;--dlg-side:24px;
    --dlg-left:${t?"var(--dlg-side)":"auto"};--dlg-right:${t?"auto":"var(--dlg-side)"}}
  .dlg-launcher{position:fixed;bottom:var(--dlg-bottom);left:var(--dlg-left);right:var(--dlg-right);z-index:2147483000;width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;padding:0;
    background:var(--dlg-accent);
    background:linear-gradient(180deg,color-mix(in srgb,var(--dlg-accent) 88%,#fff),var(--dlg-accent-2));
    color:var(--dlg-accent-fg);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 10px 26px -8px color-mix(in srgb,var(--dlg-accent) 55%,transparent),0 3px 8px rgba(16,24,40,.14),inset 0 0 0 1px rgba(255,255,255,.10),inset 0 1px 0 rgba(255,255,255,.22),inset 0 -2px 3px color-mix(in srgb,var(--dlg-accent-2) 60%,transparent);
    transition:transform .24s cubic-bezier(.16,1,.3,1),box-shadow .24s ease;will-change:transform;animation:dlg-pop .4s cubic-bezier(.16,1,.3,1) both}
  .dlg-launcher::before{content:"";position:absolute;inset:-7px;border-radius:inherit;z-index:-1;pointer-events:none;
    background:radial-gradient(closest-side,color-mix(in srgb,var(--dlg-accent) 32%,transparent),transparent);
    filter:blur(9px);animation:dlg-breathe 4.5s ease-in-out infinite}
  .dlg-launcher:hover::before{animation-play-state:paused;opacity:.85}
  .dlg-launcher.open::before{display:none}
  .dlg-launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 16px 34px -8px color-mix(in srgb,var(--dlg-accent) 62%,transparent),0 5px 12px rgba(16,24,40,.16),inset 0 0 0 1px rgba(255,255,255,.12),inset 0 1px 0 rgba(255,255,255,.22)}
  .dlg-launcher:active{transform:scale(.94)}
  .dlg-launcher svg{position:absolute;transition:opacity .2s ease,transform .28s cubic-bezier(.16,1,.3,1)}
  .dlg-launcher .ic-x{opacity:0;transform:rotate(-90deg) scale(.6)}
  .dlg-launcher.open .ic-chat{opacity:0;transform:rotate(90deg) scale(.6)}
  .dlg-launcher.open .ic-x{opacity:1;transform:none}
  .dlg-frame{position:fixed;border:none;z-index:2147483001;background:transparent;border-radius:22px;
    box-shadow:0 0 0 1px rgba(16,24,40,.07),0 30px 80px rgba(16,24,40,.28),0 8px 24px rgba(16,24,40,.16);
    opacity:0;visibility:hidden;transform:translateY(14px) scale(.98);transform-origin:bottom ${t?"left":"right"};
    transition:opacity .3s cubic-bezier(.16,1,.3,1),transform .3s cubic-bezier(.16,1,.3,1),visibility .3s,width .3s ease,height .3s ease,border-radius .3s ease}
  /* The panel never exceeds the window it is sitting in.
     404x640 is the size it WANTS; the max-* are the size it may have. Without
     them a browser window narrower than about 470px \u2014 or shorter than the panel
     plus the launcher \u2014 put part of the conversation off-screen, and the host
     page cannot correct that from its side. dvh where it is understood, so a
     mobile address bar sliding away does not leave a gap. */
  .dlg-frame.widget{bottom:calc(var(--dlg-bottom) + 72px);left:var(--dlg-left);right:var(--dlg-right);
    width:404px;height:640px;
    max-width:calc(100vw - 32px);
    max-height:calc(100vh - var(--dlg-bottom) - 88px);max-height:calc(100dvh - var(--dlg-bottom) - 88px)}
  .dlg-frame.full{inset:0;width:100vw;height:100vh;height:100dvh;border-radius:0;transform-origin:center}
  .dlg-frame.open{opacity:1;visibility:visible;transform:none}
  /* Narrow OR short: a landscape phone is 720px wide and 360px tall, and a
     panel that has to fit above a launcher in 360px is not a panel. */
  @media (max-width:640px),(max-height:520px){
    .dlg-frame.widget{inset:0;width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0}
  }
  @media (prefers-reduced-motion:reduce){.dlg-launcher{animation:none}.dlg-launcher::before{animation:none}.dlg-launcher,.dlg-launcher svg,.dlg-frame{transition:opacity .15s linear}}
  @keyframes dlg-pop{from{opacity:0;transform:translateY(10px) scale(.8)}to{opacity:1;transform:none}}
  @keyframes dlg-breathe{0%,100%{transform:scale(1);opacity:.45}50%{transform:scale(1.14);opacity:.75}}
  `,a=document.createElement("style");a.id=h,a.textContent=i,document.head.appendChild(a)}async function k(e){try{let t=await fetch(`${e.host}/api/agents/${encodeURIComponent(e.agent)}`);if(!t.ok)return;let i=await t.json(),a=i?.theme?.colors?.primary,d=i?.theme?.colors?.primaryForeground;a&&(document.documentElement.style.setProperty("--dlg-accent",a),document.documentElement.style.setProperty("--dlg-accent-2",`color-mix(in srgb, ${a} 86%, black)`)),d&&document.documentElement.style.setProperty("--dlg-accent-fg",d);let r=i?.theme?.launcher??{},s=document.documentElement.style;if(!e.positionPinned&&(r.position==="bottom-left"||r.position==="bottom-right")){let n=r.position==="bottom-left";s.setProperty("--dlg-left",n?"var(--dlg-side)":"auto"),s.setProperty("--dlg-right",n?"auto":"var(--dlg-side)")}let l=n=>typeof n=="number"&&Number.isFinite(n)&&n>=0&&n<=400?`${Math.round(n)}px`:null,c=l(r.offsetBottom),o=l(r.offsetSide);c&&s.setProperty("--dlg-bottom",c),o&&s.setProperty("--dlg-side",o)}catch{}}var C='<svg class="ic-chat" width="25" height="25" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4c-4.7 0-8.5 3-8.5 6.8 0 1.5.6 2.9 1.6 4.05-.16 1.02-.5 1.98-1.05 2.86-.2.32.02.74.4.72 1.4-.06 2.75-.42 3.9-1.06 1.1.42 2.34.65 3.65.65 4.7 0 8.5-3.05 8.5-6.87S16.7 4 12 4Zm-3.6 7.85a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm3.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm3.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z"/></svg>',E='<svg class="ic-x" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';function f(){let e=w();v(e),k(e);let t="closed",i=document.createElement("iframe");i.className="dlg-frame widget",i.title="Dialog assistant",i.allow="clipboard-write; microphone";let a=e.uaePassToken?`&upt=${encodeURIComponent(e.uaePassToken)}`:"";i.src=`${e.host}/embed/${encodeURIComponent(e.agent)}?locale=${e.locale}&embedded=1${a}`;let d=o=>i.contentWindow?.postMessage({source:"dialog-host",uaePassToken:o},e.host);window.Dialog={setUaePassToken:d};let r=e.uaePassToken??null,s=()=>{let o=y(e.tokenKey)??x(e.tokenCookie);o!==r&&(r=o,o&&d(o))};if(window.addEventListener("storage",o=>{(!o.key||o.key===(e.tokenKey||p))&&s()}),setInterval(s,2e3),e.bridgeUrl){let o="";try{o=new URL(e.bridgeUrl).origin}catch{o=""}if(o){let n=document.createElement("iframe");n.setAttribute("aria-hidden","true"),n.title="Dialog token bridge",n.style.cssText="position:absolute;width:0;height:0;border:0;visibility:hidden;left:-9999px;",n.src=e.bridgeUrl;let u=()=>n.contentWindow?.postMessage({source:"dialog-bridge-request"},o);window.addEventListener("message",m=>{if(m.origin!==o)return;let g=m.data;g?.source!=="dialog-bridge"||typeof g.token!="string"||!g.token||g.token!==r&&(r=g.token,d(g.token))}),n.addEventListener("load",()=>{u(),setInterval(u,5e3)}),document.body.appendChild(n)}}let l=document.createElement("button");l.className="dlg-launcher",l.setAttribute("aria-label","Open assistant"),l.innerHTML=C+E;function c(o){t=o,i.classList.toggle("open",o!=="closed"),i.classList.toggle("full",o==="full"),i.classList.toggle("widget",o==="widget"),l.classList.toggle("open",o!=="closed"),l.style.display=o==="full"?"none":"flex",document.documentElement.style.overflow=o==="full"?"hidden":""}l.addEventListener("click",()=>c(t==="closed"?"widget":"closed")),window.addEventListener("message",o=>{if(o.origin!==e.host)return;let n=o.data;n?.source==="dialog"&&(n.action==="expand"?c("full"):n.action==="collapse"?c("widget"):n.action==="close"&&c("closed"))}),document.body.appendChild(i),document.body.appendChild(l)}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",f):f();})();
