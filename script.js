function ic(name, size, color){
  const style = color ? `style="color:${color};"` : '';
  return `<svg class="wp-icon" width="${size||20}" height="${size||20}" viewBox="0 0 24 24" ${style}><use href="#i-${name}"></use></svg>`;
}
function brandMark(size){
  const s = size||34;
  return `<div style="width:${s}px;height:${s}px;border-radius:${s*0.32}px;background:linear-gradient(150deg,var(--pink),var(--deep-pink));display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0;">
    <span style="font-family:'Poppins';font-weight:800;color:#fff;font-size:${s*0.46}px;">W</span>
    <span style="position:absolute;top:-3px;right:-3px;width:${s*0.22}px;height:${s*0.22}px;border-radius:50%;background:var(--orange);border:2px solid var(--white);"></span>
  </div>`;
}
function initialsAvatar(name, size){
  const s = size||42;
  const letter = (name||'W').trim().charAt(0).toUpperCase();
  return `<div style="width:${s}px;height:${s}px;border-radius:50%;background:var(--pink-soft);display:flex;align-items:center;justify-content:center;font-family:'Poppins';font-weight:800;color:var(--deep-pink);font-size:${s*0.42}px;">${letter}</div>`;
}

// ---- AI configuration ----
// The real Gemini API key lives only on the server, as the GEMINI_API_KEY environment
// variable read by /api/generate.js. The browser never sees it, so users of the deployed
// app don't need to enter or manage an API key themselves.
let OPENAI_MODEL = 'gemini-flash-latest';

let state = {
  screen: 'onboard',
  onboardIdx: 0,
  user: null,
  form: { name:'', age:'', klass:'Primary 6', school:'', stateName:'', goal:'' },
  chat: { subject: 'General', messages: [], loading:false },
  quiz: { phase:'setup', subject:'Mathematics', difficulty:'Medium', count:10, questions:[], current:0, answers:[], loading:false },
  quizHistory: [],
  activityLog: [],
  grammar: { text:'', loading:false, result:null },
  planner: { examDate:'', studyTime:'1 hour', weakSubjects:[], targetScore:'', days:['Monday','Wednesday','Friday','Saturday'], loading:false, plan:null },
  homework: { text:'', imageBase64:null, imageName:'', loading:false, messages:[] },
  notes: { phase:'subjects', subject:null, topics:[], topicsLoading:false, topic:null, content:null, loading:false, expanded:{}, image:null, imageLoading:false },
  nav: 'home',
  showSettings: false
};

async function callOpenAI(systemPrompt, messages, maxTokens){
  // Translate our generic {role, content} messages into Gemini's {role, parts} shape.
  // Gemini uses "model" instead of "assistant", and images go in as inline_data, not image_url.
  const contents = messages.map(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    let parts;
    if(Array.isArray(m.content)){
      parts = m.content.map(part => {
        if(part.type === 'text') return { text: part.text };
        if(part.type === 'image_url'){
          const match = (part.image_url.url||'').match(/^data:(.*?);base64,(.*)$/);
          if(match) return { inline_data: { mime_type: match[1], data: match[2] } };
          return { text: '[image could not be attached]' };
        }
        return { text: '' };
      });
    } else {
      parts = [{ text: m.content }];
    }
    return { role, parts };
  });

  const requestBody = JSON.stringify({
    systemPrompt,
    contents,
    maxOutputTokens: maxTokens || 700,
    model: OPENAI_MODEL
  });

  // The backend proxy (/api/generate) can itself hit transient 503 (overloaded) or
  // 429 (rate limited) responses from Gemini - retry a couple of times before giving up.
  const maxAttempts = 3;
  let lastError;
  for(let attempt = 1; attempt <= maxAttempts; attempt++){
    let response;
    try{
      response = await fetch('/api/generate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: requestBody
      });
    }catch(networkErr){
      lastError = networkErr;
      if(attempt === maxAttempts) throw networkErr;
      await new Promise(r => setTimeout(r, attempt * 900));
      continue;
    }
    if(response.ok){
      const data = await response.json();
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate && candidate.content && candidate.content.parts;
      return parts ? parts.map(p=>p.text||'').join('') : '';
    }
    const errBody = await response.text();
    if((response.status === 503 || response.status === 429) && attempt < maxAttempts){
      await new Promise(r => setTimeout(r, attempt * 1200));
      continue;
    }
    throw new Error('api_error: ' + response.status + ' ' + errBody.slice(0,200));
  }
  throw lastError || new Error('api_error: unknown failure after retries');
}

function toggleSettings(){ state.showSettings = !state.showSettings; render(); }
function saveSettings(){
  const modelInput = document.getElementById('modelInput');
  OPENAI_MODEL = modelInput.value.trim() || 'gemini-flash-latest';
  state.showSettings = false;
  render();
}
function renderSettingsModal(){
  if(!state.showSettings) return '';
  return `
  <div class="modal-overlay" onclick="if(event.target===this) toggleSettings()">
    <div class="modal-sheet" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="toggleSettings()">✕</button>
      <h3>Settings</h3>
      <p>WinsPrep's AI features run through a shared backend, so there's nothing for you to set up — no personal API key needed.</p>
      <div class="field"><label>AI Model (advanced)</label><input id="modelInput" placeholder="gemini-flash-latest" value="${OPENAI_MODEL}"></div>
      <p style="font-size:11px;color:#999;margin:-4px 0 6px;">Only change this if a feature starts erroring with "model no longer available" — Google renames these occasionally. Try <code>gemini-3.1-flash-lite</code> as a fallback.</p>
      <button class="btn btn-solid-pink" style="width:100%;margin-top:14px;" onclick="saveSettings()">Save</button>
    </div>
  </div>`;
}

const ONBOARD_SLIDES = [
  { title:'Learn with your personal AI teacher', body:'WinsPrep explains every topic step by step, just like a patient private tutor.' },
  { title:'Practice unlimited Common Entrance questions', body:'Maths, English, Verbal & Quantitative Reasoning and more, all curriculum-aligned.' },
  { title:'Generate your own study timetable', body:"Tell us your exam date and we'll build a plan that fits your week." },
  { title:'Track your progress and improve every day', body:'Earn XP, keep your streak alive, and watch your weak topics turn strong.' },
];

function onboardArt(idx){
  const arts = [
    `<svg viewBox="0 0 200 200">
      <path d="M20 150 Q100 130 180 150 L180 60 Q100 40 20 60 Z" fill="rgba(255,255,255,0.16)"/>
      <path d="M20 60 Q100 40 180 60" fill="none" stroke="#fff" stroke-width="3"/>
      <path d="M20 150 Q100 130 180 150" fill="none" stroke="#fff" stroke-width="3"/>
      <path d="M100 45 L100 145" stroke="rgba(255,255,255,0.5)" stroke-width="2"/>
      <circle cx="148" cy="48" r="20" fill="#fff"/>
      <text x="148" y="55" font-size="18" text-anchor="middle" fill="var(--deep-pink)" font-family="Poppins" font-weight="800">AI</text>
      <path d="M42 38l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#fff" opacity="0.85"/>
    </svg>`,
    `<svg viewBox="0 0 200 200">
      <rect x="55" y="72" width="90" height="108" rx="14" fill="rgba(255,255,255,0.2)" transform="rotate(-8 100 126)"/>
      <rect x="60" y="62" width="90" height="108" rx="14" fill="rgba(255,255,255,0.32)" transform="rotate(4 100 116)"/>
      <rect x="58" y="50" width="90" height="108" rx="14" fill="#fff"/>
      <text x="103" y="118" font-size="50" text-anchor="middle" fill="var(--deep-pink)" font-family="Poppins" font-weight="800">?</text>
      <circle cx="152" cy="52" r="4" fill="#fff"/>
      <circle cx="38" cy="150" r="5" fill="#fff" opacity="0.6"/>
    </svg>`,
    `<svg viewBox="0 0 200 200">
      <rect x="35" y="45" width="130" height="120" rx="14" fill="#fff"/>
      <rect x="35" y="45" width="130" height="30" rx="14" fill="var(--deep-pink)"/>
      <rect x="35" y="60" width="130" height="15" fill="var(--deep-pink)"/>
      <g stroke="rgba(194,24,91,0.22)" stroke-width="2">
        <line x1="35" y1="105" x2="165" y2="105"/>
        <line x1="35" y1="135" x2="165" y2="135"/>
        <line x1="75" y1="75" x2="75" y2="165"/>
        <line x1="115" y1="75" x2="115" y2="165"/>
      </g>
      <rect x="79" y="109" width="32" height="22" rx="6" fill="var(--pink)"/>
      <path d="M87 120l6 6 12-12" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    `<svg viewBox="0 0 200 200">
      <rect x="40" y="120" width="26" height="50" rx="4" fill="rgba(255,255,255,0.5)"/>
      <rect x="80" y="95" width="26" height="75" rx="4" fill="rgba(255,255,255,0.72)"/>
      <rect x="120" y="65" width="26" height="105" rx="4" fill="#fff"/>
      <path d="M133 40l4.5 9.5 10.5 1.5-7.6 7.4 1.8 10.4-9.2-4.8-9.2 4.8 1.8-10.4-7.6-7.4 10.5-1.5z" fill="var(--orange)"/>
    </svg>`,
  ];
  return arts[idx] || arts[0];
}

const SUBJECTS = ['General','Mathematics','English Language','Verbal Reasoning','Quantitative Reasoning','Basic Science','Social Studies','Civic Education','Computer Studies'];

function render(){
  const phone = document.getElementById('phone');
  let html = '';
  if(state.screen === 'onboard') html = renderOnboard();
  else if(state.screen === 'auth') html = renderAuth();
  else if(state.screen === 'dashboard') html = renderDashboard();
  else if(state.screen === 'tutor') html = renderTutor();
  else if(state.screen === 'quiz') html = renderQuiz();
  else if(state.screen === 'profile') html = renderProfile();
  else if(state.screen === 'grammar') html = renderGrammar();
  else if(state.screen === 'planner') html = renderPlanner();
  else if(state.screen === 'homework') html = renderHomework();
  else if(state.screen === 'parent') html = renderParent();
  else if(state.screen === 'notes') html = renderNotes();
  phone.innerHTML = html + renderSettingsModal();
  if(state.screen === 'tutor'){
    const body = document.getElementById('chatBody');
    if(body) body.scrollTop = body.scrollHeight;
  }
}

/* ---------------- ONBOARDING ---------------- */
function renderOnboard(){
  const s = ONBOARD_SLIDES[state.onboardIdx];
  const isLast = state.onboardIdx === ONBOARD_SLIDES.length - 1;
  return `
  <div class="screen">
    <div class="onboard">
      <button class="onboard-skip" onclick="enterAsGuest()">Skip</button>
      <div class="onboard-art">${onboardArt(state.onboardIdx)}</div>
      <div class="onboard-text">
        <h2>${s.title}</h2>
        <p>${s.body}</p>
      </div>
      <div class="dots">
        ${ONBOARD_SLIDES.map((_,i)=>`<div class="dot ${i===state.onboardIdx?'active':''}"></div>`).join('')}
      </div>
      <div class="onboard-buttons">
        ${isLast ? `
          <button class="btn btn-primary" onclick="enterAsGuest()">Get Started</button>
        ` : `
          <button class="btn btn-primary" onclick="nextSlide()">Next</button>
        `}
      </div>
    </div>
  </div>`;
}
function nextSlide(){ state.onboardIdx = Math.min(state.onboardIdx+1, ONBOARD_SLIDES.length-1); render(); }
function goAuth(mode){ state.screen='auth'; state.authMode = mode||'signup'; render(); }
function enterAsGuest(){
  state.user = { name: 'Learner', xp: 0, streak: 1, school:'', stateName:'', goal:'Pass Common Entrance with confidence' };
  state.screen = 'dashboard'; state.nav = 'home';
  logActivity('start', 'Started using WinsPrep');
  render();
}

/* ---------------- AUTH ---------------- */
function renderAuth(){
  if(state.authMode === 'signin'){
    return `
    <div class="screen">
      <div class="auth">
        <div class="auth-logo">${brandMark(46)}</div>
        <h1>Welcome back</h1>
        <p>Sign in to continue your learning journey.</p>
        <div class="field"><label>Email or Phone</label><input id="f_email" placeholder="you@example.com"></div>
        <div class="field"><label>Password</label><input type="password" id="f_pass" placeholder="••••••••"></div>
        <button class="btn btn-solid-pink" onclick="fakeSignIn()">Sign In</button>
        <div class="auth-alt">New to WinsPrep? <span class="btn-ghost" onclick="goAuth('signup')" style="cursor:pointer;">Create account</span></div>
      </div>
    </div>`;
  }
  const f = state.form;
  return `
  <div class="screen">
    <div class="auth">
      <div class="auth-logo">${brandMark(46)}</div>
      <h1>Create your account</h1>
      <p>Tell us a bit about you so we can personalize WinsPrep.</p>
      <div class="field"><label>Full Name</label><input id="f_name" value="${f.name}" placeholder="e.g. Ade Johnson"></div>
      <div class="field"><label>Age</label><input id="f_age" value="${f.age}" placeholder="e.g. 11"></div>
      <div class="field"><label>School</label><input id="f_school" value="${f.school}" placeholder="e.g. Oakville School"></div>
      <div class="field"><label>State</label><input id="f_state" value="${f.stateName}" placeholder="e.g. Lagos"></div>
      <div class="field"><label>Learning Goal</label><input id="f_goal" value="${f.goal}" placeholder="e.g. Pass NCEE with confidence"></div>
      <button class="btn btn-solid-pink" onclick="submitSignup()">Create Account</button>
      <div class="auth-alt">Already have an account? <span class="btn-ghost" onclick="goAuth('signin')" style="cursor:pointer;">Sign in</span></div>
    </div>
  </div>`;
}
function fakeSignIn(){
  state.user = { name: 'Ade', xp: 320, streak: 4 };
  state.screen = 'dashboard'; state.nav='home'; render();
}
function submitSignup(){
  const name = document.getElementById('f_name').value.trim() || 'Learner';
  const age = document.getElementById('f_age').value.trim();
  const school = document.getElementById('f_school').value.trim();
  const stateName = document.getElementById('f_state').value.trim();
  const goal = document.getElementById('f_goal').value.trim();
  state.form = { name, age, school, stateName, goal, klass:'Primary 6' };
  state.user = { name, age, school, stateName, goal, xp: 0, streak: 1 };
  state.screen = 'dashboard'; state.nav='home'; render();
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(){
  const u = state.user;
  const firstName = (u.name||'Learner').split(' ')[0];
  return `
  <div class="screen">
    <div class="brand-row">${brandMark(30)}<span class="brand-name">WinsPrep</span></div>
    <div class="appbar">
      <div class="greet"><h2>Hi, ${firstName} 👋</h2><span>Ready to learn something new today?</span></div>
      <div style="display:flex;align-items:center;">${initialsAvatar(u.name,42)}<button class="gear-btn" onclick="toggleSettings()">${ic('gear',17)}</button></div>
    </div>
    <div class="content">
      <div class="hero-panel">
        ${ic('target',110)}
        <div class="hero-mega"><span class="hero-num">${u.streak||1}</span><span class="hero-unit">day${(u.streak||1)===1?'':'s'}<br>streak</span></div>
        <p class="hero-caption">Keep it alive — one quick activity today does it.</p>
        <div class="hero-dots">
          ${Array.from({length:7},(_,i)=>`<span class="${i < Math.min(u.streak||1,7) ? 'filled':''}"></span>`).join('')}
        </div>
        <div class="hero-substats">
          <div><span>${u.xp||0}</span>XP earned</div>
          <div><span>${goalLabel()}</span>focus area</div>
        </div>
      </div>

      <div class="section-title">Jump back in</div>
      <div class="tool-bento">
        <div class="tool-featured" onclick="openTutor()">
          <span class="tile-icon pulsing-icon" style="color:#fff;">${ic("chat",100)}</span>
          <span class="tag">AI Tutor</span>
          <h3>Ask anything, anytime</h3>
          <p>Step-by-step help in any subject</p>
        </div>
        <div class="tool-tile" onclick="openQuizSetup()" style="background:#e3f2fd;">
          <span class="tile-icon" style="color:var(--blue);">${ic("quiz",56)}</span>
          <div class="tile-head"><span style="color:var(--blue);">${ic("quiz",14)}</span><h3>Practice Quiz</h3></div>
          <p>Common Entrance style</p>
        </div>
        <div class="tool-tile" onclick="openGrammar()" style="background:#f3e5f5;">
          <span class="tile-icon" style="color:var(--purple);">${ic("pen",56)}</span>
          <div class="tile-head"><span style="color:var(--purple);">${ic("pen",14)}</span><h3>Grammar Coach</h3></div>
          <p>Fix &amp; improve writing</p>
        </div>
        <div class="tool-tile" onclick="openPlanner()" style="background:#e8f5e9;">
          <span class="tile-icon" style="color:var(--green);">${ic("calendar",56)}</span>
          <div class="tile-head"><span style="color:var(--green);">${ic("calendar",14)}</span><h3>Study Planner</h3></div>
          <p>Build a timetable</p>
        </div>
        <div class="tool-tile" onclick="openHomework()" style="background:#fff3e0;">
          <span class="tile-icon" style="color:var(--orange);">${ic("camera",56)}</span>
          <div class="tile-head"><span style="color:var(--orange);">${ic("camera",14)}</span><h3>Homework Helper</h3></div>
          <p>Snap a photo</p>
        </div>
        <div class="tool-tile" onclick="openNotes()" style="background:#ede7f6;">
          <span class="tile-icon" style="color:var(--purple);">${ic("book",56)}</span>
          <div class="tile-head"><span style="color:var(--purple);">${ic("book",14)}</span><h3>Study Notes</h3></div>
          <p>Read &amp; revise by topic</p>
        </div>
      </div>

      <div class="section-title">Today's recommendation</div>
      <div class="reco-list">
        <div class="reco-row" onclick="openTutorWithSubject('Quantitative Reasoning')">
          <div class="icon-box" style="width:36px;height:36px;min-width:36px;border-radius:12px;background:#fff3e0;">${ic("hash",17,"var(--orange)")}</div>
          <div style="flex:1;"><h3 style="margin:0;font-size:13.5px;font-family:'Poppins';color:var(--dark-grey);">Quantitative Reasoning</h3><p style="margin:1px 0 0;font-size:11.5px;color:#999;">Strengthen number patterns before mock exam</p></div>
          <div class="chev">›</div>
        </div>
      </div>

      <div class="section-title">Your badges</div>
      <div class="badge-row">
        <div class="badge"><div class="shield">🥇</div><div class="nm">First Quiz</div></div>
        <div class="badge"><div class="shield">🔥</div><div class="nm">3-Day Streak</div></div>
        <div class="badge"><div class="shield">📚</div><div class="nm">Bookworm</div></div>
        <div class="badge"><div class="shield">🎯</div><div class="nm">Sharp Shooter</div></div>
      </div>
    </div>
    ${bottomNav('home')}
  </div>`;
}
function goalLabel(){
  const g = state.user && state.user.goal;
  return g ? (g.length>10 ? g.slice(0,9)+'…' : g) : 'NCEE';
}

/* ---------------- BOTTOM NAV ---------------- */
function bottomNav(active){
  return `
  <div class="bottomnav">
    <button class="navitem ${active==='home'?'active':''}" onclick="goDashboard()"><span class="ic">${ic("home",20)}</span>Home</button>
    <button class="navitem ${active==='tutor'?'active':''}" onclick="openTutor()"><span class="ic">${ic("chat",20)}</span>Tutor</button>
    <button class="navitem ${active==='quiz'?'active':''}" onclick="openQuizSetup()"><span class="ic">${ic("quiz",20)}</span>Quiz</button>
    <button class="navitem ${active==='profile'?'active':''}" onclick="openProfile()"><span class="ic">${ic("profile",20)}</span>Profile</button>
  </div>`;
}
function goDashboard(){ state.screen='dashboard'; state.nav='home'; render(); }
function openProfile(){ state.screen='profile'; state.nav='profile'; render(); }

function renderProfile(){
  const u = state.user;
  return `
  <div class="screen">
    <div class="appbar"><div class="greet"><h2>Profile</h2><span>Your WinsPrep account</span></div>${initialsAvatar(u.name,42)}</div>
    <div class="content">
      <div class="card" style="cursor:default;">
        <div style="width:46px;height:46px;">${initialsAvatar(u.name,46)}</div>
        <div><h3>${u.name||'Learner'}</h3><p>${u.school||'—'} · ${u.stateName||'—'}</p></div>
      </div>
      <div class="section-title">Stats</div>
      <div class="stat-bar">
        <div class="stat-seg"><div class="num">${u.streak||1}</div><div class="lbl">Streak</div></div>
        <div class="stat-seg"><div class="num">${u.xp||0}</div><div class="lbl">XP</div></div>
        <div class="stat-seg"><div class="num">Primary 6</div><div class="lbl">Class</div></div>
      </div>
      <div class="section-title">Goal</div>
      <div class="card" style="cursor:default;"><p style="margin:0;font-size:13px;">${u.goal||'Pass Common Entrance with confidence'}</p></div>
      <div class="section-title">Family</div>
      <div class="card" onclick="openParent()">
        <div class="icon-box" style="background:var(--pink-soft);">${ic("people",22,"var(--pink)")}</div>
        <div><h3>Parent Dashboard</h3><p>Progress reports for a parent or guardian</p></div>
        <div class="chev">›</div>
      </div>
      <button class="btn btn-ghost" style="width:100%;margin-top:14px;" onclick="resetActivity()">Reset saved activity on this device</button>
    </div>
    ${bottomNav('profile')}
  </div>`;
}

/* ---------------- GRAMMAR COACH ---------------- */
function openGrammar(){ state.screen='grammar'; render(); }
function renderGrammar(){
  const g = state.grammar;
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="goDashboard()">${ic("arrow-left",16)}</button>
      <div style="flex:1;"><h3>Grammar Coach</h3><span style="color:#999;">Paste your writing for feedback</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic("gear",17)}</button>
    </div>
    <div class="quiz-setup">
      <div class="section-title">Your writing</div>
      <textarea id="grammarInput" rows="6" placeholder="Type or paste a sentence, paragraph, or short essay..."
        style="width:100%;border:1.5px solid #ececee;background:var(--white);border-radius:14px;padding:14px;font-family:'Nunito';font-size:13.5px;resize:vertical;">${g.text}</textarea>
      <button class="btn btn-solid-pink" style="width:100%;margin-top:14px;" ${g.loading?'disabled':''} onclick="checkGrammar()">
        ${g.loading ? 'Checking...' : 'Check My Writing'}
      </button>

      ${g.loading ? `<div class="loading-wrap" style="padding:24px;"><div class="spinner"></div><p>Reading your writing...</p></div>` : ''}

      ${g.result ? `
        <div class="section-title">Corrected version</div>
        <div class="card" style="cursor:default;align-items:flex-start;">
          <div class="icon-box" style="background:#e8f5e9;">${ic("check",22,"var(--green)")}</div>
          <div><p style="margin:0;font-size:13px;line-height:1.6;">${escapeHtml(g.result.corrected||'')}</p></div>
        </div>
        <div class="section-title">What to fix</div>
        ${(g.result.mistakes||[]).map(m=>`
          <div class="quiz-explain" style="margin-bottom:10px;">
            <div style="font-size:12.5px;"><s style="color:#e53935;">${escapeHtml(m.original||'')}</s> → <strong style="color:var(--green);">${escapeHtml(m.corrected||'')}</strong></div>
            <div style="margin-top:6px;">${escapeHtml(m.explanation||'')}</div>
          </div>`).join('') || `<p style="font-size:12.5px;color:#888;">No mistakes found — nice work!</p>`}
        <div class="section-title">Tips to sound even better</div>
        <div class="card" style="cursor:default;align-items:flex-start;">
          <div class="icon-box" style="background:#fff3e0;">${ic("bulb",22,"var(--orange)")}</div>
          <ul style="margin:0;padding-left:16px;font-size:12.5px;line-height:1.7;">
            ${(g.result.tips||[]).map(t=>`<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
    ${bottomNav('home')}
  </div>`;
}
async function checkGrammar(){
  const inputEl = document.getElementById('grammarInput');
  const text = inputEl.value.trim();
  if(!text || state.grammar.loading) return;
  state.grammar.text = text;
  state.grammar.loading = true;
  state.grammar.result = null;
  render();

  const system = `You are the WinsPrep Grammar Coach for a Nigerian Primary 6 pupil. Review the pupil's writing for grammar, punctuation, and spelling mistakes. Be encouraging, never harsh. Output ONLY valid JSON, no markdown fences, in this exact shape:
{"corrected":"the fully corrected version of the text","mistakes":[{"original":"short original snippet","corrected":"short corrected snippet","explanation":"simple one-sentence explanation a child can understand"}],"tips":["short vocabulary or style tip 1","short tip 2"]}
If there are no mistakes, return an empty mistakes array and still include 1-2 tips to help the writing grow stronger.`;

  try{
    let raw = await callOpenAI(system, [{ role:'user', content: text }], 1200);
    raw = raw.replace(/```json|```/g,'').trim();
    state.grammar.result = JSON.parse(raw);
    logActivity('grammar', 'Checked writing with Grammar Coach');
  }catch(err){
    if(err.message === 'missing_key'){
      state.grammar.loading = false;
      render();
      toggleSettings();
      return;
    }
    alert('Could not check your writing right now (' + err.message + ').');
  }
  state.grammar.loading = false;
  render();
}

/* ---------------- STUDY PLANNER ---------------- */
function openPlanner(){ state.screen='planner'; render(); }
const PLANNER_TIME_OPTIONS = ['30 minutes','1 hour','2 hours','3+ hours'];
const PLANNER_DAY_OPTIONS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function togglePlannerSubject(s){
  const list = state.planner.weakSubjects;
  const i = list.indexOf(s);
  if(i>=0) list.splice(i,1); else list.push(s);
  render();
}
function togglePlannerDay(d){
  const list = state.planner.days;
  const i = list.indexOf(d);
  if(i>=0) list.splice(i,1); else list.push(d);
  render();
}
function setPlannerField(field,val){ state.planner[field]=val; render(); }
function renderPlanner(){
  const p = state.planner;
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="goDashboard()">${ic("arrow-left",16)}</button>
      <div style="flex:1;"><h3>Study Planner</h3><span style="color:#999;">Build your revision timetable</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic("gear",17)}</button>
    </div>
    <div class="quiz-setup">
      ${p.plan ? renderPlanResult(p.plan) : `
        <div class="section-title">Exam date</div>
        <input type="date" id="examDate" value="${p.examDate}" onchange="setPlannerField('examDate', this.value)"
          style="width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid #ececee;background:var(--white);font-family:'Nunito';font-size:14px;">

        <div class="section-title">Study time available per day</div>
        <div class="option-grid">
          ${PLANNER_TIME_OPTIONS.map(t=>`<button class="opt-btn ${p.studyTime===t?'selected':''}" onclick="setPlannerField('studyTime','${t}')">${t}</button>`).join('')}
        </div>

        <div class="section-title">Weak subjects (pick any)</div>
        <div class="option-grid">
          ${QUIZ_SUBJECTS.map(s=>`<button class="opt-btn ${p.weakSubjects.includes(s)?'selected':''}" onclick="togglePlannerSubject('${s}')">${s}</button>`).join('')}
        </div>

        <div class="section-title">Preferred study days</div>
        <div class="option-grid">
          ${PLANNER_DAY_OPTIONS.map(d=>`<button class="opt-btn ${p.days.includes(d)?'selected':''}" onclick="togglePlannerDay('${d}')">${d}</button>`).join('')}
        </div>

        <div class="section-title">Target score (optional)</div>
        <input id="targetScore" value="${p.targetScore}" placeholder="e.g. 85%"
          style="width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid #ececee;background:var(--white);font-family:'Nunito';font-size:14px;"
          onchange="setPlannerField('targetScore', this.value)">

        <button class="btn btn-solid-pink" style="width:100%;margin-top:16px;" ${p.loading?'disabled':''} onclick="generatePlan()">
          ${p.loading ? 'Building your plan...' : 'Generate My Plan'}
        </button>
        ${p.loading ? `<div class="loading-wrap" style="padding:24px;"><div class="spinner"></div><p>Mapping out your week...</p></div>` : ''}
      `}
    </div>
    ${bottomNav('home')}
  </div>`;
}
function renderPlanResult(plan){
  return `
    <div class="section-title">${plan.examCountdown||'Your revision plan'}</div>
    ${(plan.weeklyPlan||[]).map(day=>`
      <div class="card" style="cursor:default;align-items:flex-start;">
        <div class="icon-box" style="background:var(--pink-soft);">${ic("calendar",22,"var(--pink)")}</div>
        <div style="width:100%;">
          <h3>${escapeHtml(day.day)}</h3>
          ${(day.sessions||[]).map(s=>`<p style="margin:4px 0;"><strong>${escapeHtml(s.time||'')}</strong> — ${escapeHtml(s.subject||'')}: ${escapeHtml(s.focus||'')}</p>`).join('')}
        </div>
      </div>`).join('')}
    <div class="section-title">Revision goals</div>
    <div class="card" style="cursor:default;align-items:flex-start;">
      <div class="icon-box" style="background:#e8f5e9;">${ic("target",22,"var(--green)")}</div>
      <ul style="margin:0;padding-left:16px;font-size:12.5px;line-height:1.8;">
        ${(plan.revisionGoals||[]).map(g=>`<li>${escapeHtml(g)}</li>`).join('')}
      </ul>
    </div>
    <button class="btn btn-ghost" style="width:100%;margin-top:6px;" onclick="state.planner.plan=null; render();">Build a New Plan</button>
  `;
}
async function generatePlan(){
  const p = state.planner;
  if(!p.examDate){ alert('Please choose an exam date first.'); return; }
  p.loading = true;
  render();

  const system = `You are a study-planning engine for a Nigerian Primary 6 pupil preparing for the Common Entrance Examination. Output ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{"examCountdown":"short line like 'X weeks until your exam'","weeklyPlan":[{"day":"Monday","sessions":[{"time":"4:00 PM - 4:45 PM","subject":"Mathematics","focus":"short focus topic"}]}],"revisionGoals":["short goal 1","short goal 2","short goal 3"]}
Only include entries for the days the pupil selected. Keep each day realistic for the available study time. Prioritize the weak subjects listed.`;

  const userMsg = `Exam date: ${p.examDate}. Today's date: ${new Date().toISOString().slice(0,10)}. Daily study time available: ${p.studyTime}. Weak subjects to prioritize: ${p.weakSubjects.join(', ')||'none specified, cover a balanced mix'}. Preferred study days: ${p.days.join(', ')}. Target score: ${p.targetScore||'not specified'}. Build one week of a repeating revision timetable.`;

  try{
    let raw = await callOpenAI(system, [{ role:'user', content: userMsg }], 2000);
    raw = raw.replace(/```json|```/g,'').trim();
    p.plan = JSON.parse(raw);
    logActivity('planner', 'Generated a new study plan');
  }catch(err){
    if(err.message === 'missing_key'){
      p.loading = false;
      render();
      toggleSettings();
      return;
    }
    alert('Could not build the plan right now (' + err.message + ').');
  }
  p.loading = false;
  render();
}

/* ---------------- HOMEWORK HELPER ---------------- */
function openHomework(){
  state.screen='homework';
  if(state.homework.messages.length===0){
    state.homework.messages.push({ role:'ai', text: "Hi! Type your homework question, or snap/upload a photo of it and I'll walk you through solving it — step by step." });
  }
  render();
}
function handleHomeworkImage(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.homework.imageBase64 = reader.result; // data:image/...;base64,....
    state.homework.imageName = file.name;
    render();
  };
  reader.readAsDataURL(file);
}
function clearHomeworkImage(){
  state.homework.imageBase64 = null;
  state.homework.imageName = '';
  render();
}
function renderHomework(){
  const h = state.homework;
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="goDashboard()">${ic("arrow-left",16)}</button>
      <div style="flex:1;"><h3>Homework Helper</h3><span>● Online</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic("gear",17)}</button>
    </div>
    <div class="chat-body" id="chatBody">
      ${h.messages.map(m=>`<div class="bubble ${m.role==='ai'?'ai':'user'}">${m.image?`<div style="margin-bottom:6px;font-size:11px;opacity:0.8;">📎 ${escapeHtml(m.image)}</div>`:''}${escapeHtml(m.text)}</div>`).join('')}
      ${h.loading ? `<div class="bubble ai typing"><span></span><span></span><span></span></div>` : ''}
    </div>
    ${h.imageBase64 ? `
      <div style="padding:8px 16px;background:var(--white);display:flex;align-items:center;gap:10px;">
        <img src="${h.imageBase64}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">
        <span style="font-size:11.5px;color:#777;flex:1;">${escapeHtml(h.imageName)}</span>
        <button class="back-btn" style="width:28px;height:28px;font-size:12px;" onclick="clearHomeworkImage()">✕</button>
      </div>` : ''}
    <div class="chat-input">
      <label class="back-btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer;">
        📷<input type="file" accept="image/*" style="display:none;" onchange="handleHomeworkImage(this)">
      </label>
      <input id="homeworkInput" placeholder="Type your question..." onkeydown="if(event.key==='Enter')sendHomework()">
      <button class="send-btn" ${h.loading?'disabled':''} onclick="sendHomework()">${ic("send",18,"#fff")}</button>
    </div>
  </div>`;
}
async function sendHomework(){
  const input = document.getElementById('homeworkInput');
  const text = input.value.trim();
  if((!text && !state.homework.imageBase64) || state.homework.loading) return;

  state.homework.messages.push({ role:'user', text: text || '(photo attached)', image: state.homework.imageBase64 ? state.homework.imageName : null });
  state.homework.loading = true;
  const imageToSend = state.homework.imageBase64;
  render();

  const system = `You are the WinsPrep Homework Helper for a Nigerian Primary 6 pupil. Explain how to solve the problem step by step, in simple language. Never just state the final answer without reasoning. End with a short encouraging line.`;

  let userContent;
  if(imageToSend){
    userContent = [
      { type:'text', text: text || 'Please help me solve the question in this photo.' },
      { type:'image_url', image_url: { url: imageToSend } }
    ];
  } else {
    userContent = text;
  }

  try{
    const reply = await callOpenAI(system, [{ role:'user', content: userContent }], 800);
    state.homework.messages.push({ role:'ai', text: reply || "I couldn't work that out, try rephrasing or a clearer photo." });
    logActivity('homework', imageToSend ? 'Asked for help with a photographed question' : 'Asked a homework question');
  }catch(err){
    if(err.message === 'missing_key'){
      state.homework.loading = false;
      state.homework.imageBase64 = null; state.homework.imageName='';
      input.value='';
      render();
      toggleSettings();
      return;
    }
    state.homework.messages.push({ role:'ai', text: "I'm having trouble right now (" + err.message + "). Please try again." });
  }
  state.homework.loading = false;
  state.homework.imageBase64 = null;
  state.homework.imageName = '';
  input.value = '';
  render();
}

/* ---------------- STUDY NOTES / TEXTBOOK ---------------- */
function openNotes(){
  state.screen = 'notes';
  render();
}
function backToNotesSubjects(){
  state.notes = { phase:'subjects', subject:null, topics:[], topicsLoading:false, topic:null, content:null, loading:false, expanded:{}, image:null, imageLoading:false };
  render();
}
function backToNotesTopics(){
  state.notes.phase = 'topics';
  state.notes.content = null;
  render();
}
function toggleNoteSection(i){
  state.notes.expanded[i] = !state.notes.expanded[i];
  render();
}

async function selectNotesSubject(subject){
  state.notes.subject = subject;
  state.notes.topicsLoading = true;
  render();

  const system = `You suggest a table of contents for a Nigerian Primary 6 pupil studying for the Common Entrance Examination. Output ONLY a valid JSON array of exactly 8 short topic name strings for the given subject, ordered from foundational to more advanced. No markdown fences, no commentary.`;
  try{
    let raw = await callOpenAI(system, [{ role:'user', content: `Subject: ${subject}` }], 400);
    raw = raw.replace(/```json|```/g,'').trim();
    state.notes.topics = JSON.parse(raw);
    state.notes.phase = 'topics';
  }catch(err){
    if(err.message === 'missing_key'){ state.notes.topicsLoading=false; render(); toggleSettings(); return; }
    alert('Could not load topics right now (' + err.message + ').');
  }
  state.notes.topicsLoading = false;
  render();
}

async function selectNotesTopic(topic){
  if(!topic || !topic.trim()) return;
  state.notes.topic = topic.trim();
  state.notes.loading = true;
  state.notes.image = null;
  state.notes.imageLoading = true;
  const requestedTopic = state.notes.topic;
  fetchTopicImage(state.notes.subject, requestedTopic)
    .then(image => {
      if(state.notes.topic === requestedTopic){
        state.notes.image = image;
        state.notes.imageLoading = false;
        if(state.notes.phase === 'content') render();
      }
    })
    .catch(() => {
      if(state.notes.topic === requestedTopic){
        state.notes.imageLoading = false;
        if(state.notes.phase === 'content') render();
      }
    });
  render();

  const system = `You write clear, encouraging textbook-style study notes for a Nigerian Primary 6 pupil preparing for the Common Entrance Examination. Output ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "title": "short topic title",
  "intro": "1-2 sentence friendly introduction to the topic",
  "sections": [
    {
      "heading": "short section heading",
      "body": "2-5 sentences explaining this part simply, step by step where relevant",
      "chart": null or one of the chart objects described below
    }
  ],
  "keyTakeaways": ["short takeaway 1", "short takeaway 2", "short takeaway 3"]
}
Include 3-5 sections. At least 1-2 sections (wherever it genuinely helps understanding) should include a "chart" object using ONE of these exact shapes based on what fits the content:
- Bar chart: {"type":"bar","title":"short title","labels":["A","B","C"],"values":[10,20,15],"unit":"optional short unit like kg or %"}
- Pie chart: {"type":"pie","title":"short title","labels":["A","B"],"values":[60,40]}
- Cycle diagram (for processes/cycles): {"type":"cycle","title":"short title","steps":["Step one","Step two","Step three"]}
- Timeline (for sequences/history): {"type":"timeline","title":"short title","steps":["First","Then","Finally"]}
- Number line (for math topics): {"type":"number_line","title":"short title","min":0,"max":10,"points":[{"value":3,"label":"3"},{"value":7,"label":"7"}]}
- Comparison table: {"type":"comparison_table","title":"short title","headers":["Col A","Col B"],"rows":[["a1","b1"],["a2","b2"]]}
Use null for "chart" in sections where a chart wouldn't genuinely help. Never force a chart that doesn't make sense for the content.`;

  const userMsg = `Subject: ${state.notes.subject}. Topic: ${state.notes.topic}.`;

  try{
    let raw = await callOpenAI(system, [{ role:'user', content: userMsg }], 2500);
    raw = raw.replace(/```json|```/g,'').trim();
    state.notes.content = JSON.parse(raw);
    state.notes.phase = 'content';
    state.notes.expanded = { 0: true };
    logActivity('notes', `Read notes on ${state.notes.topic} (${state.notes.subject})`);
  }catch(err){
    if(err.message === 'missing_key'){ state.notes.loading=false; render(); toggleSettings(); return; }
    alert('Could not generate these notes right now (' + err.message + ').');
  }
  state.notes.loading = false;
  render();
}

function renderNotes(){
  const n = state.notes;
  if(n.phase === 'topics') return renderNotesTopics(n);
  if(n.phase === 'content') return renderNotesContent(n);
  return renderNotesSubjects(n);
}

function renderNotesSubjects(n){
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="goDashboard()">${ic('arrow-left',16)}</button>
      <div style="flex:1;"><h3>Study Notes</h3><span style="color:#999;">Pick a subject to start reading</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic('gear',17)}</button>
    </div>
    <div class="quiz-setup">
      <div class="section-title">Subjects</div>
      <div class="option-grid">
        ${QUIZ_SUBJECTS.map(s=>`<button class="opt-btn ${n.subject===s?'selected':''}" ${n.topicsLoading?'disabled':''} onclick="selectNotesSubject('${s}')">${s}</button>`).join('')}
      </div>
      ${n.topicsLoading ? `<div class="loading-wrap" style="padding:24px;"><div class="spinner"></div><p>Building your table of contents...</p></div>` : ''}
    </div>
    ${bottomNav('home')}
  </div>`;
}

function renderNotesTopics(n){
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="backToNotesSubjects()">${ic('arrow-left',16)}</button>
      <div style="flex:1;"><h3>${escapeHtml(n.subject)}</h3><span style="color:#999;">Choose a topic</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic('gear',17)}</button>
    </div>
    <div class="quiz-setup">
      ${n.loading ? `<div class="loading-wrap" style="padding:24px;"><div class="spinner"></div><p>Writing your notes...</p></div>` : `
        <div class="section-title">Table of contents</div>
        <div class="reco-list">
          ${(n.topics||[]).map(t=>`
            <div class="reco-row" onclick="selectNotesTopic('${escapeHtml(t).replace(/'/g,"\\'")}')">
              <div class="icon-box" style="width:36px;height:36px;min-width:36px;border-radius:12px;background:var(--pink-soft);">${ic('book',17,'var(--pink)')}</div>
              <div style="flex:1;"><h3 style="margin:0;font-size:13.5px;font-family:'Poppins';color:var(--dark-grey);">${escapeHtml(t)}</h3></div>
              <div class="chev">›</div>
            </div>`).join('')}
        </div>
        <div class="section-title">Or type your own topic</div>
        <input id="customTopicInput" placeholder="e.g. Fractions to decimals" onkeydown="if(event.key==='Enter'){selectNotesTopic(this.value);}"
          style="width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid #ececee;background:var(--white);font-family:'Nunito';font-size:14px;">
        <button class="btn btn-solid-pink" style="width:100%;margin-top:12px;" onclick="selectNotesTopic(document.getElementById('customTopicInput').value)">Read Notes</button>
      `}
    </div>
    ${bottomNav('home')}
  </div>`;
}

function renderNotesContent(n){
  const c = n.content;
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="backToNotesTopics()">${ic('arrow-left',16)}</button>
      <div style="flex:1;"><h3>${escapeHtml(c.title||n.topic)}</h3><span style="color:#999;">${escapeHtml(n.subject)}</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic('gear',17)}</button>
    </div>
    <div class="content" style="padding-top:14px;">
      ${c.intro ? `<p style="font-size:13px;color:#666;line-height:1.6;margin:0 0 14px;">${escapeHtml(c.intro)}</p>` : ''}
      ${renderNoteImage(n)}
      ${(c.sections||[]).map((sec,i)=>`
        <div class="note-section">
          <div class="note-section-head" onclick="toggleNoteSection(${i})">
            <h3>${escapeHtml(sec.heading)}</h3>
            <span class="note-chevron ${n.expanded[i]?'open':''}">${ic('arrow-left',16)}</span>
          </div>
          ${n.expanded[i] ? `
            <div class="note-section-body">
              <p>${escapeHtml(sec.body)}</p>
              ${sec.chart ? renderChart(sec.chart) : ''}
            </div>` : ''}
        </div>`).join('')}
      ${c.keyTakeaways && c.keyTakeaways.length ? `
        <div class="section-title">Key takeaways</div>
        <div class="card" style="cursor:default;align-items:flex-start;">
          <div class="icon-box" style="background:#e8f5e9;">${ic('check',22,'var(--green)')}</div>
          <ul style="margin:0;padding-left:16px;font-size:12.5px;line-height:1.8;">
            ${c.keyTakeaways.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
        </div>` : ''}
      <button class="btn btn-ghost" style="width:100%;margin:10px 0 6px;" onclick="backToNotesTopics()">Read another topic</button>
    </div>
  </div>`;
}

/* ---- Chart/diagram renderers ---- */
function renderChart(chart){
  try{
    if(chart.type === 'bar') return renderBarChart(chart);
    if(chart.type === 'pie') return renderPieChart(chart);
    if(chart.type === 'cycle') return renderCycleDiagram(chart);
    if(chart.type === 'timeline') return renderTimelineChart(chart);
    if(chart.type === 'number_line') return renderNumberLine(chart);
    if(chart.type === 'comparison_table') return renderComparisonTable(chart);
  }catch(e){ return ''; }
  return '';
}
const CHART_PALETTE = ['var(--pink)','var(--blue)','var(--green)','var(--orange)','var(--purple)','var(--deep-pink)'];

function renderBarChart(chart){
  const max = Math.max(...chart.values, 1);
  return `
  <div class="chart-box">
    ${chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : ''}
    <div class="bar-chart">
      ${chart.labels.map((label,i)=>{
        const val = chart.values[i] ?? 0;
        const pct = Math.round((val/max)*100);
        const color = CHART_PALETTE[i % CHART_PALETTE.length];
        return `
        <div class="bar-row" onclick="this.classList.toggle('bar-active')">
          <div class="bar-label">${escapeHtml(label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
          <div class="bar-value">${val}${chart.unit?(' '+escapeHtml(chart.unit)):''}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderPieChart(chart){
  const total = chart.values.reduce((a,b)=>a+b,0) || 1;
  let acc = 0;
  const stops = chart.labels.map((label,i)=>{
    const val = chart.values[i] ?? 0;
    const start = (acc/total)*360;
    acc += val;
    const end = (acc/total)*360;
    const color = CHART_PALETTE[i % CHART_PALETTE.length].replace('var(','').replace(')','');
    return { color, start, end };
  });
  // Resolve CSS var() names to actual color values isn't possible inline, so use conic-gradient with var() refs directly (supported).
  const gradientParts = chart.labels.map((label,i)=>{
    const val = chart.values[i] ?? 0;
    const pct = (val/total)*100;
    return `${CHART_PALETTE[i % CHART_PALETTE.length]} 0 ${pct}%`;
  });
  // Build a proper cumulative conic-gradient
  let cum = 0;
  const conicStops = chart.labels.map((label,i)=>{
    const val = chart.values[i] ?? 0;
    const pct = (val/total)*100;
    const fromPct = cum;
    cum += pct;
    return `${CHART_PALETTE[i % CHART_PALETTE.length]} ${fromPct}% ${cum}%`;
  }).join(', ');
  return `
  <div class="chart-box">
    ${chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : ''}
    <div class="pie-wrap">
      <div class="pie-circle" style="background:conic-gradient(${conicStops});"></div>
      <div class="pie-legend">
        ${chart.labels.map((label,i)=>{
          const val = chart.values[i] ?? 0;
          const pct = Math.round((val/total)*100);
          return `<div class="pie-legend-row"><span class="pie-dot" style="background:${CHART_PALETTE[i % CHART_PALETTE.length]};"></span>${escapeHtml(label)} <b>${pct}%</b></div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function renderCycleDiagram(chart){
  const steps = chart.steps || [];
  const n = steps.length;
  const radius = 78;
  const center = 100;
  const nodes = steps.map((step,i)=>{
    const angle = (i/n)*2*Math.PI - Math.PI/2;
    const x = center + radius*Math.cos(angle);
    const y = center + radius*Math.sin(angle);
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    return `
      <div class="cycle-node" style="left:${x}px;top:${y}px;background:${color};">${i+1}</div>
      <div class="cycle-label" style="left:${x}px;top:${y+22}px;">${escapeHtml(step)}</div>
    `;
  }).join('');
  return `
  <div class="chart-box">
    ${chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : ''}
    <div class="cycle-diagram">
      <svg class="cycle-ring" viewBox="0 0 200 200"><circle cx="100" cy="100" r="78" fill="none" stroke="#eee" stroke-width="2" stroke-dasharray="4 6"/></svg>
      ${nodes}
    </div>
  </div>`;
}

function renderTimelineChart(chart){
  const steps = chart.steps || [];
  return `
  <div class="chart-box">
    ${chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : ''}
    <div class="timeline-row">
      ${steps.map((step,i)=>`
        <div class="timeline-item">
          <div class="timeline-dot" style="background:${CHART_PALETTE[i % CHART_PALETTE.length]};">${i+1}</div>
          <div class="timeline-text">${escapeHtml(step)}</div>
        </div>
        ${i < steps.length-1 ? `<div class="timeline-connector"></div>` : ''}
      `).join('')}
    </div>
  </div>`;
}

function renderNumberLine(chart){
  const min = chart.min ?? 0, max = chart.max ?? 10;
  const span = max - min || 1;
  const width = 280;
  const toX = v => 10 + ((v-min)/span) * (width-20);
  const ticks = [];
  for(let v=min; v<=max; v++) ticks.push(v);
  return `
  <div class="chart-box">
    ${chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : ''}
    <svg viewBox="0 0 ${width} 70" style="width:100%;height:70px;">
      <line x1="10" y1="35" x2="${width-10}" y2="35" stroke="#ccc" stroke-width="2"/>
      ${ticks.map(v=>`<line x1="${toX(v)}" y1="30" x2="${toX(v)}" y2="40" stroke="#ccc" stroke-width="1.5"/><text x="${toX(v)}" y="54" font-size="9" text-anchor="middle" fill="#999">${v}</text>`).join('')}
      ${(chart.points||[]).map((p,i)=>`
        <circle cx="${toX(p.value)}" cy="35" r="7" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}"/>
        <text x="${toX(p.value)}" y="18" font-size="10" font-weight="800" text-anchor="middle" fill="var(--dark-grey)">${escapeHtml(p.label||String(p.value))}</text>
      `).join('')}
    </svg>
  </div>`;
}

function renderComparisonTable(chart){
  return `
  <div class="chart-box">
    ${chart.title ? `<div class="chart-title">${escapeHtml(chart.title)}</div>` : ''}
    <table class="note-table">
      <thead><tr>${(chart.headers||[]).map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${(chart.rows||[]).map(row=>`<tr>${row.map(cell=>`<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ---------------- PARENT DASHBOARD ---------------- */
function openParent(){ state.screen='parent'; render(); }
function renderParent(){
  const u = state.user;
  const history = state.quizHistory;
  const totalQuizzes = history.length;
  const avgPct = totalQuizzes ? Math.round(history.reduce((a,h)=>a+(h.correct/h.total*100),0)/totalQuizzes) : null;

  const bySubject = {};
  history.forEach(h=>{
    if(!bySubject[h.subject]) bySubject[h.subject] = { correct:0, total:0 };
    bySubject[h.subject].correct += h.correct;
    bySubject[h.subject].total += h.total;
  });
  const weakSubjects = Object.entries(bySubject)
    .map(([subj,v])=>({ subj, pct: Math.round(v.correct/v.total*100) }))
    .filter(s=>s.pct < 70)
    .sort((a,b)=>a.pct-b.pct);

  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="openProfile()">${ic("arrow-left",16)}</button>
      <div style="flex:1;"><h3>Parent Dashboard</h3><span style="color:#999;">${u?u.name:'Learner'}'s progress</span></div>
    </div>
    <div class="content" style="padding-top:16px;">
      <div class="stat-bar">
        <div class="stat-seg"><div class="num">${totalQuizzes}</div><div class="lbl">Quizzes Taken</div></div>
        <div class="stat-seg"><div class="num">${avgPct!==null?avgPct+'%':'—'}</div><div class="lbl">Average Score</div></div>
        <div class="stat-seg"><div class="num">${u?u.streak||1:1} 🔥</div><div class="lbl">Day Streak</div></div>
      </div>

      <div class="section-title">Weak subjects to support</div>
      ${weakSubjects.length ? weakSubjects.map(s=>`
        <div class="card" style="cursor:default;">
          <div class="icon-box" style="background:#fdecea;">${ic("trend-down",22,"#e53935")}</div>
          <div><h3>${escapeHtml(s.subj)}</h3><p>Averaging ${s.pct}% — worth extra practice</p></div>
        </div>`).join('') : `<div class="card" style="cursor:default;"><div class="icon-box" style="background:#e8f5e9;">${ic("thumbs",22,"var(--green)")}</div><div><h3>No weak spots yet</h3><p>${totalQuizzes?'Scores are looking solid across subjects':'Have your child take a quiz to see subject breakdowns here'}</p></div></div>`}

      <div class="section-title">Recent quiz activity</div>
      ${totalQuizzes ? history.slice().reverse().slice(0,6).map(h=>`
        <div class="card" style="cursor:default;">
          <div class="icon-box" style="background:var(--pink-soft);">${ic("quiz",22,"var(--pink)")}</div>
          <div><h3>${escapeHtml(h.subject)} · ${escapeHtml(h.difficulty)}</h3><p>${h.correct}/${h.total} correct · ${h.date}</p></div>
        </div>`).join('') : `<p style="font-size:12.5px;color:#888;">No quizzes taken yet this session.</p>`}

      <button class="btn btn-solid-pink" style="width:100%;margin-top:6px;" ${totalQuizzes?'':'disabled'} onclick="generateWeeklyReport()">
        ${state._weeklyReportLoading ? 'Writing report...' : 'Generate AI Weekly Report'}
      </button>
      ${state._weeklyReport ? `<div class="quiz-explain" style="margin-top:12px;">${escapeHtml(state._weeklyReport)}</div>` : ''}

      <div class="section-title">All activity on this device</div>
      ${state.activityLog.length ? state.activityLog.slice(0,20).map(a=>`
        <div class="card" style="cursor:default;">
          <div class="icon-box" style="background:${activityColor(a.type).bg};">${ic(activityColor(a.type).icon,20,activityColor(a.type).fg)}</div>
          <div><h3>${escapeHtml(a.detail)}</h3><p>${escapeHtml(a.time)}</p></div>
        </div>`).join('') : `<p style="font-size:12.5px;color:#888;">No activity recorded on this device yet.</p>`}
    </div>
  </div>`;
}
function activityColor(type){
  const map = {
    start:{icon:'home',bg:'var(--pink-soft)',fg:'var(--pink)'},
    quiz:{icon:'quiz',bg:'#e3f2fd',fg:'var(--blue)'},
    tutor:{icon:'chat',bg:'var(--pink-soft)',fg:'var(--pink)'},
    grammar:{icon:'pen',bg:'#f3e5f5',fg:'var(--purple)'},
    planner:{icon:'calendar',bg:'#e8f5e9',fg:'var(--green)'},
    homework:{icon:'camera',bg:'#fff3e0',fg:'var(--orange)'},
    notes:{icon:'book',bg:'#ede7f6',fg:'var(--purple)'}
  };
  return map[type] || map.start;
}
async function generateWeeklyReport(){
  if(!state.quizHistory.length) return;
  state._weeklyReportLoading = true;
  render();
  const system = `You write short, warm, plain-language weekly progress summaries for a parent of a Nigerian Primary 6 pupil, based on quiz activity data. Keep it to 4-6 sentences. Mention strengths, one or two areas to support at home, and one practical suggestion. No jargon.`;
  const userMsg = `Quiz history (subject, difficulty, correct/total, date): ${JSON.stringify(state.quizHistory)}`;
  try{
    const reply = await callOpenAI(system, [{ role:'user', content: userMsg }], 500);
    state._weeklyReport = reply;
  }catch(err){
    if(err.message === 'missing_key'){ state._weeklyReportLoading=false; render(); toggleSettings(); return; }
    alert('Could not generate the report right now (' + err.message + ').');
  }
  state._weeklyReportLoading = false;
  render();
}

/* ---------------- AI TUTOR ---------------- */
function openTutor(){
  state.screen='tutor'; state.nav='tutor';
  if(state.chat.messages.length===0){
    state.chat.messages.push({ role:'ai', text: `Hi ${((state.user&&state.user.name)||'there').split(' ')[0]}! I'm your WinsPrep AI Tutor 🌸 Pick a subject above or just ask me anything from your Common Entrance syllabus.` });
  }
  render();
}
function openTutorWithSubject(subj){
  state.chat.subject = subj;
  openTutor();
}
function selectSubject(subj){ state.chat.subject = subj; render(); }

function renderTutor(){
  const c = state.chat;
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="goDashboard()">${ic("arrow-left",16)}</button>
      <div style="flex:1;"><h3>AI Tutor</h3><span>● Online · ${c.subject}</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic("gear",17)}</button>
    </div>
    <div class="chips">
      ${SUBJECTS.map(s=>`<button class="chip ${c.subject===s?'selected':''}" onclick="selectSubject('${s}')">${s}</button>`).join('')}
    </div>
    <div class="chat-body" id="chatBody">
      ${c.messages.map(m=>`<div class="bubble ${m.role==='ai'?'ai':'user'}">${escapeHtml(m.text)}</div>`).join('')}
      ${c.loading ? `<div class="bubble ai typing"><span></span><span></span><span></span></div>` : ''}
    </div>
    <div class="chat-input">
      <input id="chatInput" placeholder="Ask about ${c.subject.toLowerCase()}..." onkeydown="if(event.key==='Enter')sendChat()">
      <button class="send-btn" ${c.loading?'disabled':''} onclick="sendChat()">${ic("send",18,"#fff")}</button>
    </div>
  </div>`;
}
function escapeHtml(t){
  const d = document.createElement('div'); d.innerText = t; return d.innerHTML;
}

async function sendChat(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if(!text || state.chat.loading) return;
  state.chat.messages.push({ role:'user', text });
  state.chat.loading = true;
  render();

  const system = `You are the WinsPrep AI Tutor, a friendly, patient, encouraging private tutor for Nigerian Primary 6 pupils preparing for Common Entrance exams (NCEE, Federal Unity College, State and Private school entrance exams). Current subject focus: ${state.chat.subject}.
Rules:
- Explain concepts step by step in simple language a 10-12 year old understands.
- Never just give the final answer to a problem without explaining the reasoning.
- Use short paragraphs, and where useful, numbered steps.
- Ask a short follow-up question sometimes to check understanding or encourage thinking.
- Use warm, motivating, age-appropriate language. Avoid slang.
- Keep replies focused and not too long (roughly 80-160 words) unless the student asks for more detail.`;

  const apiMessages = state.chat.messages
    .map(m=>({ role: m.role==='ai' ? 'assistant' : 'user', content: m.text }));

  try{
    const reply = await callOpenAI(system, apiMessages, 700);
    state.chat.messages.push({ role:'ai', text: reply || "Sorry, I couldn't come up with an answer. Try asking again." });
    logActivity('tutor', `Asked the AI Tutor about ${state.chat.subject}`);
  }catch(err){
    if(err.message === 'missing_key'){
      state.chat.messages.push({ role:'ai', text: "I need an OpenAI API key before I can help. Tap the ⚙️ icon above and paste your key in." });
      state.chat.loading = false;
      input.value='';
      render();
      toggleSettings();
      return;
    }
    state.chat.messages.push({ role:'ai', text: "I'm having trouble connecting right now (" + err.message + "). Please check your API key and try again." });
  }
  state.chat.loading = false;
  input.value='';
  render();
}

/* ---------------- QUIZ ---------------- */
function openQuizSetup(){
  state.quiz = { phase:'setup', subject: state.quiz.subject||'Mathematics', difficulty: state.quiz.difficulty||'Medium', count: state.quiz.count||10, questions:[], current:0, answers:[], loading:false };
  state.screen='quiz'; state.nav='quiz';
  render();
}
const QUIZ_SUBJECTS = ['Mathematics','English Language','Verbal Reasoning','Quantitative Reasoning','Basic Science','Social Studies','Civic Education'];
const DIFFICULTIES = ['Easy','Medium','Hard','Mixed'];
const COUNTS = [10,20,50];

function setQuizField(field, val){ state.quiz[field] = val; render(); }

function renderQuiz(){
  const q = state.quiz;
  if(q.phase==='setup') return renderQuizSetup(q);
  if(q.phase==='loading') return renderQuizLoading();
  if(q.phase==='active') return renderQuizActive(q);
  if(q.phase==='result') return renderQuizResult(q);
}

function renderQuizSetup(q){
  return `
  <div class="screen">
    <div class="chat-header">
      <button class="back-btn" onclick="goDashboard()">${ic("arrow-left",16)}</button>
      <div style="flex:1;"><h3>Practice Quiz</h3><span style="color:#999;">Set up your session</span></div>
      <button class="gear-btn" onclick="toggleSettings()">${ic("gear",17)}</button>
    </div>
    <div class="quiz-setup">
      <div class="section-title">Subject</div>
      <div class="option-grid">
        ${QUIZ_SUBJECTS.map(s=>`<button class="opt-btn ${q.subject===s?'selected':''}" onclick="setQuizField('subject','${s}')">${s}</button>`).join('')}
      </div>
      <div class="section-title">Difficulty</div>
      <div class="option-grid">
        ${DIFFICULTIES.map(d=>`<button class="opt-btn ${q.difficulty===d?'selected':''}" onclick="setQuizField('difficulty','${d}')">${d}</button>`).join('')}
      </div>
      <div class="section-title">Number of Questions</div>
      <div class="option-grid">
        ${COUNTS.map(c=>`<button class="opt-btn ${q.count===c?'selected':''}" onclick="setQuizField('count',${c})">${c} Qs</button>`).join('')}
      </div>
      <button class="btn btn-solid-pink" style="width:100%;margin-top:8px;" onclick="generateQuiz()">Generate Quiz</button>
    </div>
    ${bottomNav('quiz')}
  </div>`;
}

function renderQuizLoading(){
  return `
  <div class="screen">
    <div class="chat-header"><button class="back-btn" onclick="openQuizSetup()">${ic("arrow-left",16)}</button><div><h3>Practice Quiz</h3></div></div>
    <div class="loading-wrap">
      <div class="spinner"></div>
      <p>Generating your ${state.quiz.subject} questions...</p>
    </div>
  </div>`;
}

async function generateQuiz(){
  state.quiz.phase = 'loading';
  render();
  const q = state.quiz;
  const system = `You are a question-writing engine for a Nigerian Primary 6 Common Entrance exam prep app. Output ONLY valid JSON, no markdown fences, no preamble, no commentary. The JSON must be an array of question objects with this exact shape:
[{"question":"...", "options":["A text","B text","C text","D text"], "correctIndex":0, "explanation":"short step-by-step explanation of the correct answer", "visual":null}]
IMPORTANT: at least half of the questions MUST include a real "visual" object relevant to that specific question (not null) - do not default to null out of caution. For Mathematics and Quantitative Reasoning, almost every question should have one (number lines for arithmetic/fractions, bar charts for word problems with quantities). For Basic Science, Social Studies, and Civic Education, use one whenever the question involves a process, comparison, or sequence. Only leave "visual" null for questions that are purely about reading, grammar, or vocabulary with nothing to visualize.
Choose ONE of these exact shapes, built from the actual numbers/steps in that question (never reuse the same visual across different questions): {"type":"bar","title":"...","labels":["A","B"],"values":[3,5]}, {"type":"cycle","title":"...","steps":["First","Then","Finally"]}, {"type":"timeline","title":"...","steps":["First","Then","Finally"]}, {"type":"number_line","title":"...","min":0,"max":10,"points":[{"value":3,"label":"3"}]}, or {"type":"comparison_table","title":"...","headers":["A","B"],"rows":[["a","b"]]}. Never use an image URL, base64 data, or a separate image-generation request.`;
  const userMsg = `Generate ${q.count} multiple choice questions for the subject "${q.subject}" at "${q.difficulty}" difficulty, appropriate for a Nigerian Primary 6 pupil preparing for the Common Entrance Examination. Cover a good range of relevant topics. Return ONLY the JSON array, nothing else.`;

  try{
    let text = await callOpenAI(system, [{ role:'user', content: userMsg }], 4000);
    text = text.replace(/```json|```/g,'').trim();
    const questions = JSON.parse(text);
    state.quiz.questions = questions;
    state.quiz.current = 0;
    state.quiz.answers = [];
    state.quiz.phase = 'active';
  }catch(err){
    state.quiz.phase = 'setup';
    if(err.message === 'missing_key'){
      render();
      toggleSettings();
      return;
    }
    alert('Could not generate the quiz right now (' + err.message + '). Please check your API key and try again.');
  }
  render();
}

function renderQuizActive(q){
  const total = q.questions.length;
  const idx = q.current;
  const item = q.questions[idx];
  const answered = q.answers[idx] !== undefined;
  const selected = q.answers[idx];
  return `
  <div class="screen">
    <div class="quiz-progress">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:#888;">
        <span>Question ${idx+1} of ${total}</span><span>${q.subject}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${((idx+1)/total*100)}%;"></div></div>
    </div>
    <div class="quiz-q-wrap">
      <div class="quiz-question">${escapeHtml(item.question)}</div>
      ${item.options.map((opt,i)=>{
        let cls='quiz-opt';
        if(answered){
          if(i===item.correctIndex) cls+=' correct';
          else if(i===selected) cls+=' wrong';
        }
        return `<div class="${cls}" onclick="${answered?'':'answerQuiz('+i+')'}">${String.fromCharCode(65+i)}. ${escapeHtml(opt)}</div>`;
      }).join('')}
      ${answered ? `<div class="quiz-explain"><strong>Explanation:</strong> ${escapeHtml(item.explanation||'')}${renderQuizVisual(item, q.subject)}</div>` : ''}
    </div>
    <div class="quiz-footer">
      <button class="btn btn-solid-pink" style="width:100%;" ${answered?'':'disabled'} onclick="nextQuizQuestion()">
        ${idx+1===total ? 'See Results' : 'Next Question'}
      </button>
    </div>
  </div>`;
}

function renderQuizVisual(item, subject){
  const visual = item.visual || buildLocalVisual(subject, item.question, item.question);
  return visual ? `<div class="quiz-visual">${renderChart(visual)}</div>` : '';
}

// These visuals are generated in the browser. They are a zero-API fallback when
// a text model omits chart data or image generation is unavailable.
function buildLocalVisual(subject, topic, title){
  const name = String(subject || '').toLowerCase();
  const label = title || topic || 'Quick visual';
  if(name.includes('mathematics') || name.includes('quantitative')){
    return { type:'number_line', title:label, min:0, max:10, points:[{value:3,label:'3'},{value:7,label:'7'}] };
  }
  if(name.includes('science')){
    return { type:'cycle', title:label, steps:['Observe','Test','Explain','Review'] };
  }
  if(name.includes('social') || name.includes('civic')){
    return { type:'timeline', title:label, steps:['Learn','Discuss','Act'] };
  }
  return { type:'comparison_table', title:label, headers:['Think','Check','Choose'], rows:[['Read carefully','Compare clues','Pick the best answer']] };
}

function renderNoteImage(n){
  if(n.imageLoading){
    return `<div class="live-note-visual live-note-loading"><span class="spinner"></span><span>Finding a relevant study image...</span></div>`;
  }
  if(n.image && n.image.url){
    return `<figure class="live-note-visual">
    <img src="${escapeHtml(n.image.url)}" alt="${escapeHtml(n.topic || 'Study topic')}" onerror="this.closest('figure').remove()">
    <figcaption>Live reference image · ${escapeHtml(n.image.credit || 'Wikimedia Commons')}</figcaption>
  </figure>`;
  }
  // No real photo match found for this topic - show a relevant diagram instead of nothing.
  const fallback = buildLocalVisual(n.subject, n.topic, n.topic);
  return fallback ? `<div class="chart-box" style="margin-bottom:14px;">${renderChart(fallback)}</div>` : '';
}

// Loads a public, topical reference image without using an image-generation model
// or the learner's Gemini API key. Wikimedia's API permits browser requests with origin=*.
async function searchWikimedia(query){
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.search = new URLSearchParams({
    action:'query', format:'json', generator:'search', gsrsearch:query, gsrnamespace:'6',
    gsrlimit:'8', prop:'imageinfo', iiprop:'url|mime', iiurlwidth:'1200', origin:'*'
  }).toString();
  const response = await fetch(endpoint.toString());
  if(!response.ok) return null;
  const data = await response.json();
  const pages = Object.values((data.query && data.query.pages) || {});
  const match = pages.find(page => {
    const info = page.imageinfo && page.imageinfo[0];
    if(!info || !(info.thumburl || info.url)) return false;
    // Skip non-photo/illustration files (audio, pdf, category icons, etc.)
    const mime = info.mime || '';
    return mime.startsWith('image/') && !/\.svg$/i.test(info.url||'');
  });
  if(!match) return null;
  const image = match.imageinfo[0];
  return { url:image.thumburl || image.url, credit:'Wikimedia Commons' };
}

async function fetchTopicImage(subject, topic){
  // Try progressively broader/simpler queries - specific topic+subject phrasing often
  // has no exact photo match, but a simpler version of the same query usually does.
  const attempts = [
    `${topic} ${subject || ''}`.trim(),
    topic,
    subject
  ].filter(Boolean);

  for(const query of attempts){
    try{
      const result = await searchWikimedia(query);
      if(result) return result;
    }catch(e){ /* try next query */ }
  }
  return null;
}
function answerQuiz(i){
  state.quiz.answers[state.quiz.current] = i;
  render();
}
function nextQuizQuestion(){
  if(state.quiz.current+1 < state.quiz.questions.length){
    state.quiz.current++;
  } else {
    const correct = state.quiz.questions.filter((q,i)=>state.quiz.answers[i]===q.correctIndex).length;
    if(state.user){ state.user.xp = (state.user.xp||0) + correct*10; }
    state.quizHistory.push({
      subject: state.quiz.subject,
      difficulty: state.quiz.difficulty,
      correct,
      total: state.quiz.questions.length,
      date: new Date().toLocaleDateString()
    });
    logActivity('quiz', `${state.quiz.subject} quiz — ${correct}/${state.quiz.questions.length} correct`);
    state.quiz.phase = 'result';
  }
  render();
}

function renderQuizResult(q){
  const total = q.questions.length;
  const correct = q.questions.filter((item,i)=>q.answers[i]===item.correctIndex).length;
  const pct = Math.round((correct/total)*100);
  return `
  <div class="screen">
    <div class="result-hero">
      <div class="score">${pct}%</div>
      <div class="lbl">${correct} of ${total} correct · +${correct*10} XP</div>
    </div>
    <div class="content" style="padding-top:16px;">
      <div class="section-title">Review</div>
      ${q.questions.map((item,i)=>{
        const ok = q.answers[i]===item.correctIndex;
        return `<div class="card" style="cursor:default;">
          <div class="icon-box" style="background:${ok?'#eef8ef':'#fdecea'};">${ok?ic("check",22,"var(--green)"):ic("close",22,"#e53935")}</div>
          <div><h3 style="font-size:13px;">${escapeHtml(item.question.length>50?item.question.slice(0,50)+'…':item.question)}</h3>
          <p>Correct: ${escapeHtml(item.options[item.correctIndex])}</p></div>
        </div>`;
      }).join('')}
      <button class="btn btn-solid-pink" style="width:100%;margin-top:6px;" onclick="openQuizSetup()">Take Another Quiz</button>
      <button class="btn btn-ghost" style="width:100%;margin-top:10px;" onclick="goDashboard()">Back to Dashboard</button>
    </div>
  </div>`;
}

/* ---------------- LOCAL ACTIVITY STORAGE ---------------- */
// Persists to this browser's localStorage on this device, so activity survives
// closing the tab or restarting the browser (does not sync across devices).
const STORAGE_KEY = 'winsprep_activity_v1';

function persistData(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      user: state.user,
      quizHistory: state.quizHistory,
      activityLog: state.activityLog
    }));
  }catch(err){
    console.warn('WinsPrep: could not save activity to this device.', err);
  }
}

function loadStoredData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved.user){
      state.user = saved.user;
      state.screen = 'dashboard';
      state.nav = 'home';
    }
    if(saved.quizHistory) state.quizHistory = saved.quizHistory;
    if(saved.activityLog) state.activityLog = saved.activityLog;
  }catch(err){
    console.warn('WinsPrep: could not load saved activity.', err);
  }
}

function logActivity(type, detail){
  state.activityLog = state.activityLog || [];
  state.activityLog.unshift({ type, detail, time: new Date().toLocaleString() });
  state.activityLog = state.activityLog.slice(0, 50);
  persistData();
}

function resetActivity(){
  if(!confirm('This clears all saved activity and progress on this device. Continue?')) return;
  try{ localStorage.removeItem(STORAGE_KEY); }catch(err){}
  state.user = null;
  state.quizHistory = [];
  state.activityLog = [];
  state.screen = 'onboard';
  state.onboardIdx = 0;
  render();
}

loadStoredData();
render();
