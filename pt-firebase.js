(function(){
  const DB_URL = "https://proid-125a9-default-rtdb.asia-southeast1.firebasedatabase.app";

  const CURRENT_EMAIL_KEY = "nhg_current_user_email";
  const DEFAULT_POINTS = 50;

  function emailToKey(email){
    return String(email || "").trim().toLowerCase().replace(/\./g, ",");
  }

  function getCurrentEmail(){
    return (localStorage.getItem(CURRENT_EMAIL_KEY) || "").trim();
  }

  function setCurrentEmail(email){
    localStorage.setItem(CURRENT_EMAIL_KEY, String(email || "").trim());
  }

  function clearCurrentEmail(){
    localStorage.removeItem(CURRENT_EMAIL_KEY);
  }

  function getUserKey(){
    const email = getCurrentEmail();
    return email ? emailToKey(email) : "";
  }

  function isLoggedIn(){
    return !!getUserKey();
  }

  async function dbGet(path){
    const res = await fetch(`${DB_URL}/${path}.json`);
    if(!res.ok) throw new Error(`DB read failed (${res.status})`);
    return await res.json();
  }

  async function dbPut(path, value){
    const res = await fetch(`${DB_URL}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    if(!res.ok) throw new Error(`DB write failed (${res.status})`);
    return await res.json();
  }

  async function dbPatch(path, value){
    const res = await fetch(`${DB_URL}/${path}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    if(!res.ok) throw new Error(`DB patch failed (${res.status})`);
    return await res.json();
  }


  async function signup({ email, password, name }){
    email = String(email || "").trim();
    password = String(password || "");
    name = String(name || "").trim();

    if(!email || password.length < 4){
      throw new Error("Enter a valid email and password (min 4 chars).");
    }

    const key = emailToKey(email);

    
    const existing = await dbGet(`users/${key}/profile`);
    if(existing){
      throw new Error("Account already exists. Try Login.");
    }

    const userDoc = {
      profile: {
        email,
        name: name || (email.split("@")[0] || "User"),
        createdAt: Date.now()
      },
      
      password,
      points: DEFAULT_POINTS,
      events: {},
      rewardsRedeemed: {}
    };

    await dbPut(`users/${key}`, userDoc);

    // set "session"
    setCurrentEmail(email);
    return { email, key };
  }

  async function login({ email, password }){
    email = String(email || "").trim();
    password = String(password || "");

    if(!email || !password){
      throw new Error("Enter email & password.");
    }

    const key = emailToKey(email);
    const data = await dbGet(`users/${key}`);

    if(!data){
      throw new Error("Invalid Account. Please Sign up.");
    }
    if(String(data.password || "") !== password){
      throw new Error("Wrong password.");
    }

    setCurrentEmail(email);
    return { email, key };
  }

  function logout(){
    clearCurrentEmail();
  }

  
  // Ensure user exists 
  async function ensureUser(){
    const email = getCurrentEmail();
    const key = getUserKey();
    if(!email || !key) throw new Error("Not logged in");

    const profile = await dbGet(`users/${key}/profile`);
    if(!profile){
      await dbPatch(`users/${key}`, {
        profile: { email, name: email.split("@")[0] || "User", createdAt: Date.now() },
        points: DEFAULT_POINTS,
        events: {},
        rewardsRedeemed: {}
      });
      
    }

    const pts = await dbGet(`users/${key}/points`);
    if(pts === null || pts === undefined){
      await dbPut(`users/${key}/points`, DEFAULT_POINTS);
    }
  }

  // Profile (for autofill)
  async function getProfile(){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");
    const profile = await dbGet(`users/${key}/profile`);
    return profile || null;
  }

  
  // Points  
  async function getPoints(){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");
    const pts = await dbGet(`users/${key}/points`);
    const n = Number(pts);
    if(Number.isFinite(n) && n >= 0) return Math.floor(n);

    // if missing/invalid, reset
    await dbPut(`users/${key}/points`, DEFAULT_POINTS);
    return DEFAULT_POINTS;
  }

  async function setPoints(newPoints){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");
    const safe = Math.max(0, Math.floor(Number(newPoints) || 0));
    await dbPut(`users/${key}/points`, safe);
    return safe;
  }

    // Add points 
  async function addPoints(delta, meta){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");

    const add = Math.max(0, Math.floor(Number(delta) || 0));
    if(add <= 0) return await getPoints();


    const current = await getPoints();
    const next = current + add;
    await setPoints(next);

    
    const logId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await dbPut(`users/${key}/pointsHistory/${logId}`, {
      delta: add,
      after: next,
      meta: meta || {},
      at: Date.now()
    });

    return next;
  }

  
  async function awardCourseOnce({ courseId, courseName, points }){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");

    courseId = String(courseId || "").trim();
    if(!courseId) throw new Error("Missing courseId");

    const already = await dbGet(`users/${key}/coursesCompleted/${courseId}`);
    if(already && already.completed) {
      // already awarded
      return { awarded: false, total: await getPoints() };
    }

    const total = await addPoints(points, {
      source: "short_course",
      courseId,
      courseName: courseName || courseId
    });

    await dbPut(`users/${key}/coursesCompleted/${courseId}`, {
      completed: true,
      courseName: courseName || courseId,
      points: Math.max(0, Math.floor(Number(points) || 0)),
      completedAt: Date.now()
    });

    return { awarded: true, total };
  }


  
  // Redeemed  
  async function getRedeemed(){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");
    const data = await dbGet(`users/${key}/rewardsRedeemed`);
    return data || {};
  }

  async function setRedeemed(rewardId, cost){
    const key = getUserKey();
    if(!key) throw new Error("Not logged in");
    rewardId = String(rewardId || "reward_unknown");

    const payload = {
      cost: Math.max(0, Math.floor(Number(cost) || 0)),
      redeemedAt: Date.now()
    };

    await dbPut(`users/${key}/rewardsRedeemed/${rewardId}`, payload);
    return payload;
  }

  
  // Navbar auth UI 
  function applyNavAuthUI({ signInId, logoutId, showWhenLoggedInIds = [], logoutRedirect = "login.html" }){
    const signInEl = document.getElementById(signInId);
    const logoutEl = document.getElementById(logoutId);

    const loggedIn = isLoggedIn();

    if(signInEl) signInEl.style.display = loggedIn ? "none" : "";
    if(logoutEl) logoutEl.style.display = loggedIn ? "" : "none";

    showWhenLoggedInIds.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = loggedIn ? "" : "none";
    });

    if(logoutEl){
      logoutEl.onclick = () => {
        logout();
        if(logoutRedirect) window.location.href = logoutRedirect;
      };
    }
  }

    
    // Leaderboard
    async function getSingaporeLeaderboardTop(limit = 5){     
      const users = await dbGet("users");
      if(!users) return [];

      const rows = Object.values(users)
        .map(u => {
          const name = u?.profile?.name || (u?.profile?.email ? u.profile.email.split("@")[0] : "User");
          const points = Number(u?.points || 0);
          return { name: String(name), points: Number.isFinite(points) ? points : 0 };
        })
        .sort((a,b) => b.points - a.points)
        .slice(0, limit);

      return rows;
    }

   
    async function getFriendsLeaderboardTop(limit = 5){
      if(!isLoggedIn()) return [];
      return [];
    }


  
  window.PT = {
    // auth
    signup,
    login,
    logout,
    isLoggedIn,

    // user
    ensureUser,
    getProfile,

    // points
    getPoints,
    setPoints,
    addPoints,
    awardCourseOnce,

    // redeemed
    getRedeemed,
    setRedeemed,

    // leaderboard
    getSingaporeLeaderboardTop,
    getFriendsLeaderboardTop,

    // ui helper
    applyNavAuthUI
  };
})();
