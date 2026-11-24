import React, { useEffect, useRef, useState, useCallback } from 'react';

interface UseBottomSheetOptions {
  isOpen: boolean;
  onClose: () => void;
  threshold?: number;
}

// Global modal counter to guarantee body overflow is never stuck
let activeModalsCount = 0;

function lockScroll() {
  activeModalsCount++;
  if (activeModalsCount === 1) {
    document.body.style.overflow = 'hidden';
  }
}

function unlockScroll() {
  activeModalsCount = Math.max(0, activeModalsCount - 1);
  if (activeModalsCount === 0) {
    document.body.style.overflow = '';
  }
}

export function useBottomSheetGesture({ isOpen, onClose, threshold = 65 }: UseBottomSheetOptions) {
  const [dragOffset, setDragOffset] = useState<number>(0);
  const startYRef = useRef<number>(0);
  const currentYRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);

  // Safely lock background scrolling only while this modal is open
  useEffect(() => {
    if (!isOpen) return;
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, [isOpen]);

  // Reset dragOffset on open/close
  useEffect(() => {
    if (isOpen) {
      setDragOffset(0);
      isDraggingRef.current = false;
    }
  }, [isOpen]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    startYRef.current = e.touches[0].clientY;
    currentYRef.current = e.touches[0].clientY;
    isDraggingRef.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    const currentY = e.touches[0].clientY;
    currentYRef.current = currentY;
    const diff = currentY - startYRef.current;
    if (diff > 0) {
      setDragOffset(Math.min(diff, 220));
    } else {
      setDragOffset(0);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const diff = currentYRef.current - startYRef.current;
    if (diff > threshold) {
      setDragOffset(0);
      onClose();
    } else {
      setDragOffset(0);
    }
  }, [onClose, threshold]);

  const onTouchCancel = useCallback(() => {
    isDraggingRef.current = false;
    setDragOffset(0);
  }, []);

  return {
    dragOffset,
    handleProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
      style: { touchAction: 'none' as const },
    },
  };
}
