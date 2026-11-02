# td — Syphon in from an external app (replace "TouchDesigner" with your server name;
# texs() / outputs() list what's live).

with block("td", loop="loop"):
    tex("td", "in", adapter="syphon:TouchDesigner", w=1280, h=720)
