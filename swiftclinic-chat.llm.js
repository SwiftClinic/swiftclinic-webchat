/* SwiftClinic Webchat (LLM-integrated) - lightweight, readable build
   - Supports data-webhook-id or data-webhook-url
   - Persists sessionId in localStorage
   - Sends metadata (pageUrl, referrer, timezone, language, UTM)
   - Exposes window.SwiftClinicChat API: open, close, send, getSessionId, isOpen
*/
(function(){
  try{
    // Prevent double-initialization if an existing mounted instance is active.
    // Do NOT set the mounted flag here; we will set it only after successful init.
    try{
      if(window.__SwiftClinicChatMounted){ return; }
      if(window.SwiftClinicChat && typeof window.SwiftClinicChat.send === 'function' && window.__SwiftClinicChatMounted){ return; }
    }catch(_){ }
    var scriptEl = document.currentScript || (function(){ var s=document.getElementsByTagName('script'); return s[s.length-1] })();
    if(!scriptEl) return;
    var ds = scriptEl.dataset || {};

    var webhookId  = ds.webhookId || '';
    var webhookUrl = ds.webhookUrl || ds.webhookurl || '';
    if(!webhookId){ try{ var u=new URL(scriptEl.src); webhookId = u.searchParams.get('webhookId') || '' }catch(_){} }

    var apiBase = (function(){ if(ds.apiBase) return String(ds.apiBase).replace(/\/$/, ''); try{ return new URL(scriptEl.src).origin }catch(_){ return window.location.origin } })();
    var endpoint = webhookUrl ? webhookUrl.replace(/\/$/, '') : (apiBase + '/webhook/' + encodeURIComponent(webhookId));
    if(!webhookId && !webhookUrl){ console.warn('[SwiftClinicChat] Missing webhook id/url'); return; }
    var apiOriginForAux = (function(){ try{ return webhookUrl ? new URL(webhookUrl).origin : apiBase }catch(_){ return apiBase } })();

    var clinicName   = ds.clinicName || 'Clinic';
    var primaryColor = ds.primaryColor || '#2563eb';
    var secondaryColor = ds.secondaryColor || ds.accentColor || '#22c55e';
    var fontFamily   = ds.fontFamily || ds.font || "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif";
    var badgeBgColor = ds.badgeColor || ds.statusBadgeColor || '#22c55e';
    var badgeTextColor = ds.badgeTextColor || '#ffffff';
    var conversationStarters = (function(){
      var raw = ds.conversationStarters || ds.conversationStartersJson || '';
      if(!raw) return [];
      try {
        if (typeof raw === 'string' && raw.trim().startsWith('[')) return JSON.parse(raw);
      } catch(_){}
      if (typeof raw === 'string') return raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      if (Array.isArray(raw)) return raw;
      return [];
    })();
    var backgroundColor  = ds.backgroundColor || ds.chatBgColor || ds.chatbgcolor || ds.chatBackground || ds.chatbackground || ds.bgColor || '#f8fafc';
    var fontColor   = ds.fontColor || '#0f172a';
    var welcomeMessage = ds.welcomeMessage || '';
    var position     = (ds.position || 'bottom-right').toLowerCase();
    var autoOpen     = String(ds.autoOpen||'false')==='true';
    var uiScale     = (function(){ var v=parseFloat(ds.scale||ds.uiScale||'1'); return (v&&v>0)? v : 1; })();

    // Namespaced session storage key: API host + webhookId (distinguish monolith vs PMS hosts)
    var scHost = (function(){
      try{ return (new URL(endpoint)).host || 'unknown'; }catch(_){ }
      try{ return (location && location.host) ? String(location.host) : 'unknown'; }catch(_){ return 'unknown' }
    })();
    var SESSION_KEY = 'swiftclinic_chat_session:' + scHost + ':' + (webhookId || '');
    var sessionId = (function(){ try{ return localStorage.getItem(SESSION_KEY) || '' }catch(_){ return '' } })();
    var firstPost = true;
    var handshakePromise = null;
    var isFirstUserSend = true;
    var sendInFlight = false;
    var dispatchGuard = false; // prevents duplicate send dispatch across multiple handlers
    var lastTriggerSource = 'unknown';
    var debugEnabled = (function(){
      try{
        var flag = String(ds.debug||'');
        if(!flag){ try{ var su=new URL(scriptEl.src); flag = su.searchParams.get('debug') || ''; }catch(_){ } }
        if(!flag){ try{ var lu=new URL(location.href); flag = lu.searchParams.get('swiftclinic_debug') || lu.searchParams.get('sc_debug') || ''; }catch(_){ } }
        if(!flag){ try{ flag = localStorage.getItem('swiftclinic_debug') || sessionStorage.getItem('swiftclinic_debug') || ''; }catch(_){ } }
        if(!flag){ try{ flag = (window && window.SwiftClinicChatDebug) ? '1' : ''; }catch(_){ } }
        return String(flag)==='1';
      }catch(_){ return false }
    })();
    try{ if(debugEnabled){ console.info('[SwiftClinicChat] debug enabled'); } }catch(_){ }
    var haveServerSession = !!sessionId;
    var sessionAcquirePromise = null;
    var pendingSends = [];
    var isReload = (function(){ try{ var nav = (performance && performance.getEntriesByType) ? performance.getEntriesByType('navigation')[0] : null; if(nav && nav.type){ return nav.type === 'reload'; } if(performance && performance.navigation){ return performance.navigation.type === 1; } }catch(_){ } return false; })();
    try{ window.addEventListener('beforeunload', function(){ try{ localStorage.removeItem(SESSION_KEY) }catch(_){ } sessionId=''; isFirstUserSend=true; firstPost=true; haveServerSession=false; }); }catch(_){ }

    // Optional: allow forcing a fresh session via data-new-session="1"
    try{
      var forceNewOnLoad = (String(scriptEl.getAttribute('data-new-session')||'') === '1');
      if(forceNewOnLoad){ try{ localStorage.removeItem(SESSION_KEY) }catch(_){ } sessionId=''; firstPost=true; }
    }catch(_){ }

    // If this page load is a browser reload, force a fresh client session
    try{ if(isReload){ localStorage.removeItem(SESSION_KEY); sessionId=''; firstPost=true; isFirstUserSend=true; haveServerSession=false; } }catch(_){ }

    var host = document.createElement('div');
    host.style.position='fixed'; host.style.zIndex='2147483647'; host.style.bottom='20px';
    host.style.right = position.indexOf('right')>=0 ? '20px' : '';
    host.style.left  = position.indexOf('left')>=0  ? '20px' : '';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode:'open' });
    // Optional font loader for custom fonts
    try{
      var googleFont = ds.googleFont || ds.fontGoogle || '';
      var fontUrl = ds.fontUrl || '';
      if(googleFont){
        var gf = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(googleFont) + '&display=swap';
        var link = document.createElement('link'); link.rel='stylesheet'; link.href=gf; root.appendChild(link);
      } else if(fontUrl){
        var link2 = document.createElement('link'); link2.rel='stylesheet'; link2.href=fontUrl; root.appendChild(link2);
      }
    }catch(_){ }

    var style = document.createElement('style');
    style.textContent = "\n:host{all:initial;transform:scale("+uiScale+");transform-origin: bottom "+(position.indexOf('right')>=0?"right":"left")+";}\n.btn{position:fixed;bottom:20px;" + (position.indexOf('right')>=0?"right:20px;":"left:20px;") + "width:56px;height:56px;border-radius:16px;background:"+primaryColor+";color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:pointer;transition:transform .12s ease, box-shadow .18s ease, filter .12s ease}\n.btn:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 18px 44px rgba(0,0,0,.30);filter:brightness(1.05)}\n.btn svg{display:block;width:26px;height:26px}\n@keyframes fade-in-fwd{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}\n.panel.open{animation:fade-in-fwd 0.6s cubic-bezier(0.39,0.575,0.565,1) both}\n.panel{position:fixed;bottom:90px;" + (position.indexOf('right')>=0?"right:20px;":"left:20px;") + "width:420px;max-width:calc(100vw - 40px);height:600px;max-height:calc(100vh - 120px);background:"+backgroundColor+";border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(2,6,23,.25);display:none;font-family:"+fontFamily+";border:1px solid #e5e7eb;box-sizing:border-box;padding-bottom:12px;display:flex;flex-direction:column;color:"+fontColor+"}\n.header{min-height:72px;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;color:"+fontColor+";background:"+secondaryColor+";border-bottom:1px solid #e5e7eb;box-sizing:border-box}\n.title{font-weight:700;letter-spacing:.2px;color:"+fontColor+";display:inline-flex;align-items:center;gap:8px;line-height:1.25}\n.badge{font-size:11px;padding:2px 6px;border-radius:999px;background:"+badgeBgColor+";color:"+badgeTextColor+";margin-left:0;font-weight:600;opacity:.95}\n.close{background:#0f172a10;border:none;color:"+fontColor+";width:32px;height:32px;border-radius:10px;cursor:pointer}\n.messages{width:418.5px;height:345px;min-height:345px;max-height:345px;overflow:auto;padding:16px;background:"+backgroundColor+";scroll-behavior:smooth;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:8px}\n.msg{max-width:82%;padding:8px 12px;border-radius:12px;line-height:1.4;font-size:14px;border:1px solid #e5e7eb;background:"+secondaryColor+";color:"+fontColor+";width:fit-content;align-self:flex-start;box-sizing:border-box;word-break:break-word;white-space:pre-wrap} .user{background:"+secondaryColor+";align-self:flex-end;margin-left:auto;margin-right:12px;border-top-right-radius:6px} .bot{background:"+secondaryColor+";align-self:flex-start;margin-right:auto;margin-left:8px;border-top-left-radius:6px}\n.msg .md{color:"+fontColor+"} .msg .md p{margin:0} .msg .md p + p{margin-top:6px}\n.msg .md a{color:"+primaryColor+";text-decoration:none}.msg .md a:hover{text-decoration:underline}\n.msg .md pre{background:#0b12201a;padding:10px;border-radius:10px;overflow:auto}.msg .md code{background:#0b12200d;padding:2px 4px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Roboto Mono',monospace;font-size:12px}\n.msg .md h1,.msg .md h2,.msg .md h3{margin:.2em 0 .3em;font-weight:700}.msg .md h1{font-size:18px}.msg .md h2{font-size:16px}.msg .md h3{font-size:15px}\n.msg .md blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #cbd5e1;background:#0b12200d;border-radius:10px}\n.typing-bubble{background:"+secondaryColor+";border-top-left-radius:6px;color:"+fontColor+";width:fit-content;align-self:flex-start}\n.footer{display:flex;align-items:center;gap:10px;padding:10px 16px 28px;border-top:1px solid #e5e7eb;background:"+backgroundColor+";box-sizing:border-box}\n.input{flex:1;height:36px;border:1px solid #e5e7eb;border-radius:10px;padding:0 12px;font-size:14px;transition:border-color .15s ease;box-sizing:border-box}.input:focus{outline:none;border-color:"+primaryColor+"}.send{height:36px;padding:0 10px;background:"+primaryColor+";color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600}\n.lang{margin-left:auto;margin-right:10px;display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:4px 8px;box-shadow:0 1px 2px rgba(0,0,0,.03)}\n.lang img{width:16px;height:12px;border-radius:2px;display:block}\n.lang select{border:none;background:transparent;outline:none;font-size:12px;color:"+fontColor+";padding:2px 0;appearance:none;cursor:pointer}\n.lang select:focus{outline:none}" +
      "\n.typing{display:none;color:#475569;font-size:13px;padding:2px 16px 8px}\n.dots{display:inline-flex;gap:4px}.dots span{width:6px;height:6px;border-radius:50%;background:#94a3b8;display:block;animation:blink 1s infinite}.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}\n.brand{display:flex;justify-content:center;align-items:center;gap:8px;padding:10px 0 16px;background:"+backgroundColor+";border-top:1px solid #e5e7eb}\n.brand-link{display:inline-flex;align-items:center;gap:8px;color:"+fontColor+";text-decoration:none;font-size:12px;font-weight:600;padding:6px 10px;border-radius:8px;transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease}\n.brand-link:hover{background:#f1f5f9;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.04)}\n.brand img{height:22px;width:auto;display:block}\n.starters{display:flex;gap:8px;overflow-x:auto;padding:6px 16px 2px 16px;margin:4px -16px 6px -16px;opacity:0;transform:translateY(4px);transition:opacity .25s ease, transform .25s ease;box-sizing:border-box}\n.starters.show{opacity:1;transform:translateY(0)}\n.starters::-webkit-scrollbar{height:0}\n.chip{background:"+primaryColor+";color:#fff;border:none;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex:0 0 auto;box-shadow:0 1px 2px rgba(0,0,0,.06)}\n.chip:hover{filter:brightness(0.95)}\n.chip:active{transform:scale(0.98)}\n";
    root.appendChild(style);

    var panel = document.createElement('div'); panel.className='panel'; panel.style.fontFamily = fontFamily;
    panel.innerHTML = ''+
      '<div class="header"><div class="title">'+escapeHtml(clinicName)+'<span class="badge">Online</span></div><div class="lang" id="sc-lang"><img id="sc-lang-flag" alt=""/><select id="sc-lang-select"></select></div><button class="close" aria-label="Close">×</button></div>'+
      '<div class="messages" id="sc-msgs"></div>'+
      '<div class="footer"><input id="sc-input" class="input" type="text" placeholder="Type a message..."/><button id="sc-send" class="send" type="button">Send</button></div>'+
      '<div class="brand"><a class="brand-link" href="https://www.swiftclinic.ai" target="_blank" rel="noopener noreferrer"><span>Powered by</span><img src="https://i.imgur.com/ZTzanHB.png" alt="SwiftClinic"/></a></div>';
    root.appendChild(panel);
    // Ensure closed by default
    panel.style.display = 'none';

    var btn = document.createElement('button'); btn.className='btn';
    var iconChat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-4 4v-4H5a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4z"/></svg>';
    var iconClose = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    btn.innerHTML = iconChat; btn.setAttribute('aria-label','Open chat'); root.appendChild(btn);

    var msgs = panel.querySelector('#sc-msgs');
    var startersEl = panel.querySelector('#sc-starters');
    var input = panel.querySelector('#sc-input');
    var sendBtn = panel.querySelector('#sc-send');
    var closeBtn = panel.querySelector('.close');
    var langWrap = panel.querySelector('#sc-lang');
    var langSelect = panel.querySelector('#sc-lang-select');
    var langFlag = panel.querySelector('#sc-lang-flag');
    var opened = false;

    // Language selector state
    var langStorageKey = 'swiftclinic_ui_lang_' + (webhookId || 'default');
    var defaultLang = (navigator.language || 'en').toLowerCase().split('-')[0] || 'en';
    var uiLanguage = (function(){ try{ return localStorage.getItem(langStorageKey) || defaultLang }catch(_){ return defaultLang } })();
    var allowedLangs = [];

    function normalizeAllowed(input){
      try{
        var arr = [];
        if(!input) return arr;
        if(Array.isArray(input)) arr = input.slice();
        else if(typeof input === 'string'){
          var s = input.trim();
          if(s.startsWith('[')) { try{ arr = JSON.parse(s); }catch(_){ arr = s.split(','); } }
          else arr = s.split(',');
        } else if(typeof input === 'object'){
          if(Array.isArray(input.allowed)) arr = input.allowed.slice();
        }
        arr = arr.map(function(code){ return String(code||'').trim(); }).filter(Boolean);
        // validate ISO 639-1 with optional region
        var re = /^[a-zA-Z]{2}(?:[-_][a-zA-Z]{2})?$/;
        arr = arr.filter(function(code){ return re.test(code); }).map(function(code){ return code.replace('_','-').toLowerCase(); });
        // de-duplicate
        var seen = {}; var out = [];
        arr.forEach(function(c){ if(!seen[c]){ seen[c]=1; out.push(c) } });
        return out;
      }catch(_){ return []; }
    }
    function applyAllowed(list){
      var norm = normalizeAllowed(list);
      if(norm.length){
        allowedLangs = norm; // preserve incoming order
        if(allowedLangs.indexOf(uiLanguage) === -1){
          uiLanguage = allowedLangs[0];
          try{ localStorage.setItem(langStorageKey, uiLanguage) }catch(_){ }
        }
        try{
          renderLangOptions();
          if(langSelect){ langSelect.value = uiLanguage; }
          if(langFlag){ langFlag.src = codeToFlagUrl(uiLanguage); }
        }catch(_){ }
      }
    }
    function codeToRegionDefault(code){
      var base = (code||'en').toLowerCase();
      if(base==='en') return 'GB'; if(base==='fr') return 'FR'; if(base==='de') return 'DE'; if(base==='es') return 'ES'; if(base==='it') return 'IT'; if(base==='pt') return 'PT';
      return (base.length===2? base.toUpperCase(): 'US');
    }
    function codeToDisplay(code){
      try{ var d = new Intl.DisplayNames([code], { type:'language' }); return d.of(code) || code }catch(_){
        var map={en:'English',fr:'Français',de:'Deutsch',es:'Español',it:'Italiano',pt:'Português'}; return map[code]||code;
      }
    }
    function codeToFlagUrl(code){
      var region = code.split('-')[1] || codeToRegionDefault(code);
      var lower = String(region).toLowerCase();
      // uses flagcdn svg fallback
      return 'https://flagcdn.com/16x12/'+lower+'.png';
    }
    function renderLangOptions(){
      try{
        var list = allowedLangs && allowedLangs.length ? allowedLangs : ['en','fr','de','es','it','pt'];
        langSelect.innerHTML = list.map(function(code){ var label = codeToDisplay(code); return '<option value="'+code+'"'+(code===uiLanguage?' selected':'')+'>'+label+'</option>'; }).join('');
        langFlag.src = codeToFlagUrl(uiLanguage);
      }catch(_){ }
    }
    function fetchAllowed(){
      try{
        return fetch(apiOriginForAux + '/translation/allowed').then(function(r){ return r.json(); }).then(function(j){
          if(j){ if(Array.isArray(j.allowed)){ applyAllowed(j.allowed); } else { applyAllowed(j); }
          } else { renderLangOptions(); }
        }).catch(function(){ renderLangOptions(); return Promise.resolve(); });
      }catch(_){ renderLangOptions(); return Promise.resolve(); }
    }
    langSelect.addEventListener('change', function(){ uiLanguage = langSelect.value || 'en'; try{ localStorage.setItem(langStorageKey, uiLanguage) }catch(_){ } langFlag.src = codeToFlagUrl(uiLanguage); });

    btn.addEventListener('click', function(){ toggle(); });
    closeBtn.addEventListener('click', function(){ toggle(false); });
    sendBtn.addEventListener('click', function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){ } lastTriggerSource='send-button'; if(debugEnabled) try{ console.debug('[SwiftClinicChat] trigger=send-button'); }catch(_){ } sendMessage(); });
    var enterDebounce = false;
    input.addEventListener('keydown', function(e){
      if(e.key==='Enter'){
        try{ e.preventDefault(); e.stopPropagation(); }catch(_){ }
        if(e.repeat || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if(enterDebounce) return;
        enterDebounce = true;
        setTimeout(function(){ enterDebounce=false; }, 250);
        lastTriggerSource='enter-key'; if(debugEnabled) try{ console.debug('[SwiftClinicChat] trigger=enter-key'); }catch(_){ }
        sendMessage();
      }
    });
    // initialize language dropdown
    try{ langFlag.src = (function(){ try{ return codeToFlagUrl(uiLanguage) }catch(_){ return '' } })(); }catch(_){ }
    fetchAllowed();

    function shortHash(str){ try{ str=String(str||''); var h=0; for(var i=0;i<str.length;i++){ h = (h*31 + str.charCodeAt(i)) >>> 0 } return h.toString(36); }catch(_){ return '0' } }
    var keySuffix = (webhookId || (function(){ try{ return btoa(endpoint).slice(0,16) }catch(_){ return 'url' } })());
    var welcomeKey = 'swiftclinic_welcome_open_' + keySuffix + '_' + shortHash(welcomeMessage); // session-only, varies by message text
    var welcomeShown = (function(){ try{ return sessionStorage.getItem(welcomeKey) === '1' }catch(_){ return false } })();
    var appendedWelcomeThisOpen = false;
    var startersShown = false;
    var startersDismissed = false; // once user sends, never show again this session
    function toggle(show){
      opened = show===undefined ? !opened : !!show;
      panel.style.display = opened ? 'block' : 'none';
      if(opened){ panel.classList.add('open'); } else { panel.classList.remove('open'); }
      btn.innerHTML = opened ? iconClose : iconChat;
      btn.setAttribute('aria-label', opened ? 'Close chat' : 'Open chat');
      if(opened){
        input.focus();
        if(!welcomeShown && welcomeMessage && !appendedWelcomeThisOpen && msgs.childElementCount===0){ append('bot', welcomeMessage); appendedWelcomeThisOpen = true; welcomeShown = true; try{ sessionStorage.setItem(welcomeKey, '1') }catch(_){ } if(!startersDismissed){ renderStarters(); } }
        if (!handshakePromise) { handshakePromise = handshake(); }
      } else {
        appendedWelcomeThisOpen = false;
      }
    }

    function renderStarters(){
      try{
        if(startersShown || startersDismissed) return;
        if(!Array.isArray(conversationStarters) || conversationStarters.length===0) return;
        var existing = msgs.querySelector('#sc-starters'); if(existing) { startersShown = true; return; }
        var bar = document.createElement('div');
        bar.id = 'sc-starters';
        bar.className = 'starters';
        conversationStarters.forEach(function(label){
          var chip = document.createElement('button');
          chip.type='button'; chip.className='chip'; chip.textContent=String(label);
          chip.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); var text=String(label); lastTriggerSource='starter-chip'; if(debugEnabled) try{ console.debug('[SwiftClinicChat] trigger=starter-chip'); }catch(_){ } input.value = text; startersDismissed = true; hideStarters(); sendMessage(text); input.value=''; });
          bar.appendChild(chip);
        });
        msgs.appendChild(bar);
        // trigger fade-in next tick
        requestAnimationFrame(function(){ bar.classList.add('show'); });
        startersShown = true;
        msgs.scrollTop = msgs.scrollHeight;
      }catch(_){ }
    }
    function hideStarters(){ try{ var s = msgs.querySelector('#sc-starters'); if(s){ s.remove(); } startersShown=false; }catch(_){ } }

    function append(role, text){
      var el = document.createElement('div');
      el.className = 'msg ' + (role==='user' ? 'user' : 'bot');
      if(role==='user'){
        el.innerHTML = '<div class="md">'+escapeHtml(String(text||'')).replace(/\n/g,'<br/>')+'</div>';
      } else {
        el.innerHTML = '<div class="md">'+renderMarkdown(String(text||''))+'</div>';
      }
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
    }

    var typingShownAt = 0;
    function finishTypingWith(text){
      var delay = Math.max(0, 2000 - (Date.now() - typingShownAt));
      setTimeout(function(){
        var t = msgs.querySelector('#sc-typing-bubble');
        if(t){
          t.id = '';
          t.className = 'msg bot';
          t.innerHTML = '<div class="md">'+renderMarkdown(String(text||''))+'</div>';
          msgs.scrollTop = msgs.scrollHeight;
          if(!startersShown && !startersDismissed && msgs.childElementCount>0){ renderStarters(); }
        } else {
          append('bot', String(text||''));
          if(!startersShown && !startersDismissed && msgs.childElementCount>0){ renderStarters(); }
        }
      }, delay);
    }
    function showTyping(show){
      if(show){
        typingShownAt = Date.now();
        var t = msgs.querySelector('#sc-typing-bubble');
        if(!t){
          t = document.createElement('div');
          t.id = 'sc-typing-bubble';
          t.className = 'msg bot typing-bubble';
          t.innerHTML = '<span class="dots" style="display:inline-flex;gap:4px"><span></span><span></span><span></span></span>';
          msgs.appendChild(t);
        }
        t.style.display = 'inline-block';
        t.style.width = 'auto';
        msgs.scrollTop = msgs.scrollHeight;
      } else {
        var delay = Math.max(0, 2000 - (Date.now() - typingShownAt));
        setTimeout(function(){ var t = msgs.querySelector('#sc-typing-bubble'); if(t){ t.remove(); } }, delay);
      }
    }

    // Safe, lightweight Markdown renderer (basic subset)
    function renderMarkdown(input){
      var s = String(input||'');
      s = escapeHtml(s);
      s = s.replace(/```([\s\S]*?)```/g, function(_, code){ return '<pre><code>'+escapeHtml(code)+'</code></pre>'; });
      s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      s = s.replace(/^(?:- |\* )(.*)(?:\n(?:- |\* ).+)*$/gm, function(block){
        var items = block.split(/\n/).map(function(line){ return line.replace(/^(?:- |\* )/,'').trim(); }).filter(Boolean);
        return '<ul>'+items.map(function(it){ return '<li>'+it+'</li>'; }).join('')+'</ul>';
      });
      s = s.replace(/^\d+\. (.*)(?:\n\d+\. .+)*$/gm, function(block){
        var items = block.split(/\n/).map(function(line){ return line.replace(/^\d+\. /,'').trim(); }).filter(Boolean);
        return '<ol>'+items.map(function(it){ return '<li>'+it+'</li>'; }).join('')+'</ol>';
      });
      // Blockquotes: group consecutive lines starting with '>' (support after escaping as &gt;)
      s = s.replace(/(^(?:&gt;|>)\s?.*(?:\n(?:&gt;|>)\s?.*)*)/gm, function(block){
        var inner = block.split(/\n/).map(function(line){ return line.replace(/^(?:&gt;|>)\s?/, ''); }).join('\n');
        // render inner paragraphs with <br/> between lines
        inner = inner.split(/\n{2,}/).map(function(p){ return '<p>'+p.replace(/\n/g,'<br/>')+'</p>'; }).join('');
        return '<blockquote>'+inner+'</blockquote>';
      });
      s = s.split(/\n{2,}/).map(function(p){
        if(/^\s*<\/?(ul|ol|pre|h1|h2|h3|blockquote)/.test(p)) return p;
        return '<p>'+p.replace(/\n/g,'<br/>')+'</p>';
      }).join('');
      return s;
    }

    function buildMetadata(includeForceFlag){
      try{
        var url = new URL(location.href); var params = url.searchParams; var utm = {};
        ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){ var v=params.get(k); if(v) utm[k]=v });
        var tz=''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' }catch(_){ }
        var meta = { pageUrl: location.href, referrer: document.referrer||'', timezone: tz, language: (navigator.language||''), utm: utm, welcomeMessage: welcomeMessage };
        var storedId = (function(){ try{ return localStorage.getItem(SESSION_KEY) || '' }catch(_){ } try{ return (window && window.__SwiftClinicSessionId) || '' }catch(_){ } return '' })();
        var effectiveId = sessionId || storedId;
        // On a force-new send, do NOT include any prior sessionId in metadata
        if(!includeForceFlag){
          if(effectiveId){ meta.sessionId = effectiveId; }
        }
        if(includeForceFlag){ meta.forceNewSession = true; }
        return meta;
      }catch(_){ var fallback = { pageUrl: location.href, referrer: document.referrer||'', welcomeMessage: welcomeMessage }; if(!includeForceFlag){ if(sessionId){ fallback.sessionId = sessionId; } } if(includeForceFlag){ fallback.forceNewSession = true; } return fallback }
    }

    function extractSessionId(res){
      try{
        var sid = '';
        if(res && res.data){ if(res.data.sessionId){ sid = String(res.data.sessionId); } else if(res.data.session_id){ sid = String(res.data.session_id); } }
        // Ignore metadata echoes or generic ids; only trust explicit sessionId fields
        if(/^ws_/.test(sid)){ return ''; }
        return sid;
      }catch(_){ return ''; }
    }

    function handshake(){
      showTyping(true);
      var storedIdHS = (function(){ try{ return localStorage.getItem(SESSION_KEY) || '' }catch(_){ } try{ return (window && window.__SwiftClinicSessionId) || '' }catch(_){ } return '' })();
      var effectiveIdHS = sessionId || storedIdHS;
      var hsHeaders = { 'Content-Type':'application/json' };
      // If we have an id, send it; otherwise omit any session headers and let server create a new one
      if(effectiveIdHS){ hsHeaders['X-Session-ID'] = effectiveIdHS; }
      if(debugEnabled){ try{ hsHeaders['X-Debug-Event'] = 'handshake'; hsHeaders['X-Debug-Enabled']='1'; }catch(_){ } }
      return fetch(endpoint, {
        method: 'POST',
        headers: hsHeaders,
        body: JSON.stringify({ message: '', sessionId: (effectiveIdHS?effectiveIdHS:undefined), userConsent: true, uiLanguage: uiLanguage, metadata: (function(m){ try{ m.init = true; }catch(_){ } return m; })(buildMetadata(false)) })
      }).then(function(r){ return r.text(); }).then(function(t){ try{ return t?JSON.parse(t):{} }catch(_){ return {} } }).then(function(res){
        var data = (res && res.data) || {};
        try{
          var allowedFromServer = (data && data.metadata && (data.metadata.translation_allowed || data.metadata.translationAllowed || data.metadata.allowed_languages)) || data.translation_allowed || data.translationAllowed;
          if(allowedFromServer){ applyAllowed(allowedFromServer); }
        }catch(_){ }
        var sid = extractSessionId(res);
        if(sid){ sessionId = sid; haveServerSession=true; try{ localStorage.setItem(SESSION_KEY, sessionId) }catch(_){ } try{ window.__SwiftClinicSessionId = sessionId }catch(_){ } }
        // Prefer configured welcome on first open if provided
        var preferLocalWelcome = (!welcomeShown && welcomeMessage && msgs.childElementCount === 0);
        if (preferLocalWelcome){
          finishTypingWith(welcomeMessage);
          try{ sessionStorage.setItem(welcomeKey, '1') }catch(_){ }
          welcomeShown = true;
        } else if (data.message){
          finishTypingWith(data.message);
        } else if (welcomeMessage && !welcomeShown){
          finishTypingWith(welcomeMessage);
          try{ sessionStorage.setItem(welcomeKey, '1') }catch(_){ }
          welcomeShown = true;
        } else {
          showTyping(false);
        }
      }).catch(function(){ showTyping(false); /* ignore */ }).finally(function(){ firstPost = false; });
    }

    function sendMessage(forcedText){
      var text = (typeof forcedText === 'string' ? forcedText : (input.value || '')).trim(); if(!text) return;
      if(dispatchGuard || sendInFlight){ return; }
      dispatchGuard = true;
      startersDismissed = true;
      performSend(text);
    }

    function performSend(text){
      // If we're still acquiring the very first server session, queue this send
      if(sessionAcquirePromise && !haveServerSession){
        pendingSends.push(String(text||''));
        dispatchGuard = false;
        return;
      }
      if(sendInFlight){ return; }
      sendInFlight = true;
      dispatchGuard = false;
      startersDismissed = true;
      try{ hideStarters(); }catch(_){ }
      append('user', String(text||''));
      input.value='';
      showTyping(true);
      var sendNow = function(){
        var storedIdSN = (function(){ try{ return localStorage.getItem(SESSION_KEY) || '' }catch(_){ } try{ return (window && window.__SwiftClinicSessionId) || '' }catch(_){ } return '' })();
        var effectiveIdSN = sessionId || storedIdSN;
        // Always send exactly one of: X-Session-ID or X-New-Session
        var shouldForceNew = !effectiveIdSN;
        var msgId = (function(){ try{ return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }catch(_){ return 'msg_'+Date.now(); } })();
        var sendHeaders = { 'Content-Type':'application/json' };
        if(!shouldForceNew){ sendHeaders['X-Session-ID'] = (effectiveIdSN||''); }
        if(debugEnabled){ try{ sendHeaders['X-Debug-Enabled']='1'; sendHeaders['X-Debug-Trigger'] = String(lastTriggerSource||'unknown'); sendHeaders['X-Debug-Client-Message-Id'] = msgId; }catch(_){ } }
        var p = fetch(endpoint, {
          method: 'POST',
          headers: (function(h){ try{ delete h['X-Client-Message-Id']; }catch(_){ } return h; })(sendHeaders),
          body: JSON.stringify({ message: String(text||''), sessionId: (shouldForceNew ? undefined : (effectiveIdSN||undefined)), userConsent: true, uiLanguage: uiLanguage, metadata: (function(m){ try{ m.clientMessageId = msgId; m.clientTrigger = String(lastTriggerSource||'unknown'); }catch(_){ } return m; })(buildMetadata(shouldForceNew)) })
        }).then(function(r){ return r.text(); }).then(function(t){ try{ return t?JSON.parse(t):{} }catch(_){ return {} } }).then(function(res){
          var data = (res && res.data) || {};
          try{
            var allowedFromServer2 = (data && data.metadata && (data.metadata.translation_allowed || data.metadata.translationAllowed || data.metadata.allowed_languages)) || data.translation_allowed || data.translationAllowed;
            if(allowedFromServer2){ applyAllowed(allowedFromServer2); }
          }catch(_){ }
          var sid2 = extractSessionId(res);
          if(sid2){ sessionId = sid2; haveServerSession=true; try{ localStorage.setItem(SESSION_KEY, sessionId) }catch(_){ } try{ window.__SwiftClinicSessionId = sessionId }catch(_){ } }
          if(data.message){ finishTypingWith(data.message); }
          else { showTyping(false); }
        }).catch(function(){ finishTypingWith('Sorry, something went wrong. Please try again.'); }).finally(function(){
          firstPost = false;
          if(shouldForceNew){ isFirstUserSend = false; }
          sendInFlight = false;
          // If we were acquiring session, release waiters and flush queue
          if(shouldForceNew){ sessionAcquirePromise = null; }
          try{
            if(pendingSends.length && haveServerSession){
              var queue = pendingSends.slice(); pendingSends.length = 0;
              // Send queued messages sequentially to preserve order
              (function sendNext(){
                if(!queue.length) return;
                var next = queue.shift();
                performSend(next);
                // Defer chaining to allow sendInFlight lifecycle
                setTimeout(sendNext, 0);
              })();
            }
          }catch(_){ }
        });
        if(shouldForceNew){ sessionAcquirePromise = p; }
      };
      if(firstPost){
        if(!handshakePromise){ handshakePromise = handshake(); }
        // attach only once per dispatch to avoid duplicate finally callbacks
        var attached = false;
        try{
          handshakePromise.finally(function(){ if(attached) return; attached = true; sendNow(); });
        }catch(_){ sendNow(); }
      } else {
        sendNow();
      }
    }

    // Starters are rendered right after the welcome message via renderStarters()

    // Public API
    try{ window.SwiftClinicChat = { open: function(){ toggle(true) }, close: function(){ toggle(false) }, send: function(t){ if(typeof t==='string'){ performSend(String(t)); } }, getSessionId: function(){ return sessionId||'' }, isOpen: function(){ return !!opened }, setUiLanguage: function(code){ uiLanguage=String(code||'en').toLowerCase(); try{ localStorage.setItem(langStorageKey, uiLanguage) }catch(_){ } if(langSelect){ langSelect.value = uiLanguage; langFlag.src = codeToFlagUrl(uiLanguage); } }, reset: function(){ try{ localStorage.removeItem(SESSION_KEY) }catch(_){ } sessionId=''; firstPost=true; }, destroy: function(){ try{ if(host && host.parentNode){ host.parentNode.removeChild(host); } }catch(_){ } try{ window.__SwiftClinicChatMounted = false; }catch(_){ } try{ delete window.SwiftClinicChat; }catch(_){ } } }; }catch(_){ }

    // Mark as successfully mounted for this page lifecycle
    try{ window.__SwiftClinicChatMounted = true; window.__SwiftClinicChatHost = host; }catch(_){ }

    if(autoOpen){ toggle(true); }

    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;') }

  }catch(e){ try{ console.warn('[SwiftClinicChat]', e && (e.message||e)) }catch(_){ } }
})();


