import sys, time
from playwright.sync_api import sync_playwright
URL="http://localhost:3124"; res=[]; errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-sandbox"])
    for label, vp in [("desktop",{"width":1440,"height":900}),("mobile",{"width":390,"height":844})]:
        pg=b.new_page(viewport=vp)
        pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_load_state("networkidle")
        res.append((f"{label}: 5 feature cards", pg.locator("[data-testid=feature-card]").count()==5))
        res.append((f"{label}: footer has 4 columns", pg.locator("footer h4").count()==4))
        res.append((f"{label}: copyright", "TARGET ©" in pg.locator("[data-testid=copyright]").inner_text()))
        pg.click("[data-testid=cta-signup]"); time.sleep(1)
        res.append((f"{label}: CTA scrolls to signup", pg.locator("#signup").is_visible() and pg.evaluate("document.querySelector('#signup').getBoundingClientRect().top") < vp["height"]))
        res.append((f"{label}: no overflow", pg.evaluate("document.documentElement.scrollWidth")<=vp["width"]))
        if label=="desktop":
            pg.goto(URL); pg.wait_for_load_state("networkidle")
            pg.click("text=Features"); time.sleep(1)
            res.append(("desktop: nav Features link scrolls", pg.evaluate("document.querySelector('#features').getBoundingClientRect().top") < 200))
        pg.goto(URL); pg.wait_for_load_state("networkidle"); time.sleep(0.8)
        pg.screenshot(path=f"tests/shot2_{label}.png", full_page=True)
    b.close()
for n,ok in res: print(("PASS " if ok else "FAIL ")+n)
print("console errors:", errs or "none")
sys.exit(0 if all(o for _,o in res) and not errs else 1)
