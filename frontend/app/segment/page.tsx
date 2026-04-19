"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, ScanSearch } from "lucide-react";

type SegmentResponse = {
  highlighted_image: string;
  mask_data: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  region_description: string;
};

type Point = {
  x: number;
  y: number;
  xPercent: number;
  yPercent: number;
};

export default function SegmentPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<SegmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const overlayUrl = useMemo(() => {
    if (!result?.highlighted_image) {
      return null;
    }
    return `data:image/png;base64,${result.highlighted_image}`;
  }, [result]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const onFileChange = (file: File | null) => {
    setSelectedFile(file);
    setResult(null);
    setError(null);
    setSelectedPoint(null);

    if (!file) {
      setPreviewUrl(null);
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const onPreviewClick = (event: React.MouseEvent<HTMLImageElement>) => {
    const imageElement = event.currentTarget;
    const rect = imageElement.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const xPercent = Math.min(Math.max(offsetX / rect.width, 0), 1);
    const yPercent = Math.min(Math.max(offsetY / rect.height, 0), 1);

    const naturalWidth = imageElement.naturalWidth || 1;
    const naturalHeight = imageElement.naturalHeight || 1;

    setSelectedPoint({
      x: Math.round(xPercent * naturalWidth),
      y: Math.round(yPercent * naturalHeight),
      xPercent,
      yPercent,
    });
  };

  const runSegmentation = async () => {
    if (!selectedFile) {
      setError("Upload an image first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("image", selectedFile, selectedFile.name);
      if (selectedPoint) {
        formData.append("x", String(selectedPoint.x));
        formData.append("y", String(selectedPoint.y));
      }

      const response = await fetch("/api/segment", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as SegmentResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Segmentation request failed.");
      }

      setResult(data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Segmentation request failed."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_30%),linear-gradient(180deg,#f8fbff_0%,#f2f7fb_48%,#f8fafc_100%)] px-6 py-8 text-slate-900 md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sky-700 text-sm">
              <ScanSearch className="size-4" />
              SAM 2 local segmentation tester
            </div>
            <h1 className="font-semibold text-4xl tracking-[-0.05em]">
              Test segmentation visually
            </h1>
            <p className="mt-3 max-w-2xl text-slate-600">
              Upload an image, optionally click a point prompt, and send it to
              the Medix Flask backend to preview the SAM 2 overlay.
            </p>
          </div>

          <Link
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm transition-colors hover:bg-slate-50"
            href="/"
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[1.75rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.22)] backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-medium text-lg">Input image</h2>
                <p className="text-sm text-slate-500">
                  Click on the image to set the segmentation point, or leave it
                  empty to use the center.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm hover:bg-slate-100">
                Upload image
                <input
                  accept="image/*"
                  className="hidden"
                  onChange={(event) =>
                    onFileChange(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
            </div>

            <div
              className="relative flex min-h-[22rem] items-center justify-center overflow-hidden rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50"
            >
              {previewUrl ? (
                <div className="relative flex min-h-[22rem] w-full items-center justify-center p-3">
                  <div className="relative inline-block">
                    {/* biome-ignore lint/performance/noImgElement: local object URLs render more reliably here than next/image */}
                    <img
                      alt="Selected segmentation input"
                      className="max-h-[28rem] w-auto max-w-full rounded-xl object-contain"
                      draggable={false}
                      onClick={onPreviewClick}
                      src={previewUrl}
                    />
                    {selectedPoint ? (
                      <div
                        className="absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-sky-500 shadow-lg"
                        style={{
                          left: `${selectedPoint.xPercent * 100}%`,
                          top: `${selectedPoint.yPercent * 100}%`,
                        }}
                      >
                        <div className="size-2 rounded-full bg-white" />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="px-6 text-center text-slate-500 text-sm">
                  No image selected yet. Upload a local image to begin.
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!selectedFile || isLoading}
                onClick={runSegmentation}
                type="button"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Segmenting...
                  </>
                ) : (
                  <>
                    <ScanSearch className="size-4" />
                    Segment image
                  </>
                )}
              </button>
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setSelectedPoint(null)}
                type="button"
              >
                Use center point
              </button>
              <div className="text-sm text-slate-500">
                Point:{" "}
                {selectedPoint
                  ? `(${selectedPoint.x}, ${selectedPoint.y})`
                  : "center"}
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
                {error}
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.75rem] border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.22)] backdrop-blur-xl">
            <h2 className="font-medium text-lg">Segmentation output</h2>
            <p className="mb-4 text-sm text-slate-500">
              The highlighted mask, region box, and label returned by the Flask
              backend.
            </p>

            <div className="relative flex min-h-[22rem] items-center justify-center overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50">
              {overlayUrl ? (
                <div className="flex min-h-[22rem] w-full items-center justify-center p-3">
                  {/* biome-ignore lint/performance/noImgElement: base64 overlay previews should render directly without next/image optimization */}
                  <img
                  alt="Segmentation overlay result"
                  className="max-h-[28rem] w-auto max-w-full rounded-xl object-contain"
                  draggable={false}
                  src={overlayUrl}
                  />
                </div>
              ) : (
                <div className="px-6 text-center text-slate-500 text-sm">
                  Run segmentation to see the overlay result here.
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 text-sm">
              <div>
                <div className="text-slate-500">Region description</div>
                <div className="font-medium text-slate-900">
                  {result?.region_description ?? "Not available yet"}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Bounding box</div>
                <div className="font-medium text-slate-900">
                  {result
                    ? `x=${result.mask_data.x}, y=${result.mask_data.y}, width=${result.mask_data.width}, height=${result.mask_data.height}`
                    : "Not available yet"}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
