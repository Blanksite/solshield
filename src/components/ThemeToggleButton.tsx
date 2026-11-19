"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_STORAGE_KEY = "solshield_theme_v3";
const THEME_EVENT = "solshield-theme-change";

export interface ThemeToggleButtonProps {
  className?: string;
  showLabel?: boolean;
}

export default function ThemeToggleButton({
  className = "",
  showLabel = false,
}: ThemeToggleButtonProps) {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        const isDark = saved !== "light";
        setDarkMode(isDark);
        document.documentElement.classList.toggle("dark", isDark);
        document.documentElement.dataset.theme = isDark ? "dark" : "light";
      } catch {
        setDarkMode(true);
      }
    };

    syncFromStorage();
    setMounted(true);

    const onThemeEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ darkMode?: boolean }>).detail;
      if (typeof detail?.darkMode === "boolean") {
        setDarkMode(detail.darkMode);
      } else {
        syncFromStorage();
      }
    };

    window.addEventListener(THEME_EVENT, onThemeEvent);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeEvent);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const handleToggle = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextDark ? "dark" : "light");
    } catch {
      // ignore storage restrictions
    }
    window.dispatchEvent(
      new CustomEvent(THEME_EVENT, { detail: { darkMode: nextDark } })
    );
  };

  const label = darkMode ? "Switch to Light Mode" : "Switch to Dark Mode";

  return (
    <button
      type="button"
      data-theme-toggle="true"
      onClick={handleToggle}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center gap-1.5 h-8 ${
        showLabel ? "px-2.5" : "w-8"
      } rounded-lg border text-xs font-medium transition-colors cursor-pointer shrink-0 ${
        !mounted || darkMode
          ? "border-white/15 bg-white/[0.04] text-[#D7DCE8] hover:border-[#2934FF] hover:text-white"
          : "border-black/15 bg-white text-[#141413] hover:border-[#2934FF] hover:text-[#2934FF] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      } ${className}`}
    >
      {!mounted || darkMode ? (
        <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      ) : (
        <Moon className="w-3.5 h-3.5 text-[#2934FF] shrink-0" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {!mounted || darkMode ? "Light" : "Dark"}
        </span>
      )}
    </button>
  );
}
