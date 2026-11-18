from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader

output = Path(__file__).resolve().parents[1] / "private" / "fixtures"
output.mkdir(parents=True, exist_ok=True)
text = "KNOWLEDGE OCR TEST ALPHA 2026"
c = canvas.Canvas(str(output / "native.pdf"), pagesize=(800, 500))
c.setFont("Helvetica", 28)
c.drawString(40, 400, text)
c.drawString(40, 340, "A native PDF fixture for knowledge ingestion.")
c.save()

image = Image.new("RGB", (1600, 1000), "white")
draw = ImageDraw.Draw(image)
font_path = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
font = ImageFont.truetype(str(font_path), 60) if font_path.exists() else ImageFont.load_default(size=60)
draw.text((80, 180), text, font=font, fill="black")
draw.text((80, 320), "SCANNED DOCUMENT SAMPLE", font=font, fill="black")
image.save(output / "scanned.png")
c = canvas.Canvas(str(output / "scanned.pdf"), pagesize=(800, 500))
c.drawImage(ImageReader(image), 0, 0, width=800, height=500)
c.save()
assert text in PdfReader(output / "native.pdf").pages[0].extract_text()
assert not PdfReader(output / "scanned.pdf").pages[0].extract_text().strip()
print("Generated native and genuinely image-only PDF fixtures")
