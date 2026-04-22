"use client";

import type { KonvaEventObject } from "konva/lib/Node";
import { Loader2, MapPinned } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Stage } from "react-konva";
import type { Attachment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RegionPoint = {
  x: number;
  y: number;
};

export function RegionSelectorDialog({
  attachment,
  open,
  onOpenChange,
  onConfirm,
  isSubmitting = false,
}: {
  attachment: Attachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (point: RegionPoint) => void;
  isSubmitting?: boolean;
}) {
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(
    null
  );
  const [selectedPoint, setSelectedPoint] = useState<RegionPoint | null>(null);

  useEffect(() => {
    if (!attachment?.url) {
      setImageElement(null);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      setImageElement(image);
    };
    image.src = attachment.url;

    return () => {
      image.onload = null;
    };
  }, [attachment?.url]);

  useEffect(() => {
    setSelectedPoint(attachment?.selectedRegion ?? null);
  }, [attachment]);

  const stageSize = useMemo(() => {
    if (!imageElement) {
      return { width: 640, height: 400, scaleX: 1, scaleY: 1 };
    }

    const maxWidth = 720;
    const maxHeight = 480;
    const widthScale = maxWidth / imageElement.naturalWidth;
    const heightScale = maxHeight / imageElement.naturalHeight;
    const scale = Math.min(widthScale, heightScale, 1);

    return {
      width: Math.round(imageElement.naturalWidth * scale),
      height: Math.round(imageElement.naturalHeight * scale),
      scaleX:
        imageElement.naturalWidth /
        Math.round(imageElement.naturalWidth * scale),
      scaleY:
        imageElement.naturalHeight /
        Math.round(imageElement.naturalHeight * scale),
    };
  }, [imageElement]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-4xl p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <div className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <DialogHeader className="gap-3">
            <div className="flex items-center gap-2 text-sky-700 text-sm">
              <MapPinned className="size-4" />
              Region-based image analysis
            </div>
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              Please click on the region you want to analyze
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-sm text-slate-600">
              Pick the most relevant injury, wound, or area of concern. Medix
              will use that exact point to focus segmentation before retrieval.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            {imageElement ? (
              <div className="flex justify-center">
                <Stage
                  className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white"
                  height={stageSize.height}
                  onClick={(event: KonvaEventObject<MouseEvent>) => {
                    const stage = event.target.getStage();
                    const pointer = stage?.getPointerPosition();
                    if (!pointer) {
                      return;
                    }

                    setSelectedPoint({
                      x: Math.round(pointer.x * stageSize.scaleX),
                      y: Math.round(pointer.y * stageSize.scaleY),
                    });
                  }}
                  width={stageSize.width}
                >
                  <Layer>
                    <KonvaImage
                      height={stageSize.height}
                      image={imageElement}
                      width={stageSize.width}
                    />
                    {selectedPoint ? (
                      <Circle
                        fill="#0ea5e9"
                        opacity={0.95}
                        radius={9}
                        stroke="white"
                        strokeWidth={3}
                        x={selectedPoint.x / stageSize.scaleX}
                        y={selectedPoint.y / stageSize.scaleY}
                      />
                    ) : null}
                  </Layer>
                </Stage>
              </div>
            ) : (
              <div className="flex min-h-[20rem] items-center justify-center text-slate-500 text-sm">
                Loading image…
              </div>
            )}
          </div>

          <div className="mt-4 text-sm text-slate-500">
            {selectedPoint
              ? `Selected point: (${selectedPoint.x}, ${selectedPoint.y})`
              : "No point selected yet."}
          </div>

          <DialogFooter className="mt-6 flex-row justify-between">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setSelectedPoint(null)}
                type="button"
                variant="ghost"
              >
                Clear selection
              </Button>
              <Button
                disabled={!selectedPoint || isSubmitting}
                onClick={() => {
                  if (selectedPoint) {
                    onConfirm(selectedPoint);
                  }
                }}
                type="button"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  "Analyze selected region"
                )}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
