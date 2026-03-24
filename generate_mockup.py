"""Generate a mockup image of the DS Enhancer extension panel."""
from PIL import Image, ImageDraw, ImageFont

W, H = 900, 820
BG = (26, 26, 46)
PANEL_BG = (15, 15, 26)
HEADER_BG = (22, 22, 42)
BORDER = (42, 42, 74)
WHITE = (255, 255, 255)
GRAY = (136, 136, 136)
LIGHT = (221, 221, 221)
GREEN = (76, 175, 80)
LIGHT_GREEN = (139, 195, 74)
AMBER = (255, 193, 7)
ORANGE = (255, 152, 0)
RED = (255, 87, 34)
BAR_BG = (30, 30, 58)
TAB_ACTIVE = GREEN
ROW_HOVER = (22, 22, 42)

img = Image.new('RGB', (W, H), BG)
draw = ImageDraw.Draw(img)

try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 10)
    font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    font_xl = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    font_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    font_xs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 9)
except:
    font = ImageFont.load_default()
    font_sm = font_lg = font_xl = font_bold = font_xs = font

# --- Fake page behind panel (left side) ---
draw.text((30, 30), "Dreaming Spanish", fill=WHITE, font=font_lg)
draw.text((30, 55), "Your daily immersion videos", fill=GRAY, font=font_sm)

for i, (title, meta) in enumerate([
    ("Un dia en la playa - Beginner", "Maria · 8:32 · Mexico"),
    ("Historia de España - Intermediate", "Pablo · 12:05 · Spain"),
    ("Comida Argentina - Beginner", "Sofia · 6:15 · Argentina"),
    ("Viaje a Colombia - Advanced", "Carlos · 15:40 · Colombia"),
]):
    y = 90 + i * 75
    draw.rounded_rectangle([30, y, 430, y + 65], radius=8, fill=HEADER_BG)
    draw.rounded_rectangle([40, y + 8, 160, y + 57], radius=6, fill=(42, 42, 74))
    draw.text((56, y + 25), "Video Thumb", fill=(85, 85, 85), font=font_xs)
    draw.text((170, y + 15), title, fill=LIGHT, font=font_bold)
    draw.text((170, y + 35), meta, fill=GRAY, font=font_sm)

# --- Floating toggle button ---
cx, cy = 425, 740
draw.ellipse([cx-24, cy-24, cx+24, cy+24], fill=(26, 26, 46), outline=(60, 60, 100))
# Mini bar chart icon
draw.rectangle([cx-10, cy-2, cx-6, cy+10], fill=(255,255,255,128))
draw.rectangle([cx-2, cy-8, cx+2, cy+10], fill=(200,200,200))
draw.rectangle([cx+6, cy-14, cx+10, cy+10], fill=WHITE)

# --- Panel (right side) ---
PX = 470  # panel left x
PW = W - PX  # panel width = 430

draw.rectangle([PX, 0, W, H], fill=PANEL_BG)
# Shadow line
draw.rectangle([PX-2, 0, PX, H], fill=(8, 8, 15))

# Header
draw.rectangle([PX, 0, W, 52], fill=HEADER_BG)
draw.line([PX, 52, W, 52], fill=BORDER)
draw.text((PX + 20, 16), "Progress Tracker", fill=WHITE, font=font_lg)
# Action buttons
draw.rounded_rectangle([W-75, 12, W-47, 40], radius=5, outline=BORDER, fill=None)
draw.text((W-67, 17), "↻", fill=GRAY, font=font)
draw.rounded_rectangle([W-40, 12, W-12, 40], radius=5, outline=BORDER, fill=None)
draw.text((W-32, 17), "✕", fill=GRAY, font=font)

# Overall stats
y = 62
stats = [("127.3h", "WATCHED"), ("842.6h", "TOTAL"), ("15%", "COMPLETE"), ("1,247", "VIDEOS")]
stat_w = PW // 4
for i, (val, label) in enumerate(stats):
    sx = PX + i * stat_w
    vw = draw.textlength(val, font=font_xl)
    lw = draw.textlength(label, font=font_xs)
    draw.text((sx + (stat_w - vw) // 2, y + 8), val, fill=WHITE, font=font_xl)
    draw.text((sx + (stat_w - lw) // 2, y + 35), label, fill=GRAY, font=font_xs)

# Overall progress bar
y = 115
draw.rounded_rectangle([PX + 20, y, W - 20, y + 6], radius=3, fill=BAR_BG)
bar_end = PX + 20 + int((W - PX - 40) * 0.15)
draw.rounded_rectangle([PX + 20, y, bar_end, y + 6], radius=3, fill=GREEN)

# Tabs
y = 132
tabs = [("Country", True), ("Guide", False), ("Topic", False), ("Level", False), ("Type", False)]
tx = PX + 20
for tab_name, active in tabs:
    tw = draw.textlength(tab_name, font=font_sm)
    color = TAB_ACTIVE if active else GRAY
    draw.text((tx, y + 6), tab_name, fill=color, font=font_sm)
    if active:
        draw.rectangle([tx, y + 22, tx + tw, y + 24], fill=TAB_ACTIVE)
    tx += int(tw) + 28

draw.line([PX, y + 26, W, y + 26], fill=BORDER)

# Sort controls
y = 164
draw.text((PX + 20, y), "SORT BY:", fill=GRAY, font=font_xs)
draw.rounded_rectangle([PX + 72, y - 3, PX + 230, y + 15], radius=3, fill=(26, 26, 48), outline=BORDER)
draw.text((PX + 78, y), "% Complete (High→Low)", fill=(200, 200, 200), font=font_xs)
draw.rounded_rectangle([PX + 240, y - 3, W - 20, y + 15], radius=3, fill=(26, 26, 48), outline=BORDER)
draw.text((PX + 248, y), "Filter...", fill=(85, 85, 85), font=font_xs)
draw.line([PX, y + 22, W, y + 22], fill=(30, 30, 58))

# Country rows
y = 192
rows = [
    ("Spain", "42.1h / 185.3h", "380/920", 23, ORANGE),
    ("Mexico", "35.8h / 210.5h", "310/1050", 17, RED),
    ("Argentina", "18.4h / 120.8h", "175/610", 15, RED),
    ("Colombia", "12.6h / 98.4h", "120/490", 13, RED),
    ("Peru", "8.2h / 72.1h", "85/360", 11, RED),
    ("Chile", "5.1h / 54.6h", "52/270", 9, RED),
    ("Venezuela", "3.4h / 42.3h", "30/210", 8, RED),
    ("Cuba", "1.7h / 18.6h", "15/95", 9, RED),
]

for i, (name, hours, videos, pct, color) in enumerate(rows):
    ry = y + i * 58
    if ry + 58 > H:
        break

    # Row background on hover for first row
    if i == 0:
        draw.rectangle([PX, ry, W, ry + 56], fill=ROW_HOVER)

    # Separator
    draw.line([PX, ry + 56, W, ry + 56], fill=(26, 26, 46))

    # Label and stats
    draw.text((PX + 20, ry + 6), name, fill=LIGHT, font=font_bold)
    stats_text = f"{hours}  ({videos} videos)"
    sw = draw.textlength(stats_text, font=font_xs)
    draw.text((W - 20 - sw, ry + 8), stats_text, fill=GRAY, font=font_xs)

    # Bar
    bar_y = ry + 28
    bar_h = 18
    draw.rounded_rectangle([PX + 20, bar_y, W - 20, bar_y + bar_h], radius=4, fill=BAR_BG)
    bar_fill_w = int((W - PX - 40) * pct / 100)
    if bar_fill_w > 4:
        draw.rounded_rectangle([PX + 20, bar_y, PX + 20 + bar_fill_w, bar_y + bar_h], radius=4, fill=color)

    # Percentage text
    pct_text = f"{pct}%"
    pw = draw.textlength(pct_text, font=font_xs)
    draw.text((W - 26 - pw, bar_y + 4), pct_text, fill=WHITE, font=font_xs)

# --- Popup mockup (floating, top-left area) ---
popup_x, popup_y = 30, 420
popup_w, popup_h = 280, 300
draw.rounded_rectangle([popup_x, popup_y, popup_x + popup_w, popup_y + popup_h],
                        radius=10, fill=PANEL_BG, outline=BORDER)

# Popup header
draw.rounded_rectangle([popup_x, popup_y, popup_x + popup_w, popup_y + 44],
                        radius=10, fill=HEADER_BG)
draw.rectangle([popup_x, popup_y + 34, popup_x + popup_w, popup_y + 44], fill=HEADER_BG)
draw.line([popup_x, popup_y + 44, popup_x + popup_w, popup_y + 44], fill=BORDER)
draw.text((popup_x + 16, popup_y + 14), "DS Enhancer", fill=WHITE, font=font_lg)
draw.text((popup_x + popup_w - 52, popup_y + 18), "v0.1.0", fill=(85, 85, 85), font=font_xs)

# Popup stats
py = popup_y + 60
draw.text((popup_x + 16, py - 8), "Last updated 2m ago", fill=GRAY, font=font_xs)
py += 14

# 2x2 grid
cell_w = (popup_w - 3) // 2
cell_h = 56
for r in range(2):
    for c in range(2):
        cx = popup_x + 1 + c * (cell_w + 1)
        cy = py + r * (cell_h + 1)
        draw.rectangle([cx, cy, cx + cell_w, cy + cell_h], fill=HEADER_BG)

popup_stats = [("127.3h", "WATCHED"), ("842.6h", "AVAILABLE"), ("1,247", "VIDEOS SEEN"), ("5", "CATEGORIES")]
for idx, (val, label) in enumerate(popup_stats):
    r, c = divmod(idx, 2)
    cx = popup_x + 1 + c * (cell_w + 1)
    cy = py + r * (cell_h + 1)
    vw = draw.textlength(val, font=font_xl)
    lw = draw.textlength(label, font=font_xs)
    draw.text((cx + (cell_w - vw) // 2, cy + 10), val, fill=WHITE, font=font_xl)
    draw.text((cx + (cell_w - lw) // 2, cy + 36), label, fill=GRAY, font=font_xs)

# Popup progress bar
pby = py + 2 * (cell_h + 1) + 8
draw.rounded_rectangle([popup_x + 16, pby, popup_x + popup_w - 16, pby + 8], radius=4, fill=BAR_BG)
pfill = int((popup_w - 32) * 0.15)
draw.rounded_rectangle([popup_x + 16, pby, popup_x + 16 + pfill, pby + 8], radius=4, fill=GREEN)

# Popup buttons
btn_y = pby + 20
btn_mid = popup_x + popup_w // 2
draw.rounded_rectangle([popup_x + 16, btn_y, btn_mid - 4, btn_y + 30], radius=6,
                        fill=(27, 94, 32), outline=(46, 125, 50))
draw.text((popup_x + 24, btn_y + 8), "Open Full Panel", fill=WHITE, font=font_sm)
draw.rounded_rectangle([btn_mid + 4, btn_y, popup_x + popup_w - 16, btn_y + 30], radius=6,
                        fill=(26, 26, 48), outline=BORDER)
draw.text((btn_mid + 24, btn_y + 8), "Refresh", fill=(200, 200, 200), font=font_sm)

# Popup footer
draw.text((popup_x + 20, popup_y + popup_h - 20),
          "Open a Dreaming Spanish tab to see progress", fill=(85, 85, 85), font=font_xs)

# Labels
draw.text((popup_x, popup_y - 18), "Extension Popup", fill=(100, 100, 150), font=font_sm)
draw.text((PX + 10, H - 18), "Slide-out Progress Panel →", fill=(100, 100, 150), font=font_sm)

out_path = '/home/user/dreaming-spanish-enhancer/mockup.png'
img.save(out_path, 'PNG')
print(f'Mockup saved to {out_path}')
