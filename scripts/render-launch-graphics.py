#!/usr/bin/env python3
"""Render Steeped launch graphics from real browser captures.

This script deliberately does not draw fake web pages or fake extension panels.
It composites real `npm run screenshots:store` captures with a small,
consistent brand rail, then renders the Chrome Web Store screenshots, social
card, and promo tile.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:
    raise SystemExit(
        "Missing Pillow. Install it with `python3 -m pip install Pillow`, "
        "then rerun `npm run graphics:launch`."
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design" / "source-captures" / "store"
OUT = ROOT / "design" / "store-screenshots"
SOCIAL = ROOT / "design" / "social"
DOCS = ROOT / "docs"
ICON = ROOT / "docs" / "icons" / "icon1024.png"

FONT_REGULAR = Path("/System/Library/Fonts/SFNS.ttf")
FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
FONT_MONO = Path("/System/Library/Fonts/SFNSMono.ttf")

PAPER = (247, 241, 229)
PAPER_2 = (255, 249, 239)
INK = (19, 23, 29)
MUTED = (83, 91, 94)
SOFT = (135, 139, 135)
LINE = (217, 207, 189)
NAVY = (7, 16, 28)
NAVY_2 = (11, 23, 48)
CREAM = (244, 234, 219)
TAN = (213, 180, 135)
TEAL = (15, 118, 110)
TEAL_DARK = (86, 199, 193)


@dataclass(frozen=True)
class StoreShot:
    source: str
    output: str
    number: str
    title: str
    body: str
    tag: str
    source_label: str


STORE_SHOTS = [
    StoreShot(
        source="01-big-reads-small-notes-live.png",
        output="01-big-reads-small-notes.png",
        number="01",
        title="Big reads,\nsmall notes.",
        body="Open a page. Click Steeped. Read what matters first.",
        tag="Ready state",
        source_label="joshwcomeau.com",
    ),
    StoreShot(
        source="02-sources-attached-live.png",
        output="02-sources-attached.png",
        number="02",
        title="Sources stay\nattached.",
        body="Citation chips keep the trail back to the page visible.",
        tag="Citation view",
        source_label="developer.chrome.com",
    ),
    StoreShot(
        source="03-ask-about-same-page-live.png",
        output="03-ask-about-same-page.png",
        number="03",
        title="Ask the\nsame page.",
        body="Follow-up questions use the page you already summarized.",
        tag="Follow-up",
        source_label="github.com",
    ),
    StoreShot(
        source="04-your-key-stays-in-chrome-live.png",
        output="04-your-key-stays-in-chrome.png",
        number="04",
        title="Your key stays\nin Chrome.",
        body="No account. No Steeped server. A fake demo key is shown here.",
        tag="Settings",
        source_label="extension settings",
    ),
    StoreShot(
        source="05-local-history-live.png",
        output="05-local-history.png",
        number="05",
        title="Local history,\nready later.",
        body="Recent notes stay on your device, ready to reopen or delete.",
        tag="Local only",
        source_label="developer.mozilla.org",
    ),
]


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_MONO if mono else (FONT_BOLD if bold else FONT_REGULAR)
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if not current or text_size(draw, candidate, fnt)[0] <= width:
            current = candidate
            continue
        lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    fill: tuple[int, int, int],
    width: int,
    line_gap: int = 8,
) -> int:
    x, y = xy
    for line in wrap(draw, text, fnt, width):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += text_size(draw, line, fnt)[1] + line_gap
    return y


def shadowed_round_rect(
    img: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    fill: tuple[int, int, int],
    outline: tuple[int, int, int] | None = None,
    shadow: tuple[int, int, int, int] = (0, 0, 0, 44),
) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    d.rounded_rectangle((x1, y1 + 16, x2, y2 + 16), radius, fill=shadow)
    layer = layer.filter(ImageFilter.GaussianBlur(22))
    img.alpha_composite(layer)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius, fill=fill, outline=outline)


def paste_icon(img: Image.Image, x: int, y: int, size: int, radius: int) -> None:
    icon = Image.open(ICON).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius, fill=255)
    img.paste(icon, (x, y), mask)


def cover(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    src = source.convert("RGBA")
    scale = max(target_w / src.width, target_h / src.height)
    next_size = (round(src.width * scale), round(src.height * scale))
    src = src.resize(next_size, Image.Resampling.LANCZOS)
    left = max((src.width - target_w) // 2, 0)
    top = max((src.height - target_h) // 2, 0)
    return src.crop((left, top, left + target_w, top + target_h))


def load_capture(name: str) -> Image.Image:
    path = SOURCE / name
    if not path.exists():
        raise SystemExit(
            f"Missing live capture: {path}\n"
            "Run `npm run build`, launch a browser with the unpacked extension, "
            "then run `npm run screenshots:store -- --port=<debug-port>`."
        )
    return cover(Image.open(path), (1280, 800))


def save_rgb(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path)
    print(path)


def rail_grid(draw: ImageDraw.ImageDraw, x1: int, y1: int, x2: int, y2: int) -> None:
    grid = (226, 218, 203)
    for x in range(x1, x2, 34):
        draw.line((x, y1, x, y2), fill=grid, width=1)
    for y in range(y1, y2, 34):
        draw.line((x1, y, x2, y), fill=grid, width=1)


def draw_store_rail(img: Image.Image, shot: StoreShot) -> None:
    draw = ImageDraw.Draw(img)
    rail_w = 372

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle((0, 0, rail_w, 800), fill=PAPER + (249,))
    for x in range(0, rail_w, 34):
        od.line((x, 0, x, 800), fill=(226, 218, 203, 145), width=1)
    for y in range(0, 800, 34):
        od.line((0, y, rail_w, y), fill=(226, 218, 203, 145), width=1)
    od.rectangle((rail_w - 4, 0, rail_w, 800), fill=TAN + (255,))
    img.alpha_composite(overlay)

    paste_icon(img, 66, 62, 44, 10)
    draw.text((124, 72), "Steeped", font=font(29, True), fill=INK)

    draw.text((72, 180), shot.number, font=font(13, True), fill=TEAL)
    y = 222
    for line in shot.title.split("\n"):
        draw.text((70, y), line, font=font(48, True), fill=INK)
        y += 54

    y += 16
    draw_wrapped(draw, (72, y), shot.body, font(20), MUTED, 250, 8)

    draw.text((72, 626), "CAPTURED ON", font=font(10, True), fill=SOFT)
    draw.text((72, 646), shot.source_label, font=font(15, True), fill=INK)
    draw.rounded_rectangle((72, 694, 72 + 156, 732), 19, fill=PAPER_2, outline=LINE)
    draw.text((96, 704), shot.tag, font=font(13, True), fill=MUTED)


def render_store_shot(shot: StoreShot) -> None:
    img = load_capture(shot.source)
    draw_store_rail(img, shot)
    save_rgb(img, OUT / shot.output)


def paste_rounded_image(
    img: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    outline: tuple[int, int, int] | None = None,
) -> None:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    fitted = cover(source, (w, h))
    shadowed_round_rect(img, box, radius, (255, 255, 255, 0), outline)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius, fill=255)
    img.paste(fitted, (x1, y1), mask)
    if outline:
        ImageDraw.Draw(img).rounded_rectangle(box, radius, outline=outline, width=2)


def base(size: tuple[int, int]) -> Image.Image:
    img = Image.new("RGBA", size, PAPER + (255,))
    rail_grid(ImageDraw.Draw(img), 0, 0, size[0], size[1])
    return img


def social_card() -> None:
    img = base((1600, 900))
    draw = ImageDraw.Draw(img)
    raw = load_capture("02-sources-attached-live.png")
    preview = raw.crop((420, 0, 1280, 800))

    paste_icon(img, 132, 112, 126, 26)
    draw.text((292, 135), "Steeped", font=font(72, True), fill=INK)
    draw.text((132, 304), "Big reads,", font=font(108, True), fill=INK)
    draw.text((132, 420), "small notes.", font=font(108, True), fill=INK)
    draw_wrapped(
        draw,
        (138, 582),
        "The current page becomes a short note with sources.",
        font(35),
        MUTED,
        710,
        10,
    )

    chips = ["No account", "Sources attached", "Key stays in Chrome"]
    x = 140
    for label in chips:
        tw, _ = text_size(draw, label, font(22, True))
        draw.rounded_rectangle((x, 724, x + tw + 42, 772), 24, fill=PAPER_2, outline=LINE)
        draw.rounded_rectangle((x + 18, 742, x + 30, 754), 3, fill=TEAL)
        draw.text((x + 42, 735), label, font=font(22, True), fill=INK)
        x += tw + 74

    paste_rounded_image(img, preview, (884, 114, 1450, 792), 24, LINE)
    save_rgb(img, SOCIAL / "steeped-social-card-1600x900.png")
    save_rgb(img, DOCS / "social-card.png")


def promo_tile() -> None:
    img = base((440, 280))
    draw = ImageDraw.Draw(img)
    raw = load_capture("02-sources-attached-live.png")
    preview = raw.crop((760, 0, 1280, 800)).resize((182, 280), Image.Resampling.LANCZOS)
    tint = Image.new("RGBA", preview.size, NAVY + (116,))
    preview.alpha_composite(tint)
    img.alpha_composite(preview, (258, 0))
    draw.rectangle((252, 0, 440, 280), fill=NAVY + (72,))

    paste_icon(img, 34, 34, 58, 14)
    draw.text((108, 47), "Steeped", font=font(31, True), fill=INK)
    draw.text((34, 133), "Big reads,", font=font(38, True), fill=INK)
    draw.text((34, 176), "small notes.", font=font(38, True), fill=INK)
    draw.text((36, 226), "Sources attached.", font=font(15, True), fill=MUTED)
    save_rgb(img, SOCIAL / "steeped-promo-tile-440x280.png")


def validate(paths: Iterable[tuple[Path, tuple[int, int]]]) -> None:
    for path, size in paths:
        img = Image.open(path)
        if img.size != size or img.mode != "RGB":
            raise SystemExit(f"Invalid asset: {path} is {img.size} {img.mode}, expected {size} RGB")


def main() -> None:
    for shot in STORE_SHOTS:
        render_store_shot(shot)
    social_card()
    promo_tile()
    validate(
        [(OUT / shot.output, (1280, 800)) for shot in STORE_SHOTS]
        + [
            (SOCIAL / "steeped-social-card-1600x900.png", (1600, 900)),
            (DOCS / "social-card.png", (1600, 900)),
            (SOCIAL / "steeped-promo-tile-440x280.png", (440, 280)),
        ]
    )


if __name__ == "__main__":
    main()
