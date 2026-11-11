
  const homeUi = {"accent_tone": "Accent tone", "auto_off": "Auto: Off", "auto_on": "Auto: On", "blog_body": "Short reads about road intelligence, safer routes, and what is new on QRoadScan.com.", "blog_kicker": "Latest from the QRoadScan Blog", "blog_title": "Traffic safety, hazard research, and product updates", "card1_body": "The colorwheel compresses route complexity into a calm visual signal drivers can understand quickly.", "card1_title": "Readable risk intelligence", "card2_body": "Each scan is built to surface practical conditions, possible hazards, and driver-ready next steps.", "card2_title": "Road-aware guidance", "card3_body": "Sign in to save scans, compare reports, and keep your preferred AI language across the experience.", "card3_title": "Built for the dashboard", "confidence_short": "Conf", "create_account": "Create Account", "create_account_title": "Create your account", "debug_off": "Debug: Off", "debug_on": "Debug: On", "explore_colorwheel": "Explore the live colorwheel", "fresh_posts": "Fresh posts are publishing soon. Tap in for road safety tips and QRoadScan updates.", "hero_body": "Our advance algorithms designed for real world road safety are designed to help drivers in many conditons. Sign up, scan routes, and join the intelligent driver revolution.", "hero_title": "Using intelligence to drive safer", "js_changing": "CHANGING", "js_clear": "CLEAR", "js_clear_note": "Clear conditions detected", "js_context": "Model is composing context...", "js_elevated": "ELEVATED", "js_stay_adaptive": "Stay adaptive and scan", "kicker": "Road intelligence and safety awareness.", "live_risk_preview": "Grok guess mode", "nav_blog": "Blog", "nav_dashboard": "Dashboard", "nav_home": "Home", "nav_login": "Login", "nav_logout": "Logout", "nav_register": "Register", "open_dashboard": "Open Dashboard", "perceptual_color_ramp": "Perceptual color ramp", "phrases": ["Road risk signals translated into fast, readable guidance.", "Route scans built for real-world road safety decisions.", "AI-assisted alerts that explain what changed and why it matters.", "Colorwheel feedback that keeps urgency visible without adding noise.", "Dashboard intelligence for drivers who want safer, clearer trips."], "phrases_kicker": "Intelligence drivers can act on", "read_blog": "Read the Blog", "read_body": "The colorwheel uses Grok guess mode with the original prompt, color mapping, confidence display and breathing animation. Each refresh creates a new simulated reading; no login or location permission is needed.", "read_title": "How QRoadScan turns road signals into driving intelligence", "refresh": "Refresh", "tip": "Tip: if your OS has Reduce Motion enabled, animations automatically soften.", "unlock_dashboard": "Unlock the dashboard experience for deeper driving intelligence and personalized tools.", "view_all_posts": "View all posts", "visit_blog": "Visit the blog", "waiting": "Sign in and run a scan to see your assessment.", "watch_wheel": "Explore the colorwheel design, then open your dashboard for an assessment from supplied observations.", "why_reading": "Why this reading"};
  const $ = (s, el=document)=>el.querySelector(s);
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MIN_UPDATE_MS = 60 * 1000;
  let lastApplyAt = 0;
  const current = { harm:0, last:null };



  (function ensureWheelSize(){
    const panel = document.getElementById('wheelPanel');
    if(!panel) return;
    function fit(){
      const w = panel.clientWidth || panel.offsetWidth || 0;
      const ch = parseFloat(getComputedStyle(panel).height) || 0;
      if (ch < 24 && w > 0) panel.style.height = w + 'px';
    }
    new ResizeObserver(fit).observe(panel);
    fit();
  })();

  (function parallax(){
    const panel = $('#wheelPanel'); if(!panel) return;
    let rx=0, ry=0, vx=0, vy=0;
    const damp = prefersReduced? .18 : .08;
    const update=()=>{
      vx += (rx - vx)*damp; vy += (ry - vy)*damp;
      panel.style.transform = `rotateX(${vy}deg) rotateY(${vx}deg)`;
      requestAnimationFrame(update);
    };
    update();
    panel.addEventListener('pointermove', e=>{
      const r=panel.getBoundingClientRect();
      const nx = (e.clientX - r.left)/r.width*2 - 1;
      const ny = (e.clientY - r.top)/r.height*2 - 1;
      rx = ny * 3.5; ry = -nx * 3.5;
    });
    panel.addEventListener('pointerleave', ()=>{ rx=0; ry=0; });
  })();

  class BreathEngine {
    constructor(){
      this.rateHz = 0.10;
      this.amp    = 0.55;
      this.sweep  = 0.12;
      this._rateTarget=this.rateHz; this._ampTarget=this.amp; this._sweepTarget=this.sweep;
      this.val    = 0.7;
    }
    setFromRisk(risk, {confidence=1}={}){
      risk = clamp01(risk||0); confidence = clamp01(confidence);
      this._rateTarget = prefersReduced ? (0.05 + 0.03*risk) : (0.06 + 0.16*risk);
      const baseAmp = prefersReduced ? (0.35 + 0.20*risk) : (0.35 + 0.55*risk);
      this._ampTarget = baseAmp * (0.70 + 0.30*confidence);
      this._sweepTarget = prefersReduced ? (0.06 + 0.06*risk) : (0.08 + 0.16*risk);
    }
    tick(){
      const t = performance.now()/1000;
      const k = prefersReduced ? 0.08 : 0.18;
      this.rateHz += (this._rateTarget - this.rateHz)*k;
      this.amp    += (this._ampTarget - this.amp   )*k;
      this.sweep  += (this._sweepTarget- this.sweep )*k;
      const base  = 0.5 + 0.5 * Math.sin(2*Math.PI*this.rateHz * t);
      const depth = 0.85 + 0.15 * Math.sin(2*Math.PI*this.rateHz * 0.5 * t);
      const tremorAmt = prefersReduced ? 0 : (Math.max(0, current.harm - 0.75) * 0.02);
      const tremor = tremorAmt * Math.sin(2*Math.PI*8 * t);
      this.val = 0.55 + this.amp*(base*depth - 0.5) + tremor;
      document.documentElement.style.setProperty('--halo-alpha', (0.18 + 0.28*this.val).toFixed(3));
      document.documentElement.style.setProperty('--halo-blur',  (0.60 + 0.80*this.val).toFixed(3));
      document.documentElement.style.setProperty('--glow-mult',  (0.60 + 0.90*this.val).toFixed(3));
      document.documentElement.style.setProperty('--sweep-speed', this.sweep.toFixed(3));
    }
  }
  const breath = new BreathEngine();
  (function loopBreath(){ breath.tick(); requestAnimationFrame(loopBreath); })();

  class RiskWheel {
    constructor(canvas){
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.pixelRatio = Math.max(1, Math.min(2, devicePixelRatio||1));
      this.value = 0.0; this.target=0.0; this.vel=0.0;
      this.spring = prefersReduced ? 1.0 : 0.12;
      this._resize = this._resize.bind(this);
      new ResizeObserver(this._resize).observe(this.c);
      const panel = document.getElementById('wheelPanel');
      if (panel) new ResizeObserver(this._resize).observe(panel);
      this._resize();
      this._tick = this._tick.bind(this); requestAnimationFrame(this._tick);
    }
    setTarget(x){ this.target = clamp01(x); }
    _resize(){
      const panel = document.getElementById('wheelPanel');
      const rect = (panel||this.c).getBoundingClientRect();
      let w = rect.width||0, h = rect.height||0;
      if (h < 2) h = w;
      const s = Math.max(1, Math.min(w, h));
      const px = this.pixelRatio;
      this.c.width = s * px; this.c.height = s * px;
      this._draw();
    }
    _tick(){
      const d = this.target - this.value;
      this.vel = this.vel * 0.82 + d * this.spring;
      this.value += this.vel;
      this._draw();
      requestAnimationFrame(this._tick);
    }
    _draw(){
      const ctx=this.ctx, W=this.c.width, H=this.c.height;
      if (!W || !H) return;
      ctx.clearRect(0,0,W,H);
      const cx=W/2, cy=H/2, R=Math.min(W,H)*0.46, inner=R*0.62;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(-Math.PI/2);
      ctx.lineWidth = (R-inner);
      ctx.strokeStyle='#ffffff16';
      ctx.beginPath(); ctx.arc(0,0,(R+inner)/2, 0, Math.PI*2); ctx.stroke();
      const p=clamp01(this.value), maxAng=p*Math.PI*2, segs=220;
      for(let i=0;i<segs;i++){
        const t0=i/segs; if(t0>=p) break;
        const a0=t0*maxAng, a1=((i+1)/segs)*maxAng;
        ctx.beginPath();
        ctx.strokeStyle = this._colorAt(t0);
        ctx.arc(0,0,(R+inner)/2, a0, a1);
        ctx.stroke();
      }
      const sp = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sweep-speed')) || (prefersReduced? .04 : .12);
      const t = performance.now()/1000;
      const sweepAng = (t * sp) % (Math.PI*2);
      ctx.save(); ctx.rotate(sweepAng);
      const dotR = Math.max(4*this.pixelRatio, (R-inner)*0.22);
      const grad = ctx.createRadialGradient((R+inner)/2,0, 2, (R+inner)/2,0, dotR);
      grad.addColorStop(0, 'rgba(255,255,255,.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad; ctx.beginPath();
      ctx.arc((R+inner)/2,0, dotR, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      ctx.restore();
    }
    _mix(h1,h2,k){
      const a=parseInt(h1.slice(1),16), b=parseInt(h2.slice(1),16);
      const r=(a>>16)&255, g=(a>>8)&255, bl=a&255;
      const r2=(b>>16)&255, g2=(b>>8)&255, bl2=b&255;
      const m=(x,y)=>Math.round(x+(y-x)*k);
      return `#${m(r,r2).toString(16).padStart(2,'0')}${m(g,g2).toString(16).padStart(2,'0')}${m(bl,bl2).toString(16).padStart(2,'0')}`;
    }
    _colorAt(t){
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#49c2ff';
      const green="#43d17a", amber="#f6c454", red="#ff6a6a";
      const base = t<.4 ? this._mix(green, amber, t/.4) : this._mix(amber, red, (t-.4)/.6);
      return this._mix(base, acc, 0.18);
    }
  }
export {RiskWheel,breath,current};
