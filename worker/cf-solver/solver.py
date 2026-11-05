"""TARGET Turnstile solver: a tiny HTTP service around Camoufox (Firefox anti-detect build, MPL-2.0).

  GET /health                                   -> {"ok": true}
  GET /turnstile?url=&sitekey=[&action=&cdata=]  -> {"token": "..."}   (header x-auth-token: $CF_SOLVER_TOKEN)
  GET /clearance?url=                           -> {"cookies": [...], "userAgent": "..."} for "Just a moment" pages

/turnstile never contacts the target site: requests to the target's host are answered locally with a bare page that
holds only the widget, so the token comes from challenges.cloudflare.com for that hostname. A target that blocks the
solver's IP (TimeBucks blocks AWS) is no obstacle there. The token is injected into the real page by the TARGET worker.
One browser at a time (512 MB hosts); each request launches a fresh one so no state leaks between jobs.
"""
import hmac, json, os, random, re, threading, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from camoufox.sync_api import Camoufox

TOKEN = os.environ.get("CF_SOLVER_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))
HEADLESS = os.environ.get("SOLVER_HEADLESS", "virtual")  # "virtual" = Xvfb (scores better than true headless)
LOCK = threading.Lock()
SITEKEY = re.compile(r"^[0-9]x[0-9A-Za-z_-]{10,60}$")
SAFE = re.compile(r"^[\w.:-]{0,64}$")


def _proxy():
    raw = os.environ.get("SOLVER_PROXY", "")
    if not raw:
        return None
    u = urllib.parse.urlparse(raw)
    return {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": urllib.parse.unquote(u.username or ""), "password": urllib.parse.unquote(u.password or "")}


def _browser():
    return Camoufox(headless=(HEADLESS if HEADLESS == "virtual" else HEADLESS == "true"), humanize=True, os="windows",
                    i_know_what_im_doing=True, proxy=_proxy(), block_images=False)


def _click_widget(page):
    f = next((f for f in page.frames if "challenges.cloudflare.com" in f.url), None)
    if not f:
        return False
    b = f.frame_element().bounding_box()
    if not b or b["width"] < 20:
        return False
    x = b["x"] + min(30, b["width"] / 6) + random.random() * 4
    y = b["y"] + b["height"] / 2 + random.random() * 4 - 2
    page.mouse.move(x - 60 - random.random() * 40, y - 30, steps=10)
    time.sleep(0.2 + random.random() * 0.3)
    page.mouse.move(x, y, steps=14)
    page.mouse.down(); time.sleep(0.07 + random.random() * 0.06); page.mouse.up()
    return True


def solve_turnstile(url, sitekey, action=None, cdata=None, timeout=45):
    attrs = f'data-sitekey="{sitekey}" data-callback="__tgDone"'
    if action: attrs += f' data-action="{action}"'
    if cdata: attrs += f' data-cdata="{cdata}"'
    html = ("<!doctype html><html><head><title>Verify</title>"
            '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head>'
            f'<body style="margin:40px"><div class="cf-turnstile" {attrs}></div><input id="__tg" type="hidden">'
            "<script>function __tgDone(t){document.getElementById('__tg').value=t}</script></body></html>")
    host = urllib.parse.urlparse(url).netloc
    with _browser() as br:
        page = br.new_page()
        page.route(lambda u: urllib.parse.urlparse(u).netloc == host,
                   lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8", body=html))
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        end = time.time() + timeout; clicks = 0; last = 0.0
        while time.time() < end:
            time.sleep(1.0)
            tok = page.eval_on_selector("#__tg", "e => e.value") or ""
            if len(tok) > 20:
                return tok
            if clicks < 3 and time.time() - last > 7:
                if _click_widget(page):
                    clicks += 1; last = time.time()
    return None


def solve_clearance(url, timeout=45):
    with _browser() as br:
        page = br.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        end = time.time() + timeout; last = 0.0
        while time.time() < end:
            time.sleep(1.5)
            cookies = page.context.cookies()
            if any(c["name"] == "cf_clearance" for c in cookies):
                ua = page.evaluate("navigator.userAgent")
                return {"cookies": cookies, "userAgent": ua}
            if time.time() - last > 7:
                _click_widget(page); last = time.time()
    return None


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def log_message(self, fmt, *args):  # no query strings (urls) in logs
        print(time.strftime("%H:%M:%S"), self.command, self.path.split("?")[0], args[1] if len(args) > 1 else "", flush=True)

    def do_GET(self):
        p = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(p.query))
        if p.path in ("/", "/health"):
            return self._send(200, {"ok": True, "busy": LOCK.locked()})
        if not TOKEN or not hmac.compare_digest(self.headers.get("x-auth-token", ""), TOKEN):
            return self._send(401, {"error": "unauthorized"})
        url = q.get("url", "")
        if not re.match(r"^https://[^/\s]+", url):
            return self._send(400, {"error": "url must be https"})
        if not LOCK.acquire(timeout=90):
            return self._send(503, {"error": "busy"})
        t0 = time.time()
        try:
            if p.path == "/turnstile":
                sk = q.get("sitekey", "")
                if not SITEKEY.match(sk) or not SAFE.match(q.get("action", "")) or not SAFE.match(q.get("cdata", "")):
                    return self._send(400, {"error": "bad sitekey/action/cdata"})
                tok = solve_turnstile(url, sk, q.get("action") or None, q.get("cdata") or None)
                return self._send(200 if tok else 422, {"token": tok, "ms": int((time.time() - t0) * 1000)} if tok else {"error": "no token", "ms": int((time.time() - t0) * 1000)})
            if p.path == "/clearance":
                res = solve_clearance(url)
                return self._send(200 if res else 422, res or {"error": "no cf_clearance"})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": type(e).__name__})
        finally:
            LOCK.release()


if __name__ == "__main__":
    if not TOKEN:
        print("CF_SOLVER_TOKEN is not set: every solve request will be refused", flush=True)
    print(f"TARGET cf-solver on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
