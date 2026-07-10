"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type SymbolSearchItem,
  type SymbolSearchMarket,
  type SymbolSearchResponseItem,
} from "@/lib/market/symbol-search";
import styles from "./page.module.css";

type SymbolAutocompleteProps = {
  label: string;
  value: string;
  placeholder?: string;
  markets?: SymbolSearchMarket[];
  onChange: (value: string) => void;
  onSelect: (item: SymbolSearchItem) => void;
};

const getMarketLabel = (market: SymbolSearchMarket) => {
  if (market === "US") {
    return "US";
  }
  if (market === "KOSPI") {
    return "코스피";
  }
  if (market === "KOSDAQ") {
    return "코스닥";
  }
  return "크립토";
};

const getBilingualName = (item: SymbolSearchItem) =>
  [...new Set([item.nameKo, item.nameEn, item.name].filter((name): name is string => Boolean(name?.trim())))]
    .join(" · ");

export default function SymbolAutocomplete({
  label,
  value,
  placeholder,
  markets,
  onChange,
  onSelect,
}: SymbolAutocompleteProps) {
  const listId = useId();
  const rootRef = useRef<HTMLLabelElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pointerFocusRequestedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [matches, setMatches] = useState<SymbolSearchResponseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const trimmedValue = value.trim();
  const marketQuery = useMemo(() => markets?.join(",") ?? "", [markets]);
  const showList = open && matches.length > 0;
  const showPanel = open && Boolean(trimmedValue) && (loading || Boolean(error) || matches.length > 0 || hasSearched);
  const boundedActiveIndex = Math.min(activeIndex, Math.max(matches.length - 1, 0));

  const resetSearchState = useCallback(() => {
    setMatches([]);
    setActiveIndex(0);
    setLoading(false);
    setError(null);
    setHasSearched(false);
  }, []);

  useEffect(() => {
    if (!open || !trimmedValue) {
      setMatches([]);
      setLoading(false);
      setError(null);
      setHasSearched(false);
      return;
    }

    const controller = new AbortController();
    setHasSearched(false);
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: trimmedValue,
          limit: "12",
        });
        if (marketQuery) {
          params.set("markets", marketQuery);
        }
        const response = await fetch(`/api/symbol-search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("검색 실패");
        }
        const payload = (await response.json()) as { matches?: SymbolSearchResponseItem[] };
        setMatches(payload.matches ?? []);
        setHasSearched(true);
      } catch (fetchError) {
        if (!controller.signal.aborted) {
          setMatches([]);
          setError(fetchError instanceof Error ? fetchError.message : "검색 실패");
          setHasSearched(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [marketQuery, open, trimmedValue]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        resetSearchState();
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [resetSearchState]);

  const selectItem = (item: SymbolSearchItem) => {
    onSelect(item);
    setOpen(false);
    resetSearchState();
    window.setTimeout(() => inputRef.current?.blur(), 0);
  };

  return (
    <label ref={rootRef} className={styles.symbolAutocomplete}>
      <span>{label}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onPointerDown={() => {
          pointerFocusRequestedRef.current = document.activeElement !== inputRef.current;
        }}
        onMouseDown={() => {
          pointerFocusRequestedRef.current = document.activeElement !== inputRef.current;
        }}
        onFocus={() => {
          if (pointerFocusRequestedRef.current && trimmedValue) {
            onChange("");
            resetSearchState();
          }
          pointerFocusRequestedRef.current = false;
          setOpen(true);
        }}
        onClick={() => {
          if (!open && trimmedValue) {
            onChange("");
            resetSearchState();
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (!showList) {
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % matches.length);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            selectItem(matches[boundedActiveIndex]);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            resetSearchState();
          }
        }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {showPanel ? (
        <div id={listId} className={styles.symbolAutocompleteList} role="listbox">
          {loading ? <div className={styles.symbolAutocompleteStatus}>검색 중</div> : null}
          {!loading && error ? <div className={styles.symbolAutocompleteStatus}>{error}</div> : null}
          {!loading && !error && !matches.length ? (
            <div className={styles.symbolAutocompleteStatus}>검색 결과 없음</div>
          ) : null}
          {!loading && !error
            ? matches.map((match, index) => (
              <button
                key={`${match.market}:${match.symbol}`}
                type="button"
                className={index === boundedActiveIndex ? styles.symbolAutocompleteActive : ""}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectItem(match)}
                role="option"
                aria-selected={index === boundedActiveIndex}
              >
                <span className={styles.symbolAutocompleteName}>{getBilingualName(match)}</span>
                <span className={styles.symbolAutocompleteMarket}>{getMarketLabel(match.market)}</span>
                <span className={styles.symbolAutocompleteCode}>{match.displaySymbol}</span>
                <span className={styles.symbolAutocompleteMeta}>
                  {[match.exchange, match.sector, ...(match.themes ?? [])]
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(" / ")}
                </span>
              </button>
            ))
            : null}
        </div>
      ) : null}
    </label>
  );
}
