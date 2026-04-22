import Image from "next/image";
import { CrossSmallIcon } from "@/components/chat/shared/icons";
import { Spinner } from "@/components/ui/spinner";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
  onClick,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
}) => {
  const { name, url, contentType, segmentationStatus } = attachment;
  const sharedClasses = cn(
    "group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted",
    onClick && "cursor-pointer"
  );
  const media = contentType?.startsWith("image") ? (
    url.startsWith("blob:") || url.startsWith("data:") ? (
      // biome-ignore lint/performance/noImgElement: blob/data previews are local and render more reliably with img
      <img
        alt={name ?? "attachment"}
        className="size-full object-cover"
        draggable={false}
        src={url}
      />
    ) : (
      <Image
        alt={name ?? "attachment"}
        className="size-full object-cover"
        draggable={false}
        fill
        sizes="96px"
        src={url}
        unoptimized
      />
    )
  ) : (
    <div className="flex size-full items-center justify-center text-muted-foreground text-xs">
      File
    </div>
  );

  return (
    <div className={sharedClasses} data-testid="input-attachment-preview">
      {onClick ? (
        <button className="absolute inset-0" onClick={onClick} type="button">
          {media}
          <span className="sr-only">Open attachment region selector</span>
        </button>
      ) : (
        media
      )}

      {isUploading && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <Spinner className="size-5" />
        </div>
      )}

      {segmentationStatus === "ready" && !isUploading && (
        <div className="absolute bottom-1.5 left-1.5 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[10px] text-white">
          Region set
        </div>
      )}

      {segmentationStatus === "needs-selection" && !isUploading && (
        <div className="absolute bottom-1.5 left-1.5 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[10px] text-white">
          Pick region
        </div>
      )}

      {onRemove && !isUploading && (
        <button
          className="absolute top-1.5 right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          type="button"
        >
          <CrossSmallIcon size={10} />
        </button>
      )}
    </div>
  );
};
