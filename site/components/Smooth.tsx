"use client";
// Smooth, eased scrolling for the whole site (Lenis), with in-page links (#get) eased too. Off for
// anyone who asks their system for less motion.
import Lenis from "lenis";
import { useEffect } from "react";

export function Smooth() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Quick to follow the wheel (lerp 0.18): smooth, but never floaty or slow to stop. Touch keeps
    // the device's own scrolling.
    const lenis = new Lenis({ autoRaf: true, lerp: 0.18, wheelMultiplier: 1.1, anchors: { offset: -96 } });
    return () => lenis.destroy();
  }, []);
  return null;
}
