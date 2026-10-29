import sys, time
from playwright.sync_api import sync_playwright
URL = "http://localhost:3124"
results, errors = [], []
def check(name, cond):
    results.append((name, bool(cond)))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for label, vp in [("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})]:
        pg = b.new_page(viewport=vp)
        pg.on("console", lambda m: errors.append(f"{label}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(f"{label}: {e}"))
        pg.goto(URL); pg.wait_for_load_state("networkidle")
        check(f"{label}: title is TARGET", pg.title() == "TARGET")
        check(f"{label}: h1 visible", pg.locator("h1").is_visible())
        check(f"{label}: signup card visible", pg.locator("#signup").is_visible())
        t1 = pg.locator("[data-testid=rotating-prompt]").inner_text()
        time.sleep(3.6)
        t2 = pg.locator("[data-testid=rotating-prompt]").inner_text()
        check(f"{label}: prompts rotate", t1 != t2)
        pg.fill("[data-testid=email-input]", "bad-email"); pg.click("[data-testid=email-submit]")
        check(f"{label}: invalid email shows error", pg.locator("[data-testid=email-error]").is_visible())
        pg.fill("[data-testid=email-input]", "vikash@example.com"); pg.click("[data-testid=email-submit]")
        check(f"{label}: valid email shows success", pg.locator("[data-testid=email-ok]").is_visible())
        sw = pg.evaluate("document.documentElement.scrollWidth"); 
        check(f"{label}: no horizontal overflow", sw <= vp["width"])
        pg.fill("[data-testid=email-input]", ""); 
        pg.goto(URL); pg.wait_for_load_state("networkidle"); time.sleep(0.8)
        pg.screenshot(path=f"tests/shot_{label}.png", full_page=True)
    b.close()
for n, ok in results: print(("PASS " if ok else "FAIL ") + n)
print("console errors:", errors or "none")
sys.exit(0 if all(ok for _, ok in results) and not errors else 1)
