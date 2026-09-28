/**
 * Server-rendered 60db sign-in pages for the MCP OAuth flow (no framework, no
 * external assets besides the logo and optional Google Identity Services).
 * All dynamic values are HTML-escaped.
 */

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLES = `
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:rgb(246 242 236);color:rgb(28 26 24);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:16px}
.card{width:100%;max-width:400px;background:rgb(252 250 247);border:1px solid rgb(28 26 24/.1);border-radius:6px;padding:32px}
.logo{height:34px;display:block;margin-bottom:24px}h1{font-size:22px;margin:0 0 6px;font-weight:600}
.sub{color:rgb(28 26 24/.62);margin:0 0 22px;font-size:14px}.sub b{color:rgb(28 26 24)}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:11px 12px;border:1px solid rgb(28 26 24/.18);border-radius:4px;font:inherit;background:#fff}
input:focus{outline:2px solid rgb(184 69 31/.35);border-color:rgb(184 69 31)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:4px;background:rgb(184 69 31);color:#fff;
font:600 14px/1 inherit;letter-spacing:.02em;cursor:pointer}button:hover{background:rgb(154 56 24)}
.err{background:rgb(184 69 31/.08);border:1px solid rgb(184 69 31/.3);color:rgb(154 56 24);padding:10px 12px;border-radius:4px;font-size:13px;margin-bottom:6px}
.or{display:flex;align-items:center;gap:10px;color:rgb(28 26 24/.45);font-size:12px;margin:20px 0 4px}
.or:before,.or:after{content:"";flex:1;height:1px;background:rgb(28 26 24/.12)}
.foot{margin-top:22px;font-size:12px;color:rgb(28 26 24/.55)}.foot a{color:rgb(184 69 31)}
#g{display:flex;justify-content:center;margin-top:12px}`;

function layout(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · 60db</title><style>${STYLES}</style>${head}</head>
<body><main class="card"><img class="logo" src="https://60db.ai/60db-logo.png" alt="60db">${body}</main></body></html>`;
}

function errorBox(error?: string): string {
  return error ? `<div class="err" role="alert">${esc(error)}</div>` : "";
}

export interface LoginPageOptions {
  authRequest: string;
  clientName: string;
  redirectHost: string;
  googleClientId?: string;
  email?: string;
  error?: string;
}

export function renderLoginPage(o: LoginPageOptions): string {
  const google = o.googleClientId
    ? `<div class="or">or</div>
<form id="gform" method="post" action="/oauth/login">
<input type="hidden" name="request" value="${esc(o.authRequest)}"><input type="hidden" name="step" value="google">
<input type="hidden" name="credential" id="gcred"></form><div id="g"></div>
<script>function onGoogle(r){document.getElementById("gcred").value=r.credential;document.getElementById("gform").submit()}
window.onload=function(){google.accounts.id.initialize({client_id:${JSON.stringify(o.googleClientId)},callback:onGoogle});
google.accounts.id.renderButton(document.getElementById("g"),{theme:"outline",size:"large",width:336,text:"continue_with"})}</script>`
    : "";
  const head = o.googleClientId ? `<script src="https://accounts.google.com/gsi/client" async defer></script>` : "";
  return layout(
    "Sign in",
    `<h1>Sign in to 60db</h1>
<p class="sub"><b>${esc(o.clientName)}</b> wants to use your 60db account (voices, speech, music, memory) and will return you to <b>${esc(o.redirectHost)}</b>.</p>
${errorBox(o.error)}
<form method="post" action="/oauth/login">
<input type="hidden" name="request" value="${esc(o.authRequest)}"><input type="hidden" name="step" value="password">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(o.email || "")}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in &amp; allow access</button></form>
${google}
<p class="foot">Access uses a workspace API key named after this app. Revoke it any time in the 60db dashboard under API keys.
No account? <a href="https://app.60db.ai" target="_blank" rel="noopener">Create one</a>.</p>`,
    head
  );
}

export function renderTwoFactorPage(o: { authRequest: string; tfaToken: string; error?: string }): string {
  return layout(
    "Two-factor verification",
    `<h1>Two-factor verification</h1>
<p class="sub">Enter the 6-digit code from your authenticator app.</p>
${errorBox(o.error)}
<form method="post" action="/oauth/login">
<input type="hidden" name="request" value="${esc(o.authRequest)}"><input type="hidden" name="step" value="2fa">
<input type="hidden" name="tfa" value="${esc(o.tfaToken)}">
<label for="code">Verification code</label>
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,8}" maxlength="8" required autofocus>
<button type="submit">Verify &amp; allow access</button></form>`
  );
}

export function renderErrorPage(message: string): string {
  return layout(
    "Connection error",
    `<h1>Couldn't connect</h1>${errorBox(message)}
<p class="foot">Close this window and click <b>Connect</b> again in your AI assistant.</p>`
  );
}
