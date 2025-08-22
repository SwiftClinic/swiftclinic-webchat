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
    var accentColor  = ds.accentColor  || '#22c55e';
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
    style.textContent = "\n.btn{position:fixed;bottom:20px;" + (position.indexOf('right')>=0?"right:20px;":"left:20px;") + "width:56px;height:56px;border-radius:50%;background:"+primaryColor+";color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:pointer;font-size:22px}\n.panel{position:fixed;bottom:90px;" + (position.indexOf('right')>=0?"right:20px;":"left:20px;") + "width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 160px);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.25);display:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif}\n.header{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;color:#fff;background:linear-gradient(135deg,"+primaryColor+" 0%,"+accentColor+" 100%)}\n.title{font-weight:700}.close{background:rgba(255,255,255,.15);border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer}\n.messages{height:calc(100% - 58px - 64px);overflow:auto;padding:12px;background:#f8fafc}\n.msg{max-width:80%;margin:6px 0;padding:10px 12px;border-radius:12px;line-height:1.35;font-size:14px}.user{background:#e2f0ff;margin-left:auto;border-top-right-radius:4px}.bot{background:#ecfdf5;margin-right:auto;border-top-left-radius:4px}\n.footer{height:64px;display:flex;align-items:center;gap:8px;padding:8px;border-top:1px solid #e5e7eb;background:#fff}\n.input{flex:1;height:42px;border:1px solid #e5e7eb;border-radius:10px;padding:0 12px;font-size:14px}.send{height:42px;padding:0 14px;background:"+primaryColor+";color:#fff;border:none;border-radius:10px;cursor:pointer}\n.typing{display:none;color:#6b7280;font-size:13px;padding:0 12px 8px}\n.dots{display:inline-flex;gap:4px}.dots span{width:6px;height:6px;border-radius:50%;background:#9ca3af;display:block;animation:blink 1s infinite}.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}\n";
    root.appendChild(style);

    var panel = document.createElement('div'); panel.className='panel';
    panel.innerHTML = ''+
      '<div class="header"><div class="title">'+escapeHtml(clinicName)+'</div><button class="close" aria-label="Close">×</button></div>'+
      '<div class="messages" id="sc-msgs"></div>'+
      '<div class="typing" id="sc-typing"><span class="dots"><span></span><span></span><span></span></span></div>'+
      '<div class="footer"><input id="sc-input" class="input" type="text" placeholder="Type a message..."/><button id="sc-send" class="send">Send</button></div>';
    root.appendChild(panel);

    var btn = document.createElement('button'); btn.className='btn'; btn.textContent='💬'; btn.setAttribute('aria-label','Open chat'); root.appendChild(btn);

    var msgs = panel.querySelector('#sc-msgs');
    var typing = panel.querySelector('#sc-typing');
    var input = panel.querySelector('#sc-input');
    var sendBtn = panel.querySelector('#sc-send');
    var closeBtn = panel.querySelector('.close');
    var opened = false;

    btn.addEventListener('click', function(){ toggle(true); });
    closeBtn.addEventListener('click', function(){ toggle(false); });
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ sendMessage(); } });

    function toggle(show){
      opened = show===undefined ? !opened : !!show;
      panel.style.display = opened ? 'block' : 'none';
      if(opened){ input.focus(); if(!sessionId){ handshake(); } }
    }

    function append(role, text){
      var el = document.createElement('div');
      el.className = 'msg ' + (role==='user' ? 'user' : 'bot');
      el.innerHTML = escapeHtml(String(text||'')).replace(/\n/g,'<br/>');
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function showTyping(show){ typing.style.display = show ? 'block' : 'none'; }

    function buildMetadata(){
      try{
        var url = new URL(location.href); var params = url.searchParams; var utm = {};
        ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){ var v=params.get(k); if(v) utm[k]=v });
        var tz=''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' }catch(_){ }
        return { pageUrl: location.href, referrer: document.referrer||'', timezone: tz, language: (navigator.language||''), utm: utm };
      }catch(_){ return { pageUrl: location.href, referrer: document.referrer||'' } }
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
        if(data.message){ append('bot', data.message); }
      }).catch(function(){ /* ignore */ })
        .finally(function(){ showTyping(false); });
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
        if(data.message){ append('bot', data.message); }
      }).catch(function(){ append('bot','Sorry, something went wrong. Please try again.'); })
        .finally(function(){ showTyping(false); });
    }

    // Public API
    try{ window.SwiftClinicChat = { open: function(){ toggle(true) }, close: function(){ toggle(false) }, send: function(t){ if(typeof t==='string'){ append('user', t); showTyping(true); fetch(endpoint,{ method:'POST', headers:{'Content-Type':'application/json','X-Session-ID': sessionId||''}, body: JSON.stringify({ message:t, sessionId: sessionId||undefined, userConsent:true, metadata: buildMetadata() }) }).then(function(r){ return r.json() }).then(function(res){ var d=(res&&res.data)||{}; if(d.sessionId){ sessionId=d.sessionId; try{ localStorage.setItem(sessionKey, sessionId) }catch(_){}} if(d.message){ append('bot', d.message) } }).catch(function(){ append('bot','Sorry, something went wrong.') }).finally(function(){ showTyping(false) }) } }, getSessionId: function(){ return sessionId||'' }, isOpen: function(){ return !!opened } }; }catch(_){ }

    if(autoOpen){ toggle(true); }

    function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;') }

  }catch(e){ try{ console.warn('[SwiftClinicChat]', e && (e.message||e)) }catch(_){ } }
})();


