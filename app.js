
const { useState, useEffect, useCallback } = React;

const hashPassword = (pw) => btoa(unescape(encodeURIComponent(pw + "_Ecotrack_salt")));

const BADGES = [
  { id: "sapling",  label: "First Sapling",    icon: "🌱", trees: 1   },
  { id: "champion", label: "5 Trees Champion",  icon: "🌿", trees: 5   },
  { id: "guardian", label: "25 Trees Guardian", icon: "🌳", trees: 25  },
  { id: "legend",   label: "100 Trees Legend",  icon: "🌲", trees: 100 },
];

const getBadge = (treesPlanted) => {
  let badge = { id: "seedling", label: "Seedling", icon: "🪴", trees: 0 };
  for (const b of BADGES) { if (treesPlanted >= b.trees) badge = b; }
  return badge;
};

const getNextBadge = (treesPlanted) => {
  for (const b of BADGES) { if (treesPlanted < b.trees) return b; }
  return null;
};

const SAMPLE_PRODUCTS = [
  { id: 1, title: "Bamboo Water Bottle", price: 499,  description: "100% sustainable bamboo, BPA-free.",      image: "🎋", seller: "EcoShop"    },
  { id: 2, title: "Seed Starter Kit",    price: 299,  description: "Grow 12 native tree species at home.",    image: "🌱", seller: "GreenThumb" },
  { id: 3, title: "Solar Charger Pad",   price: 1999, description: "Charge devices with clean solar energy.", image: "☀️", seller: "SolarLife"  },
  { id: 4, title: "Compost Bin",         price: 799,  description: "Turn kitchen waste into garden gold.",    image: "♻️", seller: "EarthCycle" },
];

const STORAGE_KEY = "ecotrack_db";

const loadDB = async () => {
  try {
    const result = await window.storage.get(STORAGE_KEY);
    if (result) return JSON.parse(result.value);
  } catch {}
  return { users: {}, products: SAMPLE_PRODUCTS };
};

const saveDB = async (db) => {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(db)); } catch {}
};

const THRESHOLDS = {
  MIN_PLANT_GREEN:   0.03,
  MIN_SAPLING_YOUNG: 0.01,
  MIN_SOIL:          0.01,
  MIN_SAPLING_GREEN: 0.03,
  MAX_SAPLING_GREEN: 0.55,
};

const verifyTreeImage = (imageSrc) => new Promise((resolve) => {
  const img = new Image();
  img.src = imageSrc;

  img.onload = () => {
    const canvas  = document.createElement("canvas");
    canvas.width  = 300;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 300, 300);

    const pixels = ctx.getImageData(0, 0, 300, 300).data;

    let darkGreen   = 0;
    let lightGreen  = 0;
    let yellowGreen = 0;
    let brownSoil   = 0;
    let blueSky     = 0;
    let total       = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      total++;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const brightness = (max + min) / 2;

      if (g > r + 20 && g > b + 20 && g > 40 && brightness < 120) darkGreen++;
      if (g > r + 10 && g > b + 10 && g > 80 && brightness >= 100 && brightness < 200) lightGreen++;
      if (r > 100 && g > 120 && b < 80 && g > r - 30 && g >= r) yellowGreen++;
      if (r > 80 && r > g && g > b && g > 40 && b < 100 && r - b > 30 && brightness > 40 && brightness < 180) brownSoil++;
      if (b > r + 20 && b > g + 10 && b > 80) blueSky++;
    }

    const darkR      = darkGreen   / total;
    const lightR     = lightGreen  / total;
    const yellowR    = yellowGreen / total;
    const soilR      = brownSoil   / total;
    const skyR       = blueSky     / total;
    const youngGreen = lightR + yellowR;
    const totalGreen = darkR + lightR * 0.8 + yellowR * 0.6;

    const isPlant         = totalGreen >= THRESHOLDS.MIN_PLANT_GREEN && skyR < 0.5;
    const greenCoverageOk = totalGreen >= THRESHOLDS.MIN_SAPLING_GREEN && totalGreen <= THRESHOLDS.MAX_SAPLING_GREEN;
    const isSapling       = isPlant && greenCoverageOk && youngGreen >= THRESHOLDS.MIN_SAPLING_YOUNG && (soilR >= THRESHOLDS.MIN_SOIL || youngGreen > darkR);

    let score = totalGreen * 2;
    if (soilR > THRESHOLDS.MIN_SOIL)               score += 0.15;
    if (youngGreen > darkR)                         score += 0.10;
    if (skyR > 0.4)                                 score -= 0.20;
    if (totalGreen > THRESHOLDS.MAX_SAPLING_GREEN)  score -= 0.40;
    const confidence = parseFloat(Math.min(Math.max(score, 0), 0.99).toFixed(2));

    const gPct     = (totalGreen * 100).toFixed(1);
    const youngPct = (youngGreen  * 100).toFixed(1);
    const soilPct  = (soilR       * 100).toFixed(1);

    let reason = "";
    if (!isPlant) {
      if (skyR > 0.5)
        reason = `Too much sky (${(skyR*100).toFixed(0)}%). Point camera directly at the plant.`;
      else
        reason = `Only ${gPct}% green detected — doesn't look like a plant.`;
    } else if (totalGreen > THRESHOLDS.MAX_SAPLING_GREEN) {
      reason = `🌳 Plant detected but too large (${gPct}% green). Please upload a photo of a SAPLING, not a big tree.`;
    } else if (isSapling) {
      reason = `🌱 Sapling confirmed! Green coverage: ${gPct}%, Young leaves: ${youngPct}%, Soil: ${soilPct}%`;
    } else {
      reason = `🌿 Plant detected (${gPct}% green) but not enough young leaf or soil features for a sapling.`;
    }

    resolve({ isPlant, isSapling, confidence, reason,
      debug: { darkR, lightR, yellowR, soilR, skyR, totalGreen } });
  };

  img.onerror = () => resolve({
    isPlant: false, isSapling: false, confidence: 0,
    reason: "Could not read image. Try a different file."
  });
});

function GreenRank() {
  const [db, setDB]                   = useState({ users: {}, products: SAMPLE_PRODUCTS });
  const [dbReady, setDbReady]         = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage]               = useState("home");
  const [notify, setNotify]           = useState(null);
  const [globalUsers, setGlobalUsers] = useState([]); 

  useEffect(() => {
    loadDB().then(data => { setDB(data); setDbReady(true); });

    if (window.fbListenLeaderboard) {
      window.fbListenLeaderboard((firebaseUsers) => {
        setGlobalUsers(firebaseUsers);
      });
    }
    return () => { if (window.fbOffLeaderboard) window.fbOffLeaderboard(); };
  }, []);

  const persist = (newDB) => { setDB(newDB); saveDB(newDB); };

  const showNotify = (msg) => {
    setNotify(msg);
    setTimeout(() => setNotify(null), 3500);
  };

  const logout = () => {
    setCurrentUser(null);
    setPage("home");
    showNotify("Logged out. See you soon! 🌿");
  };

  const totalTrees = globalUsers.length > 0
    ? globalUsers.reduce((s, u) => s + (u.treesPlanted || 0), 0)
    : Object.values(db.users).reduce((s, u) => s + u.treesPlanted, 0);

  const getAllUsers = () => {
    if (globalUsers.length > 0) {
      return globalUsers
        .map(u => ({
          ...u,
          username: u.name,
          badge: getBadge(u.treesPlanted || 0),
          submissions: db.users[u.name]?.submissions || []
        }))
        .sort((a, b) => b.points - a.points)
        .map((u, i) => ({ ...u, rank: i + 1 }));
    }
    return Object.values(db.users)
      .map(u => ({ ...u, badge: getBadge(u.treesPlanted) }))
      .sort((a, b) => b.points - a.points)
      .map((u, i) => ({ ...u, rank: i + 1 }));
  };

  return (
    <div className="app">
      <Nav currentUser={currentUser} page={page} setPage={setPage} logout={logout} db={db} />

      {page === "home"        && <HomePage setPage={setPage} totalTrees={totalTrees} users={getAllUsers()} />}
      {page === "login"       && <LoginPage db={db} setCurrentUser={setCurrentUser} setPage={setPage} showNotify={showNotify} />}
      {page === "register"    && <RegisterPage db={db} persist={persist} setCurrentUser={setCurrentUser} setPage={setPage} showNotify={showNotify} />}
      {page === "dashboard"   && currentUser && (
        <DashboardPage
          user={db.users[currentUser]}
          db={db}
          persist={persist}
          showNotify={showNotify}
          currentUser={currentUser}
          allUsers={getAllUsers()}
        />
      )}
      {page === "leaderboard" && <LeaderboardPage users={getAllUsers()} currentUser={currentUser} />}
      {page === "education"   && <EducationPage />}
      {page === "marketplace" && <MarketplacePage db={db} persist={persist} currentUser={currentUser} showNotify={showNotify} />}

      <footer>
        <p>🌿 <span>EcoTrack</span> — Plant Today. Earn Tomorrow. Protect Forever. | Making the world greener, one tree at a time.</p>
      </footer>
      {notify && <div className="notify">{notify}</div>}
    </div>
  );
}

function Nav({ currentUser, page, setPage, logout, db }) {
  const userPoints = db?.users?.[currentUser]?.points ?? 0;
  return (
    <nav>
      <button className="nav-logo" onClick={() => setPage("home")} style={{ background: "none", border: "none", cursor: "pointer" }}>
        🌿 EcoTrack
      </button>
      <div className="nav-links">
        <button className={`nav-btn ${page === "home"        ? "active" : ""}`} onClick={() => setPage("home")}>Home</button>
        <button className={`nav-btn ${page === "leaderboard" ? "active" : ""}`} onClick={() => setPage("leaderboard")}>Leaderboard</button>
        <button className={`nav-btn ${page === "education"   ? "active" : ""}`} onClick={() => setPage("education")}>Learn</button>
        <button className={`nav-btn ${page === "marketplace" ? "active" : ""}`} onClick={() => setPage("marketplace")}>Market</button>
        {currentUser ? (
          <div className="nav-user">
            <span className="nav-points">🪙 {userPoints}</span>
            <button className="nav-btn active" onClick={() => setPage("dashboard")}>Dashboard</button>
            <button className="nav-btn" onClick={logout}>Logout</button>
          </div>
        ) : (
          <>
            <button className="nav-btn" onClick={() => setPage("login")}>Login</button>
            <button className="nav-btn cta" onClick={() => setPage("register")}>Join Free</button>
          </>
        )}
      </div>
    </nav>
  );
}

function HomePage({ setPage, totalTrees, users }) {
  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">🌍 Join the Green Revolution</div>
          <h1>Plant Today. Earn Tomorrow. <span>Protect Forever.</span></h1>
          <p>Upload proof of your planted trees, get verified by our pixel scanner, climb the leaderboard, and make a real environmental impact.</p>
          <div className="hero-cta">
            <button className="btn btn-primary" style={{ fontSize: "1.1rem", padding: "1rem 2.25rem" }} onClick={() => setPage("register")}>🌱 Start Planting</button>
            <button className="btn btn-secondary" style={{ color: "white", borderColor: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.1)" }} onClick={() => setPage("leaderboard")}>🏆 View Leaderboard</button>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><div className="hero-stat-num">{totalTrees}</div><div className="hero-stat-label">Trees Planted</div></div>
            <div className="hero-stat"><div className="hero-stat-num">{users.length}</div><div className="hero-stat-label">Green Warriors</div></div>
            <div className="hero-stat"><div className="hero-stat-num">🔍</div><div className="hero-stat-label">Pixel Verified</div></div>
          </div>
        </div>
      </section>

      <div className="ad-banner"><span>📢 Ad Space Available</span> — Advertise your eco-friendly brand to our passionate green community</div>

      <section className="section" style={{ background: "white" }}>
        <div className="section-center">
          <h2 className="section-title">How EcoTrack Works</h2>
          <p className="section-sub">Four simple steps to make your environmental impact count</p>
          <div className="features-grid">
            {[
              { icon: "📸", title: "Upload Tree Photo",  desc: "Take a clear photo of your planted tree or sapling and upload it to the platform." },
              { icon: "🔍", title: "Pixel Verification", desc: "Our built-in scanner checks green pixels in your image to confirm it is a real plant." },
              { icon: "🪙", title: "Earn Points",        desc: "Verified plants earn +10 points. Accumulate points to climb the leaderboard and unlock badges." },
              { icon: "🏆", title: "Compete & Win",      desc: "Rise through global rankings, unlock exclusive badges, and inspire your community to go green." },
            ].map(f => (
              <div className="feature-card" key={f.title}>
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-center">
          <h2 className="section-title">🏆 Top Planters</h2>
          <p className="section-sub">Our leading environmental champions</p>
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="leaderboard-table">
              <thead><tr><th>Rank</th><th>User</th><th>Points</th><th>Trees</th><th>Badge</th></tr></thead>
              <tbody>
                {users.slice(0, 5).map(u => (
                  <tr key={u.username} className="lb-row">
                    <td><RankBadge rank={u.rank} /></td>
                    <td className="lb-username">{u.username}</td>
                    <td className="lb-points">🪙 {u.points}</td>
                    <td>🌱 {u.treesPlanted}</td>
                    <td className="lb-badge-icon">{u.badge.icon}</td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "#888", padding: "2rem" }}>Be the first to plant a tree! 🌱</td></tr>
                )}
              </tbody>
            </table>
            <button className="btn btn-secondary full-btn" onClick={() => setPage("leaderboard")}>View Full Leaderboard →</button>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--forest)" }}>
        <div className="section-center" style={{ textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "2.5rem", color: "white", marginBottom: "1rem" }}>Ready to Make a Difference?</h2>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "1.1rem", marginBottom: "2rem", maxWidth: "600px", margin: "0 auto 2rem" }}>
            Join thousands of environmental warriors. Every tree you plant earns points and helps fight climate change.
          </p>
          <button className="btn btn-primary" style={{ fontSize: "1.1rem", padding: "1rem 2.5rem" }} onClick={() => setPage("register")}>🌿 Join EcoTrack Free</button>
        </div>
      </section>
    </>
  );
}

function LoginPage({ db, setCurrentUser, setPage, showNotify }) {
  const [form,  setForm]  = useState({ username: "", password: "" });
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    setError("");
    const user = db.users[form.username.toLowerCase()];
    if (!user) return setError("User not found.");
    if (user.passwordHash !== hashPassword(form.password)) return setError("Incorrect password.");
    setCurrentUser(form.username.toLowerCase());
    showNotify(`Welcome back, ${user.username}! 🌿`);
    setPage("dashboard");
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-title">🌿 Welcome Back</div>
        <p className="auth-sub">Continue your green journey</p>
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input className="form-input" value={form.username} onChange={e => setForm({...form, username: e.target.value})} required placeholder="greenwarrior42" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required placeholder="••••••••" />
          </div>
          {error && <p className="form-error">⚠️ {error}</p>}
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}>Login →</button>
        </form>
        <p className="auth-link">No account? <button onClick={() => setPage("register")}>Register here</button></p>
      </div>
    </div>
  );
}

function RegisterPage({ db, persist, setCurrentUser, setPage, showNotify }) {
  const [form,  setForm]  = useState({ username: "", password: "", confirm: "" });
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    setError("");
    const uname = form.username.toLowerCase().trim();
    if (uname.length < 3)               return setError("Username must be at least 3 characters.");
    if (db.users[uname])                return setError("Username already taken.");
    if (form.password.length < 6)       return setError("Password must be at least 6 characters.");
    if (form.password !== form.confirm)  return setError("Passwords don't match.");

    const newUser = {
      username: uname,
      passwordHash: hashPassword(form.password),
      points: 0, treesPlanted: 0, submissions: [],
      createdAt: new Date().toISOString(),
    };
    const newDB = { ...db, users: { ...db.users, [uname]: newUser } };
    persist(newDB);

    if (window.fbSaveUser) window.fbSaveUser(uname, 0, 0, "Seedling");

    setCurrentUser(uname);
    showNotify(`Welcome to EcoTrack, ${uname}! 🌱`);
    setPage("dashboard");
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-title">🌱 Join EcoTrack</div>
        <p className="auth-sub">Start your environmental journey today</p>
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input className="form-input" value={form.username} onChange={e => setForm({...form, username: e.target.value})} required placeholder="greenwarrior42" minLength={3} />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required placeholder="Min 6 characters" />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input className="form-input" type="password" value={form.confirm} onChange={e => setForm({...form, confirm: e.target.value})} required placeholder="Repeat password" />
          </div>
          {error && <p className="form-error">⚠️ {error}</p>}
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}>Create Account 🌿</button>
        </form>
        <p className="auth-link">Already have an account? <button onClick={() => setPage("login")}>Login</button></p>
      </div>
    </div>
  );
}

function DashboardPage({ user, db, persist, showNotify, currentUser, allUsers }) {
  const [uploading, setUploading] = useState(false);
  const [preview,   setPreview]   = useState(null);
  const [verResult, setVerResult] = useState(null);

  const badge     = getBadge(user.treesPlanted);
  const nextBadge = getNextBadge(user.treesPlanted);
  const myRank    = allUsers.find(u => u.username === currentUser)?.rank || "-";
  const progress  = nextBadge ? Math.min(100, Math.round((user.treesPlanted / nextBadge.trees) * 100)) : 100;

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showNotify("Please upload an image file.");
    if (file.size > 10 * 1024 * 1024)    return showNotify("Image too large. Max 10MB.");
    if (file.size < 10 * 1024)           return showNotify("Image too small. Use a real photo.");
    const reader = new FileReader();
    reader.onload = (ev) => { setPreview(ev.target.result); setVerResult(null); };
    reader.readAsDataURL(file);
  };

  const handleVerify = async () => {
    if (!preview) return;
    setUploading(true);
    setVerResult({ status: "loading" });

    const result      = await verifyTreeImage(preview);
    const isApproved  = result.isSapling && result.confidence > 0.05;
    const pointsDelta = isApproved ? 10 : -5;
    const newPoints   = Math.max(0, user.points + pointsDelta);
    const newTrees    = isApproved ? user.treesPlanted + 1 : user.treesPlanted;

    const newSubmission = {
      id: Date.now(),
      status: isApproved ? "approved" : "rejected",
      confidence: result.confidence,
      pointsDelta,
      reason: result.reason,
      date: new Date().toLocaleString(),
    };

    const updatedUser = {
      ...user,
      points: newPoints,
      treesPlanted: newTrees,
      submissions: [newSubmission, ...(user.submissions || [])],
    };

    persist({ ...db, users: { ...db.users, [currentUser]: updatedUser } });

    if (window.fbSaveUser) {
      window.fbSaveUser(currentUser, newPoints, newTrees, getBadge(newTrees).label);
    }

    setVerResult({
      status: isApproved ? "approved" : "rejected",
      confidence: result.confidence,
      pointsDelta,
      isSapling: result.isSapling,
      reason: result.reason
    });
    showNotify(isApproved ? "✅ Plant verified! +10 points!" : "❌ Not a valid plant. -5 points.");
    setUploading(false);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>🌿 Welcome, {user.username}!</h1>
        <p>Your environmental impact dashboard</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-icon">🪙</div><div className="stat-value">{user.points}</div><div className="stat-label">Total Points</div></div>
        <div className="stat-card"><div className="stat-icon">🌱</div><div className="stat-value">{user.treesPlanted}</div><div className="stat-label">Trees Planted</div></div>
        <div className="stat-card"><div className="stat-icon">🏆</div><div className="stat-value">#{myRank}</div><div className="stat-label">Global Rank</div></div>
        <div className="stat-card"><div className="stat-icon">{badge.icon}</div><div className="stat-value" style={{ fontSize: "1rem" }}>{badge.label}</div><div className="stat-label">Current Badge</div></div>
      </div>

      <div className="dashboard-grid">
        {  }
        <div className="card">
          <h3 style={{ marginBottom: "1rem", color: "var(--forest)" }}>🏅 Badge Progress</h3>
          <div className="badge-display">
            <span className="badge-icon">{badge.icon}</span>
            <div>
              <div className="badge-name">{badge.label}</div>
              <div className="badge-desc">{badge.trees === 0 ? "Plant your first tree to start!" : `Earned at ${badge.trees} tree${badge.trees > 1 ? "s" : ""}`}</div>
            </div>
          </div>
          {nextBadge && (
            <div className="progress-bar-wrap">
              <div className="progress-label">
                <span>Progress to {nextBadge.icon} {nextBadge.label}</span>
                <span>{user.treesPlanted}/{nextBadge.trees} trees</span>
              </div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
          {!nextBadge && <p style={{ textAlign: "center", color: "var(--leaf)", fontWeight: 600, marginTop: "1rem" }}>🌲 Maximum Legend Status Achieved!</p>}
          <div style={{ marginTop: "1.5rem" }}>
            <p style={{ fontSize: "0.85rem", color: "#888", marginBottom: "0.75rem", fontWeight: 600 }}>ALL BADGES</p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {BADGES.map(b => (
                <div key={b.id} style={{ padding: "0.5rem 0.75rem", borderRadius: "8px", background: user.treesPlanted >= b.trees ? "var(--sky)" : "#f5f5f5", border: `2px solid ${user.treesPlanted >= b.trees ? "var(--leaf)" : "#e5e7eb"}`, opacity: user.treesPlanted >= b.trees ? 1 : 0.5, fontSize: "0.8rem", fontWeight: 600 }}>
                  {b.icon} {b.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {  }
        <div className="card">
          <h3 style={{ marginBottom: "1rem", color: "var(--forest)" }}>📸 Upload Tree Photo</h3>
          {preview ? (
            <>
              <img src={preview} alt="Tree preview" className="upload-preview" />
              <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setPreview(null); setVerResult(null); }}>Remove</button>
                <button className="btn btn-primary btn-sm" onClick={handleVerify} disabled={uploading}>
                  {uploading ? <><span className="spinner" /> Analyzing...</> : "🔍 Verify Plant"}
                </button>
              </div>
              {verResult && verResult.status === "loading" && (
                <div className="verification-result loading">🔍 Scanning green pixels...</div>
              )}
              {verResult && verResult.status !== "loading" && (
                <div className={`verification-result ${verResult.status}`}>
                  {verResult.status === "approved" ? (
                    <>
                      <div>✅ Plant Confirmed! {verResult.isSapling ? "🌱 Sapling detected!" : "🌿 Plant detected!"}</div>
                      <div style={{ fontSize: "0.85rem", marginTop: "0.4rem", opacity: 0.85 }}>Confidence: {(verResult.confidence * 100).toFixed(0)}% | +{verResult.pointsDelta} pts</div>
                      <div style={{ fontSize: "0.8rem", marginTop: "0.3rem", fontStyle: "italic" }}>💬 {verResult.reason}</div>
                    </>
                  ) : (
                    <>
                      <div>❌ Not a valid plant image.</div>
                      <div style={{ fontSize: "0.85rem", marginTop: "0.4rem", opacity: 0.85 }}>Confidence: {(verResult.confidence * 100).toFixed(0)}% | {verResult.pointsDelta} pts</div>
                      <div style={{ fontSize: "0.8rem", marginTop: "0.3rem", fontStyle: "italic" }}>💬 {verResult.reason}</div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <label className="upload-zone">
              <input type="file" accept="image/*" onChange={handleFile} />
              <div className="upload-zone-icon">🌱</div>
              <h3>Drop your tree photo here</h3>
              <p>or click to browse — JPG, PNG, WebP</p>
            </label>
          )}
          <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--sky)", borderRadius: "8px", fontSize: "0.85rem", color: "#555" }}>
            <strong>How it works:</strong> Upload a clear photo of a planted sapling. The app scans green pixels to verify (+10 pts) or reject (-5 pts) non-plant images.
          </div>
        </div>
      </div>

      {  }
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ marginBottom: "1.25rem", color: "var(--forest)" }}>📋 Submission History</h3>
        {user.submissions && user.submissions.length > 0 ? (
          <div className="submission-list">
            {user.submissions.map(s => (
              <div key={s.id} className="submission-item">
                <span className={`sub-status ${s.status}`}>{s.status}</span>
                <span style={{ flex: 1, fontSize: "0.8rem", color: "#666" }}>{s.reason || `Confidence: ${(s.confidence * 100).toFixed(0)}%`}</span>
                <span style={{ color: s.pointsDelta > 0 ? "var(--leaf)" : "#dc3545", fontWeight: 600 }}>{s.pointsDelta > 0 ? "+" : ""}{s.pointsDelta} pts</span>
                <span style={{ color: "#aaa", fontSize: "0.8rem" }}>{s.date}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ textAlign: "center", color: "#888", padding: "2rem" }}>No submissions yet. Upload your first tree photo! 🌱</p>
        )}
      </div>
    </div>
  );
}

function LeaderboardPage({ users, currentUser }) {
  const [tab, setTab] = useState("all");

  const displayUsers = tab === "weekly"
    ? [...users].sort((a, b) =>
        (b.submissions?.filter(s => { const d = new Date(s.date); return (new Date() - d) < 7*24*60*60*1000 && s.status === "approved"; }).length || 0) -
        (a.submissions?.filter(s => { const d = new Date(s.date); return (new Date() - d) < 7*24*60*60*1000 && s.status === "approved"; }).length || 0))
    : users;

  return (
    <>
      <div className="page-hero">
        <h1>🏆 Global Leaderboard</h1>
        <p>See how you rank among all environmental champions</p>
      </div>
      <div className="ad-banner"><span>📢 Sponsor Slot</span> — Reach eco-conscious audiences. Perfect for sustainable brands.</div>
      <div className="leaderboard-page">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div className="tabs">
            <button className={`tab-btn ${tab === "all"    ? "active" : ""}`} onClick={() => setTab("all")}>🌍 All Time</button>
            <button className={`tab-btn ${tab === "weekly" ? "active" : ""}`} onClick={() => setTab("weekly")}>📅 This Week</button>
          </div>
          <div style={{ fontSize: "0.8rem", color: "#888", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#4a9960", display: "inline-block", animation: "pulse 1.5s infinite" }}></span>
            Live — updates in real-time from Firebase
          </div>
        </div>
        <div className="card">
          <div style={{ maxHeight: "600px", overflowY: "auto" }}>
            <table className="leaderboard-table">
              <thead><tr><th>Rank</th><th>Username</th><th>Points</th><th>Trees</th><th>Badge</th></tr></thead>
              <tbody>
                {displayUsers.map((u, i) => (
                  <tr key={u.username} className={`lb-row ${u.username === currentUser ? "me" : ""}`}>
                    <td><RankBadge rank={i + 1} /></td>
                    <td className="lb-username">
                      {u.username}
                      {u.username === currentUser && <span className="lb-you-tag">YOU</span>}
                    </td>
                    <td className="lb-points">🪙 {u.points}</td>
                    <td>🌱 {u.treesPlanted}</td>
                    <td><span className="lb-badge-icon">{u.badge.icon}</span> {u.badge.label}</td>
                  </tr>
                ))}
                {displayUsers.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "#888", padding: "2rem" }}>No users yet — be the first! 🌱</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}


function EducationPage() {
  return (
    <>
      <div className="page-hero"><h1>📚 Environmental Education</h1><p>Learn why trees and sustainability matter for our planet</p></div>
      <div className="edu-page">
        <div className="edu-hero">
          <h1>🌍 Why Trees Matter</h1>
          <p style={{ opacity: 0.8, maxWidth: "600px", margin: "0 auto", lineHeight: 1.7 }}>Trees are Earth's natural air purifiers, carbon sinks, and biodiversity hubs. A single mature tree can absorb 48 pounds of CO₂ per year and release enough oxygen for two people.</p>
        </div>
        <div className="ad-banner"><span>📢 Educational Partner Ad</span> — Support sustainable brands that make a difference</div>
        <div className="edu-grid">
          {[
            { icon: "🌬️", title: "Air Purification",   tips: ["Trees filter particulate matter from air", "One tree produces ~100kg of oxygen/year", "Forests remove 2.6 billion tonnes of CO₂ annually", "Urban trees reduce air pollution by 25%"] },
            { icon: "💧", title: "Water Cycle",         tips: ["Trees regulate local rainfall patterns", "Forest roots prevent soil erosion", "Trees reduce flood risk by 11–65%", "A tree transpires 200–450 liters of water daily"] },
            { icon: "🦋", title: "Biodiversity",        tips: ["A single oak supports 500+ species", "Forests cover 31% of Earth's land area", "80% of terrestrial species live in forests", "Trees create habitats for pollinators"] },
            { icon: "🌡️", title: "Climate Regulation", tips: ["Trees cool cities by up to 8°C (urban heat island)", "Forests store 45% of terrestrial carbon", "Reforestation could offset 10 years of CO₂ emissions", "Trees block wind and reduce heating costs by 30%"] },
            { icon: "❤️", title: "Human Health",        tips: ["Green spaces reduce stress by 20%", "Living near trees lowers blood pressure", "Forest bathing boosts immune function", "Trees reduce noise pollution by 6–8 dB"] },
            { icon: "💰", title: "Economic Value",      tips: ["Trees increase property value by 10–15%", "Shade trees cut AC costs by 30%", "Forests support 1.6 billion livelihoods globally", "Ecosystem services worth $125 trillion/year"] },
          ].map(c => (
            <div className="edu-card" key={c.title}>
              <h3><span>{c.icon}</span> {c.title}</h3>
              <ul>{c.tips.map(t => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
        <div className="card" style={{ background: "var(--sky)" }}>
          <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.5rem", marginBottom: "1.25rem", color: "var(--forest)" }}>♻️ Daily Sustainability Tips</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            {["🚲 Bike or walk short distances","🛍️ Bring reusable bags shopping","💡 Switch to LED bulbs","🚿 Take shorter showers","🥗 Eat more plant-based meals","📱 Repair before replacing","🌧️ Collect rainwater for plants","🏠 Compost kitchen waste"].map(tip => (
              <div key={tip} style={{ padding: "0.875rem", background: "white", borderRadius: "10px", fontSize: "0.9rem", fontWeight: 500, border: "1px solid rgba(74,153,96,0.15)" }}>{tip}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function MarketplacePage({ db, persist, currentUser, showNotify }) {
  const [products, setProducts] = useState(db.products || SAMPLE_PRODUCTS);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({ title: "", description: "", price: "", image: "🌿" });
  const ICONS = ["🌿","🌱","🌳","🎋","♻️","☀️","💧","🌻","🪴","🌾"];

  const addProduct = (e) => {
    e.preventDefault();
    if (!currentUser) return showNotify("Please login to list a product.");
    const newProduct = { id: Date.now(), ...form, price: parseFloat(form.price), seller: currentUser };
    const updated = [...products, newProduct];
    setProducts(updated);
    persist({ ...db, products: updated });
    setForm({ title: "", description: "", price: "", image: "🌿" });
    setShowForm(false);
    showNotify("Product listed! 🌿");
  };

  return (
    <>
      <div className="page-hero"><h1>🛒 Eco Marketplace</h1><p>Discover and list sustainable, eco-friendly products</p></div>
      <div className="market-page">
        <div className="affiliate-banner">
          <h3>🤝 Affiliate Partners</h3>
          <p>Earn commission by promoting eco-friendly products through our affiliate program</p>
          <button className="btn btn-secondary" style={{ color: "white", borderColor: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.1)" }}>Join Affiliate Program →</button>
        </div>
        <div className="ad-banner"><span>📢 Marketplace Ad Space</span> — Promote your sustainable products to our green community</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.75rem", color: "var(--forest)" }}>🌿 Eco Products</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>{showForm ? "✕ Cancel" : "+ List Product"}</button>
        </div>
        {showForm && (
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ marginBottom: "1rem" }}>List an Eco-Friendly Product</h3>
            <form onSubmit={addProduct}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="form-group"><label className="form-label">Product Title</label><input className="form-input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required placeholder="Bamboo Toothbrush" /></div>
                <div className="form-group"><label className="form-label">Price (₹)</label><input className="form-input" type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} required placeholder="499" /></div>
              </div>
              <div className="form-group"><label className="form-label">Description</label><input className="form-input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} required placeholder="Describe your eco-friendly product..." /></div>
              <div className="form-group">
                <label className="form-label">Icon</label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {ICONS.map(icon => <button key={icon} type="button" onClick={() => setForm({...form, image: icon})} style={{ width: "40px", height: "40px", border: `2px solid ${form.image === icon ? "var(--leaf)" : "#e5e7eb"}`, borderRadius: "8px", cursor: "pointer", background: form.image === icon ? "var(--sky)" : "white", fontSize: "1.25rem" }}>{icon}</button>)}
                </div>
              </div>
              <button className="btn btn-primary">List Product 🌿</button>
            </form>
          </div>
        )}
        <div className="product-grid">
          {products.map(p => (
            <div key={p.id} className="product-card">
              <div className="product-image">{p.image}</div>
              <div className="product-body">
                <div className="product-title">{p.title}</div>
                <div className="product-desc">{p.description}</div>
                <div className="product-footer">
                  <span className="product-price">₹{parseFloat(p.price).toLocaleString("en-IN")}</span>
                  <span className="product-seller">by {p.seller}</span>
                </div>
                <button className="btn btn-primary btn-sm" style={{ width: "100%", justifyContent: "center", marginTop: "0.75rem" }}>View Product →</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "2rem", padding: "1.5rem", background: "white", borderRadius: "14px", border: "1px solid rgba(74,153,96,0.15)", textAlign: "center" }}>
          <p style={{ color: "#888", fontSize: "0.875rem" }}>💡 <strong>Commission Placeholder:</strong> Sellers earn 5% on each sale. Affiliates earn 3% on referred purchases. Full payment integration coming soon.</p>
        </div>
      </div>
    </>
  );
}

function RankBadge({ rank }) {
  const cls = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other";
  return <span className={`rank-badge ${cls}`}>{rank}</span>;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<GreenRank />);
