import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

const UPLOAD_DIR = "/tmp/medvidqa_uploads";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = join(UPLOAD_DIR, safeName);
    const fileBuffer = await readFile(filePath);
    const lower = safeName.toLowerCase();
    const contentType = lower.endsWith(".png") ? "image/png" : "image/jpeg";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
