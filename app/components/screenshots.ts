// Draws a sample screenshot on a canvas and returns it as a JPEG, so the samples always match
// the current sample data. Also shrinks a customer's own image before it's sent.

export interface Sample {
  id: string; user: string; label: string; app: string; title: string; status: string; tone: "ok" | "wait" | "stop";
  rows: [string, string][];
  hidden?: string;
}

export interface Attachment { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string; preview: string; name: string }

const TONE = { ok: "#166534", wait: "#B45309", stop: "#B91C1C" };

export function drawSample(s: Sample): Attachment {
  const w = 720;
  const h = 520 + s.rows.length * 70;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#F4F4F5";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#18181B";
  g.fillRect(0, 0, w, 90);
  g.fillStyle = "#FFFFFF";
  g.font = "600 30px system-ui, sans-serif";
  g.fillText(s.app, 40, 58);
  g.fillStyle = "#FFFFFF";
  g.fillRect(30, 120, w - 60, h - 170);
  g.fillStyle = "#09090B";
  g.font = "700 40px system-ui, sans-serif";
  g.fillText(s.title, 60, 190);
  g.fillStyle = TONE[s.tone];
  g.font = "600 30px system-ui, sans-serif";
  g.fillText(s.status, 60, 245);
  let y = 320;
  for (const [k, v] of s.rows) {
    g.fillStyle = "#71717A";
    g.font = "26px system-ui, sans-serif";
    g.fillText(k, 60, y);
    g.fillStyle = "#09090B";
    g.font = "600 28px system-ui, sans-serif";
    g.fillText(v, 60, y + 36);
    y += 70;
  }
  if (s.hidden) {
    // Faint small text, as an attacker would hide it.
    g.fillStyle = "#D4D4D8";
    g.font = "15px system-ui, sans-serif";
    wrap(g, s.hidden, 60, h - 80, w - 120, 18);
  }
  const url = c.toDataURL("image/jpeg", 0.9);
  return { media_type: "image/jpeg", data: url.split(",")[1], preview: url, name: `${s.id}.jpg` };
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > max) {
      g.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
}

/** Read a customer's image file, shrink it to at most 1400 px, and return it as a JPEG. */
export async function readImage(file: File): Promise<Attachment> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: out.split(",")[1], preview: out, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}
