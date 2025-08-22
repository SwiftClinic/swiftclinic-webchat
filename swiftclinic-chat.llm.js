/* SwiftClinic Webchat (LLM-integrated) - lightweight, readable build
   - Supports data-webhook-id or data-webhook-url
   - Persists sessionId in localStorage
   - Sends metadata (pageUrl, referrer, timezone, language, UTM)
   - Exposes window.SwiftClinicChat API: open, close, send, getSessionId, isOpen
*/
(function(){
  try{
    var scriptEl = document.currentScript || (function(){ var s=document.getElementsByTagName('script'); return s[s.length-1] })();
    if(!scriptEl) return;
    var ds = scriptEl.dataset || {};

    var webhookId  = ds.webhookId || '';
    var webhookUrl = ds.webhookUrl || ds.webhookurl || '';
    if(!webhookId){ try{ var u=new URL(scriptEl.src); webhookId = u.searchParams.get('webhookId') || '' }catch(_){} }

    var apiBase = (function(){ if(ds.apiBase) return String(ds.apiBase).replace(/\/$/, ''); try{ return new URL(scriptEl.src).origin }catch(_){ return window.location.origin } })();
    var endpoint = webhookUrl ? webhookUrl.replace(/\/$/, '') : (apiBase + '/webhook/' + encodeURIComponent(webhookId));
    if(!webhookId && !webhookUrl){ console.warn('[SwiftClinicChat] Missing webhook id/url'); return; }

    var clinicName   = ds.clinicName || 'Clinic';
    var primaryColor = ds.primaryColor || '#2563eb';
    var secondaryColor = ds.secondaryColor || ds.accentColor || '#22c55e';
    var fontFamily   = ds.fontFamily || "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif";
    var badgeBgColor = ds.badgeColor || ds.statusBadgeColor || '#22c55e';
    var badgeTextColor = ds.badgeTextColor || '#ffffff';
    var backgroundColor  = ds.backgroundColor || ds.chatBgColor || ds.chatbgcolor || ds.chatBackground || ds.chatbackground || ds.bgColor || '#f8fafc';
    var fontColor   = ds.fontColor || '#0f172a';
    var welcomeMessage = ds.welcomeMessage || '';
    var position     = (ds.position || 'bottom-right').toLowerCase();
    var autoOpen     = String(ds.autoOpen||'false')==='true';

    var sessionKey = 'swiftclinic_session_' + (webhookId || (function(){ try{ return btoa(endpoint).slice(0,16) }catch(_){ return 'url' } })());
    var sessionId  = (function(){ try{ return localStorage.getItem(sessionKey) || '' }catch(_){ return '' } })();

    var host = document.createElement('div');
    host.style.position='fixed'; host.style.zIndex='2147483647'; host.style.bottom='20px';
    host.style.right = position.indexOf('right')>=0 ? '20px' : '';
    host.style.left  = position.indexOf('left')>=0  ? '20px' : '';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode:'open' });

    var style = document.createElement('style');
    style.textContent = "\n:host{all:initial}\n.btn{position:fixed;bottom:20px;" + (position.indexOf('right')>=0?"right:20px;":"left:20px;") + "width:56px;height:56px;border-radius:16px;background:"+primaryColor+";color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:pointer;transition:transform .12s ease, box-shadow .18s ease, filter .12s ease}\n.btn:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 18px 44px rgba(0,0,0,.30);filter:brightness(1.05)}\n.btn svg{display:block;width:26px;height:26px}\n.panel{position:fixed;bottom:90px;" + (position.indexOf('right')>=0?"right:20px;":"left:20px;") + "width:420px;max-width:calc(100vw - 40px);height:600px;max-height:calc(100vh - 120px);background:"+backgroundColor+";border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(2,6,23,.25);display:none;font-family:"+fontFamily+";border:1px solid #e5e7eb;box-sizing:border-box;padding-bottom:12px;display:flex;flex-direction:column;color:"+fontColor+"}\n.header{min-height:72px;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;color:"+fontColor+";background:"+secondaryColor+";border-bottom:1px solid #e5e7eb;box-sizing:border-box}\n.title{font-weight:700;letter-spacing:.2px;color:"+fontColor+";display:inline-flex;align-items:center;gap:8px;line-height:1.25}\n.badge{font-size:11px;padding:2px 6px;border-radius:999px;background:"+badgeBgColor+";color:"+badgeTextColor+";margin-left:0;font-weight:600;opacity:.95}\n.close{background:#0f172a10;border:none;color:"+fontColor+";width:32px;height:32px;border-radius:10px;cursor:pointer}\n.messages{width:418.5px;height:345px;min-height:345px;max-height:345px;overflow:auto;padding:16px;background:"+backgroundColor+";scroll-behavior:smooth;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:6px}\n.msg{max-width:82%;padding:8px 12px;border-radius:12px;line-height:1.4;font-size:14px;border:1px solid #e5e7eb;background:"+secondaryColor+";color:"+fontColor+";width:fit-content;align-self:flex-start} .user{background:"+secondaryColor+";align-self:flex-end;margin-left:auto;margin-right:0;border-top-right-radius:6px} .bot{background:"+secondaryColor+";align-self:flex-start;margin-right:auto;margin-left:0;border-top-left-radius:6px}\n.msg .md{color:"+fontColor+"} .msg .md p{margin:0} .msg .md p + p{margin-top:6px}\n.msg .md a{color:"+primaryColor+";text-decoration:none}.msg .md a:hover{text-decoration:underline}\n.msg .md pre{background:#0b12201a;padding:10px;border-radius:10px;overflow:auto}.msg .md code{background:#0b12200d;padding:2px 4px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Roboto Mono',monospace;font-size:12px}\n.msg .md h1,.msg .md h2,.msg .md h3{margin:.2em 0 .3em;font-weight:700}.msg .md h1{font-size:18px}.msg .md h2{font-size:16px}.msg .md h3{font-size:15px}\n.typing-bubble{background:"+secondaryColor+";border-top-left-radius:6px;color:"+fontColor+";width:fit-content;align-self:flex-start}\n.footer{display:flex;align-items:center;gap:10px;padding:10px 16px 28px;border-top:1px solid #e5e7eb;background:"+backgroundColor+";box-sizing:border-box}\n.input{flex:1;height:36px;border:1px solid #e5e7eb;border-radius:10px;padding:0 12px;font-size:14px;transition:border-color .15s ease;box-sizing:border-box}.input:focus{outline:none;border-color:"+primaryColor+"}.send{height:36px;padding:0 10px;background:"+primaryColor+";color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600}\n.typing{display:none;color:#475569;font-size:13px;padding:2px 16px 8px}\n.dots{display:inline-flex;gap:4px}.dots span{width:6px;height:6px;border-radius:50%;background:#94a3b8;display:block;animation:blink 1s infinite}.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}\n.brand{display:flex;justify-content:center;align-items:center;gap:8px;padding:10px 0 16px;background:"+backgroundColor+";border-top:1px solid #e5e7eb}\n.brand-link{display:inline-flex;align-items:center;gap:8px;color:"+fontColor+";text-decoration:none;font-size:12px;font-weight:600;padding:6px 10px;border-radius:8px;transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease}\n.brand-link:hover{background:#f1f5f9;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.04)}\n.brand img{height:22px;width:auto;display:block}\n";
    root.appendChild(style);

    var panel = document.createElement('div'); panel.className='panel'; panel.style.fontFamily = fontFamily;
    panel.innerHTML = ''+
      '<div class="header"><div class="title">'+escapeHtml(clinicName)+'<span class="badge">Online</span></div><button class="close" aria-label="Close">×</button></div>'+
      '<div class="messages" id="sc-msgs"></div>'+
      '<div class="footer"><input id="sc-input" class="input" type="text" placeholder="Type a message..."/><button id="sc-send" class="send">Send</button></div>'+
      '<div class="brand"><a class="brand-link" href="https://www.swiftclinic.ai" target="_blank" rel="noopener noreferrer"><span>Powered by</span><img src="https://i.imgur.com/ZTzanHB.png" alt="SwiftClinic"/></a></div>';
    root.appendChild(panel);
    // Ensure closed by default
    panel.style.display = 'none';

    var btn = document.createElement('button'); btn.className='btn';
    var iconChat = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-4 4v-4H5a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4z"/></svg>';
    var iconClose = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    btn.innerHTML = iconChat; btn.setAttribute('aria-label','Open chat'); root.appendChild(btn);

    var msgs = panel.querySelector('#sc-msgs');
    var input = panel.querySelector('#sc-input');
    var sendBtn = panel.querySelector('#sc-send');
    var closeBtn = panel.querySelector('.close');
    var opened = false;

    btn.addEventListener('click', function(){ toggle(); });
    closeBtn.addEventListener('click', function(){ toggle(false); });
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ sendMessage(); } });

    function shortHash(str){ try{ str=String(str||''); var h=0; for(var i=0;i<str.length;i++){ h = (h*31 + str.charCodeAt(i)) >>> 0 } return h.toString(36); }catch(_){ return '0' } }
    var keySuffix = (webhookId || (function(){ try{ return btoa(endpoint).slice(0,16) }catch(_){ return 'url' } })());
    var welcomeKey = 'swiftclinic_welcome_open_' + keySuffix + '_' + shortHash(welcomeMessage); // session-only, varies by message text
    var welcomeShown = (function(){ try{ return sessionStorage.getItem(welcomeKey) === '1' }catch(_){ return false } })();
    var appendedWelcomeThisOpen = false;
    function toggle(show){
      opened = show===undefined ? !opened : !!show;
      panel.style.display = opened ? 'block' : 'none';
      btn.innerHTML = opened ? iconClose : iconChat;
      btn.setAttribute('aria-label', opened ? 'Close chat' : 'Open chat');
      if(opened){
        input.focus();
        if(!welcomeShown && welcomeMessage && !appendedWelcomeThisOpen && msgs.childElementCount===0){ append('bot', welcomeMessage); appendedWelcomeThisOpen = true; welcomeShown = true; try{ sessionStorage.setItem(welcomeKey, '1') }catch(_){ } }
        if (msgs.childElementCount === 0) { handshake(); }
      } else {
        appendedWelcomeThisOpen = false;
      }
    }

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
        } else {
          append('bot', String(text||''));
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
      s = s.split(/\n{2,}/).map(function(p){
        if(/^\s*<\/?(ul|ol|pre|h1|h2|h3)/.test(p)) return p;
        return '<p>'+p.replace(/\n/g,'<br/>')+'</p>';
      }).join('');
      return s;
    }

    function buildMetadata(){
      try{
        var url = new URL(location.href); var params = url.searchParams; var utm = {};
        ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){ var v=params.get(k); if(v) utm[k]=v });
        var tz=''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' }catch(_){ }
        return { pageUrl: location.href, referrer: document.referrer||'', timezone: tz, language: (navigator.language||''), utm: utm, welcomeMessage: welcomeMessage };
      }catch(_){ return { pageUrl: location.href, referrer: document.referrer||'', welcomeMessage: welcomeMessage } }
    }

    function handshake(){
      showTyping(true);
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'X-Session-ID': sessionId||'' },
        body: JSON.stringify({ message: '', sessionId: sessionId||undefined, userConsent: true, metadata: buildMetadata() })
      }).then(function(r){ return r.json(); }).then(function(res){
        var data = (res && res.data) || {};
        if(data.sessionId){ sessionId = data.sessionId; try{ localStorage.setItem(sessionKey, sessionId) }catch(_){} }
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
      }).catch(function(){ showTyping(false); /* ignore */ });
    }

    function sendMessage(){
      var text = (input.value || '').trim(); if(!text) return;
      append('user', text); input.value=''; showTyping(true);
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'X-Session-ID': sessionId||'' },
        body: JSON.stringify({ message: text, sessionId: sessionId||undefined, userConsent: true, metadata: buildMetadata() })
      }).then(function(r){ return r.json(); }).then(function(res){
        var data = (res && res.data) || {};
        if(data.sessionId){ sessionId = data.sessionId; try{ localStorage.setItem(sessionKey, sessionId) }catch(_){} }
        if(data.message){ finishTypingWith(data.message); }
        else { showTyping(false); }
      }).catch(function(){ finishTypingWith('Sorry, something went wrong. Please try again.'); });
    }

    // Public API
    try{ window.SwiftClinicChat = { open: function(){ toggle(true) }, close: function(){ toggle(false) }, send: function(t){ if(typeof t==='string'){ append('user', t); showTyping(true); fetch(endpoint,{ method:'POST', headers:{'Content-Type':'application/json','X-Session-ID': sessionId||''}, body: JSON.stringify({ message:t, sessionId: sessionId||undefined, userConsent:true, metadata: buildMetadata() }) }).then(function(r){ return r.json() }).then(function(res){ var d=(res&&res.data)||{}; if(d.sessionId){ sessionId=d.sessionId; try{ localStorage.setItem(sessionKey, sessionId) }catch(_){}} if(d.message){ append('bot', d.message) } }).catch(function(){ append('bot','Sorry, something went wrong.') }).finally(function(){ showTyping(false) }) } }, getSessionId: function(){ return sessionId||'' }, isOpen: function(){ return !!opened } }; }catch(_){ }

    if(autoOpen){ toggle(true); }

    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;') }

  }catch(e){ try{ console.warn('[SwiftClinicChat]', e && (e.message||e)) }catch(_){ } }
})();


