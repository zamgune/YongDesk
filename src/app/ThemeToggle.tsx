"use client";

import { useEffect, useState } from "react";

import styles from "./page.module.css";

type ThemeMode = "dark" | "light";

const storageKey = "stock-analysis-theme";

const applyTheme = (theme: ThemeMode) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new CustomEvent("stock-analysis-theme-change", { detail: { theme } }));
};

const getInitialTheme = (): ThemeMode => {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
  };

  return (
    <button
      type="button"
      className={styles.themeToggle}
      data-theme-state={theme}
      onClick={toggleTheme}
      suppressHydrationWarning
      aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      <span className={styles.themeToggleKnob} aria-hidden="true" />
      <span className={`${styles.themeToggleIcon} ${styles.themeMoon}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M20.2 15.6A8.4 8.4 0 0 1 8.4 3.8 8.8 8.8 0 1 0 20.2 15.6Z" />
        </svg>
      </span>
      <span className={`${styles.themeToggleIcon} ${styles.themeSun}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6" />
        </svg>
      </span>
    </button>
  );
}
