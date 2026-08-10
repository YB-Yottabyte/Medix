import { useCallback, useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 24;

export function useScrollToBottom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const shouldFollowRef = useRef(true);
  const isUserScrollingRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const releaseAutoScrollRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return true;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    shouldFollowRef.current = true;
    isUserScrollingRef.current = false;
    isAutoScrollingRef.current = true;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });

    if (releaseAutoScrollRef.current) {
      clearTimeout(releaseAutoScrollRef.current);
    }
    releaseAutoScrollRef.current = setTimeout(
      () => {
        isAutoScrollingRef.current = false;
        lastScrollTopRef.current = container.scrollTop;
      },
      behavior === "smooth" ? 320 : 0
    );
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let scrollTimeout: ReturnType<typeof setTimeout>;

    const pauseFollowing = () => {
      shouldFollowRef.current = false;
      isAutoScrollingRef.current = false;
      isUserScrollingRef.current = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (releaseAutoScrollRef.current) {
        clearTimeout(releaseAutoScrollRef.current);
        releaseAutoScrollRef.current = null;
      }
      // Cancel any native smooth-scroll animation already in flight. Without
      // this, a queued auto-follow can pull the user back down after they try
      // to scroll upward.
      container.scrollTo({ top: container.scrollTop, behavior: "auto" });
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        pauseFollowing();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      // A pointer down on the container itself is how scrollbar dragging
      // starts. Ordinary clicks on message controls should not disable
      // response following.
      if (event.target === container) {
        pauseFollowing();
      }
    };

    const handleScroll = () => {
      const nextScrollTop = container.scrollTop;
      if (isAutoScrollingRef.current) {
        lastScrollTopRef.current = nextScrollTop;
        return;
      }

      isUserScrollingRef.current = true;
      clearTimeout(scrollTimeout);

      const movingUp = nextScrollTop < lastScrollTopRef.current - 1;
      const atBottom = checkIfAtBottom();
      if (movingUp) {
        shouldFollowRef.current = false;
      } else if (atBottom) {
        shouldFollowRef.current = true;
      }

      setIsAtBottom(atBottom);
      isAtBottomRef.current = atBottom;
      lastScrollTopRef.current = nextScrollTop;

      scrollTimeout = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 120);
    };

    lastScrollTopRef.current = container.scrollTop;
    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    container.addEventListener("touchstart", pauseFollowing, {
      passive: true,
    });
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("touchstart", pauseFollowing);
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [checkIfAtBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scrollIfNeeded = () => {
      if (!shouldFollowRef.current || isUserScrollingRef.current) {
        return;
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        if (!shouldFollowRef.current || isUserScrollingRef.current) {
          return;
        }
        isAutoScrollingRef.current = true;
        container.scrollTo({
          top: container.scrollHeight,
          // DOM and resize observers can fire for every streamed token and
          // every frame of the media reveal. Instant incremental following
          // avoids stacking native smooth-scroll animations.
          behavior: "auto",
        });
        setIsAtBottom(true);
        isAtBottomRef.current = true;

        if (releaseAutoScrollRef.current) {
          clearTimeout(releaseAutoScrollRef.current);
        }
        releaseAutoScrollRef.current = setTimeout(() => {
          isAutoScrollingRef.current = false;
          lastScrollTopRef.current = container.scrollTop;
        }, 180);
      });
    };

    const mutationObserver = new MutationObserver(scrollIfNeeded);
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const resizeObserver = new ResizeObserver(scrollIfNeeded);
    resizeObserver.observe(container);
    for (const child of container.children) {
      resizeObserver.observe(child);
    }

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (releaseAutoScrollRef.current) {
        clearTimeout(releaseAutoScrollRef.current);
      }
    };
  }, []);

  function onViewportEnter() {
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    shouldFollowRef.current = true;
  }

  function onViewportLeave() {
    setIsAtBottom(false);
    isAtBottomRef.current = false;
    shouldFollowRef.current = false;
  }

  const reset = useCallback(() => {
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    shouldFollowRef.current = true;
    isUserScrollingRef.current = false;
    isAutoScrollingRef.current = false;
    lastScrollTopRef.current = 0;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (releaseAutoScrollRef.current) {
      clearTimeout(releaseAutoScrollRef.current);
      releaseAutoScrollRef.current = null;
    }
  }, []);

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    onViewportEnter,
    onViewportLeave,
    reset,
  };
}
